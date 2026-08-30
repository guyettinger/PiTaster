#!/usr/bin/env node
/**
 * REPL driver for the anyapp Electron desktop app.
 *
 * Launches the BUILT app (out/main/index.mjs) under Playwright and exposes a
 * line-oriented command REPL, so an agent can drive the UI and capture
 * screenshots without relaunching the (slow) app for every interaction.
 *
 * See SKILL.md for the command table, the FIFO wrapper, and the gotchas.
 */
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const APP_DIR = path.join(REPO_ROOT, 'apps/electron')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/anyapp-shots'

/** Electron's binary differs per platform; the mac path is a .app bundle. */
const ELECTRON_BIN =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null

/** Read the focused window's bounds, raising it first so a native grab sees it. */
async function focusedBounds() {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.focus()
    return win.getBounds()
  })
}

const need = () => {
  if (!page) throw new Error('launch first')
}

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.mjs'))) {
      return console.log('ERROR: no build. Run `bun run build` from the repo root first.')
    }
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR],
      timeout: 60_000
    })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // The renderer restores the active app over IPC after mount; there is no
    // single "ready" signal to await, so settle before the first interaction.
    await page.waitForSelector('nav, [class*="flex h-screen"]', { timeout: 20_000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 3000))
    console.log('launched.', app.windows().length, 'window(s)')
    for (const w of app.windows()) console.log('  ', w.url())
  },

  /** Resize/reposition. Keep height <= 910 on a 1080p display — see SKILL.md. */
  async size(arg) {
    need()
    const [w, h] = (arg || '1400x900').split(/[x, ]+/).map(Number)
    await app.evaluate(
      ({ BrowserWindow }, b) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setBounds({ x: 60, y: 40, width: b.w, height: b.h })
        win.focus()
      },
      { w, h }
    )
    await new Promise((r) => setTimeout(r, 700))
    console.log('resized', w, h)
  },

  async bounds() {
    need()
    console.log(JSON.stringify(await focusedBounds()))
  },

  /**
   * Native window capture (macOS). Includes the traffic lights and the real
   * window chrome, which page.screenshot() cannot produce. Use `ss` for a
   * renderer-only grab on other platforms.
   */
  async shot(name) {
    need()
    if (process.platform !== 'darwin') return console.log('ERROR: `shot` is macOS-only; use `ss`')
    const b = await focusedBounds()
    await new Promise((r) => setTimeout(r, 900)) // let the raise + repaint land
    const f = path.join(SHOT_DIR, (name || `shot-${Date.now()}`) + '.png')
    execFileSync('screencapture', ['-x', '-o', '-R', `${b.x},${b.y},${b.width},${b.height}`, f])
    console.log('shot:', f)
  },

  /** Renderer-only screenshot. No window chrome, but cross-platform. */
  async ss(name) {
    need()
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  // ---- generic interaction ------------------------------------------------

  async click(sel) {
    need()
    console.log(
      'click',
      sel,
      '->',
      await page.evaluate((s) => {
        const el = document.querySelector(s)
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      }, sel)
    )
  },

  async 'click-text'(text) {
    need()
    console.log(
      'click-text',
      JSON.stringify(text),
      '->',
      await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
        const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      }, text)
    )
  },

  /** Most anyapp controls are icon-only; aria-label/title is the way in. */
  async 'click-aria'(label) {
    need()
    console.log(
      'click-aria',
      JSON.stringify(label),
      '->',
      await page.evaluate((t) => {
        const els = [...document.querySelectorAll('[aria-label],[title]')]
        const at = (e) => e.getAttribute('aria-label') || e.getAttribute('title') || ''
        const el = els.find((e) => at(e) === t) ?? els.find((e) => at(e).includes(t))
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      }, label)
    )
  },

  async type(text) {
    need()
    await page.keyboard.type(text, { delay: 20 })
  },
  async press(key) {
    need()
    await page.keyboard.press(key)
  },
  async wait(sel) {
    need()
    try {
      await page.waitForSelector(sel, { timeout: 15_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },
  async sleep(ms) {
    await new Promise((r) => setTimeout(r, Number(ms) || 1000))
    console.log('slept')
  },
  async eval(expr) {
    need()
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },
  async text(sel) {
    need()
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null)
    )
  },

  /** Dump every control with its label — the fastest way to find a target. */
  async controls() {
    need()
    console.log(
      await page.evaluate(() =>
        [...document.querySelectorAll('button,[role="button"],input,textarea,select')]
          .map(
            (e, i) =>
              `${i} <${e.tagName}> ${JSON.stringify(
                e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || ''
              )} ${JSON.stringify((e.textContent || '').trim().slice(0, 40))}`
          )
          .join('\n')
      )
    )
  },

  // ---- anyapp-specific ----------------------------------------------------

  /** Open a sub-app from the Apps list by name. */
  async 'open-app'(name) {
    need()
    const r = await page.evaluate((n) => {
      const cards = [...document.querySelectorAll('button')].filter((e) =>
        e.className.includes('cursor-pointer text-left')
      )
      const el = n ? cards.find((e) => e.textContent?.includes(n)) : cards[0]
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.textContent?.trim().slice(0, 30)
    }, name)
    console.log('open-app', JSON.stringify(name || '(first)'), '->', r)
    await new Promise((r) => setTimeout(r, 2500))
  },

  /** Switch the main destination: Apps | Skills | Help | Settings. */
  async nav(dest) {
    need()
    await COMMANDS['click-text'](dest)
    await new Promise((r) => setTimeout(r, 1500))
  },

  /** Toggle a docked panel: History | Terminal | Preview. */
  async panel(which) {
    need()
    await COMMANDS['click-text'](which)
    await new Promise((r) => setTimeout(r, 2000))
  },

  /**
   * Resize the bottom dock. The handle is drag-only — there is no keyboard or
   * click affordance — so synthesise the drag against its mousemove listener.
   */
  async 'panel-height'(px) {
    need()
    const target = Number(px) || 450
    const r = await page.evaluate((t) => {
      const s = document.querySelector('[aria-label="Resize panel"]')
      if (!s) return 'NOT_FOUND (is a bottom panel open?)'
      const rect = s.getBoundingClientRect()
      const y = rect.top + 3
      const current = s.parentElement.getBoundingClientRect().height
      s.dispatchEvent(new MouseEvent('mousedown', { clientY: y, bubbles: true }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: y - (t - current), bubbles: true }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return 'OK'
    }, target)
    console.log('panel-height', target, '->', r)
    await new Promise((r) => setTimeout(r, 800))
  },

  async 'new-chat'() {
    need()
    await COMMANDS['click-aria']('Start a new chat')
    await new Promise((r) => setTimeout(r, 2000))
  },

  /** Send a message to the agent. Returns immediately — poll with `text`. */
  async ask(message) {
    need()
    const ok = await page.evaluate(() => {
      const el = document.querySelector('input[placeholder^="Ask the agent"]')
      if (!el) return false
      el.focus()
      return true
    })
    if (!ok) return console.log('ERROR: composer not found (is an app open?)')
    await page.keyboard.type(message, { delay: 15 })
    await page.keyboard.press('Enter')
    console.log('asked:', message, '— a local model turn takes 40-90s; poll with `text`')
  },

  async approve() {
    need()
    await COMMANDS['click-text']('Allow')
  },
  async deny() {
    need()
    await COMMANDS['click-text']('Deny')
  },

  /** Set the permission mode by its UI label, e.g. "Auto edit". */
  async mode(label) {
    need()
    const r = await page.evaluate((t) => {
      const sel = document.querySelector('select')
      if (!sel) return 'NOT_FOUND'
      const opt = [...sel.options].find((o) => o.textContent.trim() === t || o.textContent.includes(t))
      if (!opt) return 'NO_SUCH_MODE: ' + [...sel.options].map((o) => o.textContent.trim()).join(' | ')
      sel.value = opt.value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return 'OK: ' + opt.textContent.trim()
    }, label)
    console.log('mode', JSON.stringify(label), '->', r)
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

// Electron grabs the inherited stdin; read the tty directly so the REPL keeps its input.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return rl.prompt()
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log('unknown:', cmd, '- try: help')
    return rl.prompt()
  }
  try {
    await fn(rest.join(' '))
  } catch (e) {
    console.log('ERROR:', e.message)
  }
  if (cmd === 'quit') {
    rl.close()
    process.exit(0)
  }
  rl.prompt()
})
rl.on('close', async () => {
  await COMMANDS.quit()
  process.exit(0)
})

console.log('anyapp driver - "help" for commands, "launch" to start')
rl.prompt()
