import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { EventEmitter } from 'node:events'
import type {
  AppTemplate,
  RunningApp,
  AppLogEntry,
  AppStatusChange,
  AppRunConfig
} from '@keylimepi/core'

/** Environment variables to filter out when spawning processes. */
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN'
]

/** Run configurations per template. */
const RUN_CONFIGS: Record<AppTemplate, AppRunConfig> = {
  'react-vite': {
    command: 'bun',
    args: ['run', 'dev', '--'],
    ports: { base: 5200, max: 5299 },
    portFlag: '--port',
    readyPattern: /Local:\s+http/
  },
  'node-server': {
    command: 'bun',
    args: ['run', 'dev'],
    ports: { base: 3100, max: 3199 },
    portFlag: 'PORT', // env var
    readyPattern: /Server running|listening/i
  },
  'static-site': {
    command: 'npx',
    args: ['serve', '.', '-l'],
    ports: { base: 3200, max: 3299 },
    portFlag: null, // port is last arg
    readyPattern: /Serving!/
  },
  'node-cli': {
    command: 'bun',
    args: ['run', 'start'],
    ports: { base: 0, max: 0 },
    portFlag: null,
    readyPattern: null
  },
  blank: {
    command: '',
    args: [],
    ports: { base: 0, max: 0 },
    portFlag: null,
    readyPattern: null
  }
}

/**
 * Manages running dev server processes for sub-apps.
 */
export class AppRunner extends EventEmitter {
  /** Map of running apps by ID. */
  private running = new Map<string, { process: ChildProcess; info: RunningApp }>()

  /** Map of assigned ports to prevent conflicts. */
  private assignedPorts = new Set<number>()

  /**
   * Check if a port is available.
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
  }

  /**
   * Find an available port in the given range.
   */
  private async findAvailablePort(base: number, max: number): Promise<number> {
    for (let port = base; port <= max; port++) {
      if (this.assignedPorts.has(port)) continue
      const available = await this.isPortAvailable(port)
      if (available) {
        this.assignedPorts.add(port)
        return port
      }
    }
    throw new Error(`No available port in range ${base}-${max}`)
  }

  /**
   * Get filtered environment variables.
   */
  private getFilteredEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !BLOCKED_ENV_VARS.includes(key)
      )
    )
  }

  /**
   * Build the command args with port.
   */
  private buildArgs(config: AppRunConfig, port: number): string[] {
    const args = [...config.args]

    if (config.portFlag === '--port') {
      // Vite style: --port 5200
      args.push('--port', String(port))
    } else if (config.portFlag === null && config.ports.base > 0) {
      // serve style: -l 3200
      args.push(String(port))
    }

    return args
  }

  /**
   * Build environment with port if needed.
   */
  private buildEnv(config: AppRunConfig, port: number): NodeJS.ProcessEnv {
    const env = this.getFilteredEnv()

    if (config.portFlag === 'PORT') {
      env.PORT = String(port)
    }

    return env
  }

  /**
   * Emit a log entry.
   */
  private emitLog(appId: string, type: AppLogEntry['type'], message: string): void {
    const entry: AppLogEntry = {
      appId,
      timestamp: new Date().toISOString(),
      type,
      message
    }
    this.emit('log', entry)
  }

  /**
   * Emit a status change.
   */
  private emitStatus(change: AppStatusChange): void {
    this.emit('status', change)
  }

  /**
   * Start a dev server for an app.
   */
  async start(appId: string, appPath: string, template: AppTemplate): Promise<RunningApp> {
    // Check if already running
    if (this.running.has(appId)) {
      throw new Error(`App ${appId} is already running`)
    }

    const config = RUN_CONFIGS[template]

    // Check if template is runnable
    if (!config.command) {
      throw new Error(`Template ${template} is not runnable`)
    }

    // Find available port
    let port = 0
    if (config.ports.base > 0) {
      port = await this.findAvailablePort(config.ports.base, config.ports.max)
    }

    const args = this.buildArgs(config, port)
    const env = this.buildEnv(config, port)

    this.emitLog(appId, 'system', `Starting ${config.command} ${args.join(' ')}`)
    this.emitStatus({ appId, status: 'starting' })

    const proc = spawn(config.command, args, {
      cwd: appPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const info: RunningApp = {
      appId,
      pid: proc.pid!,
      url: port > 0 ? `http://localhost:${port}` : null,
      port,
      startedAt: new Date().toISOString()
    }

    this.running.set(appId, { process: proc, info })

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const message = data.toString()
      this.emitLog(appId, 'stdout', message)

      // Check for ready pattern
      if (config.readyPattern?.test(message)) {
        this.emitStatus({
          appId,
          status: 'running',
          url: info.url ?? undefined,
          port
        })
      }
    })

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      this.emitLog(appId, 'stderr', data.toString())
    })

    // Handle exit
    proc.on('exit', (code) => {
      this.emitLog(appId, 'system', `Process exited with code ${code}`)
      this.running.delete(appId)
      this.assignedPorts.delete(port)
      this.emitStatus({ appId, status: 'stopped' })
    })

    // Handle error
    proc.on('error', (err) => {
      this.emitLog(appId, 'system', `Error: ${err.message}`)
      this.running.delete(appId)
      this.assignedPorts.delete(port)
      this.emitStatus({ appId, status: 'error', error: err.message })
    })

    // For CLI apps or if no ready pattern, emit running after short delay
    if (!config.readyPattern) {
      setTimeout(() => {
        if (this.running.has(appId)) {
          this.emitStatus({ appId, status: 'running' })
        }
      }, 500)
    }

    return info
  }

  /**
   * Stop a running app.
   */
  async stop(appId: string): Promise<void> {
    const entry = this.running.get(appId)
    if (!entry) {
      throw new Error(`App ${appId} is not running`)
    }

    this.emitLog(appId, 'system', 'Stopping process...')

    return new Promise((resolve, reject) => {
      const { process: proc, info } = entry

      // Set a timeout for forced kill
      const forceKillTimeout = setTimeout(() => {
        proc.kill('SIGKILL')
      }, 5000)

      proc.once('exit', () => {
        clearTimeout(forceKillTimeout)
        this.running.delete(appId)
        this.assignedPorts.delete(info.port)
        resolve()
      })

      proc.once('error', reject)

      // Try graceful shutdown first
      proc.kill('SIGTERM')
    })
  }

  /**
   * Stop all running apps.
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.running.keys()).map((id) =>
      this.stop(id).catch(() => {}) // Ignore errors during cleanup
    )
    await Promise.all(promises)
  }

  /**
   * Check if an app is running.
   */
  isRunning(appId: string): boolean {
    return this.running.has(appId)
  }

  /**
   * Get all running apps.
   */
  getRunning(): Map<string, RunningApp> {
    const result = new Map<string, RunningApp>()
    for (const [id, { info }] of this.running) {
      result.set(id, info)
    }
    return result
  }

  /**
   * Get a running app by ID.
   */
  getRunningApp(appId: string): RunningApp | null {
    return this.running.get(appId)?.info ?? null
  }

  /**
   * Check if a template is runnable.
   */
  isRunnable(template: AppTemplate): boolean {
    return Boolean(RUN_CONFIGS[template]?.command)
  }
}
