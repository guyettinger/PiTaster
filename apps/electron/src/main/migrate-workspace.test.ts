/**
 * Tests for the workspace migration chain: anyapp → Pi Taster → Key Lime Pi.
 *
 * This is the one piece of the rebrand that touches data the user owns and cannot
 * regenerate — their sub-apps, the git history inside each one, their transcripts and
 * skills. The properties that matter are therefore about restraint as much as about
 * the move: it runs once, it is a no-op every launch after, and it never folds a
 * legacy directory into a workspace that already exists, because that could overwrite
 * a config or an app currently in use.
 *
 * The metadata rename is tested against a real isomorphic-git repository rather than
 * a fixture, because the property under test is precisely that the rename is
 * *committed* — a rename that left the file uncommitted would leave every migrated
 * app permanently dirty and put a deletion the user never made in front of their next
 * rollback.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { getAppSessionDir } from '@keylimepi/shared'
import {
  LEGACY_META_FILES,
  LEGACY_WORKSPACE_DIRS,
  META_FILE,
  migrateWorkspace,
  rewriteTranscriptCwd
} from './migrate-workspace'

let scratch: string
let legacyRoot: string
let pitasterRoot: string
let root: string

/** Every legacy root in the order {@link migrateWorkspace} defaults to: newest first. */
function allLegacyRoots(): string[] {
  return [pitasterRoot, legacyRoot]
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'keylimepi-migrate-'))
  legacyRoot = join(scratch, '.anyapp')
  pitasterRoot = join(scratch, '.pitaster')
  root = join(scratch, '.keylimepi')
})

/** Whether a path exists, for assertions. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Builds a sub-app under a workspace root, with a git repo and a committed
 * pre-rebrand metadata file — the shape every existing install has on disk.
 *
 * @param params - Which workspace root to build under, the app's id, and which era's
 *   metadata filename to write — the app has had three, and an install can be carrying
 *   either of the older two
 * @returns The app's absolute path
 */
async function seedLegacyApp(params: {
  under: string
  id: string
  metaFile?: string
}): Promise<string> {
  const metaFile = params.metaFile ?? '.anyapp-meta.json'
  const appPath = join(params.under, 'apps', params.id)
  await mkdir(appPath, { recursive: true })
  await writeFile(join(appPath, metaFile), JSON.stringify({ id: params.id }))
  await writeFile(join(appPath, 'index.ts'), 'export const value = 1\n')

  await git.init({ fs, dir: appPath, defaultBranch: 'main' })
  await git.add({ fs, dir: appPath, filepath: metaFile })
  await git.add({ fs, dir: appPath, filepath: 'index.ts' })
  await git.commit({
    fs,
    dir: appPath,
    message: 'initial',
    author: { name: 'Test', email: 'test@example.com' }
  })

  return appPath
}

/** Paths git reports as differing between HEAD, the worktree and the index. */
async function dirtyPaths(dir: string): Promise<string[]> {
  const matrix = await git.statusMatrix({ fs, dir })
  return matrix
    .filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
    .map(([path]) => path)
}

/** The Pi agent directory inside a workspace root. */
function agentDirFor(workspaceRoot: string): string {
  return join(workspaceRoot, 'pi')
}

/**
 * Writes a Pi transcript into the session directory for `appPath`.
 *
 * The header is the real shape Pi writes, because the property under test is that Pi's
 * own listing accepts the migrated file — a fixture that omitted `cwd` would pass a
 * migration that never rewrote it.
 *
 * @param params - Where the transcript belongs and what to put in it
 * @returns The transcript's absolute path
 */
async function seedTranscript(params: {
  agentDir: string
  appPath: string
  id: string
  userText: string
}): Promise<string> {
  const dir = getAppSessionDir({ agentDir: params.agentDir, appPath: params.appPath })
  await mkdir(dir, { recursive: true })

  const header = {
    type: 'session',
    version: 3,
    id: params.id,
    timestamp: '2026-08-30T14:39:51.903Z',
    cwd: params.appPath
  }
  const message = {
    type: 'message',
    id: 'm1',
    parentId: null,
    timestamp: '2026-08-30T14:40:00.000Z',
    message: { role: 'user', content: params.userText }
  }

  const file = join(dir, `2026-08-30T14-39-51-903Z_${params.id}.jsonl`)
  await writeFile(file, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`)
  return file
}

/** Session ids Pi reports for an app, which is what the chat sidebar is built from. */
async function listedSessionIds(params: {
  agentDir: string
  appPath: string
}): Promise<string[]> {
  const dir = getAppSessionDir(params)
  return (await SessionManager.list(params.appPath, dir)).map((info) => info.id)
}


describe('migrateWorkspace', () => {
  test('moves the workspace directory and reports it', async () => {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"qwen"}')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.movedWorkspace).toBe(true)
    expect(await exists(legacyRoot)).toBe(false)
    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"qwen"}')
  })

  test('is a no-op on the second run', async () => {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{}')

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })
    const second = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(second.movedWorkspace).toBe(false)
    expect(second.migratedApps).toEqual([])
  })

  test('does nothing on a fresh install where neither root exists', async () => {
    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.movedWorkspace).toBe(false)
    expect(await exists(root)).toBe(false)
  })

  test('never overwrites a file the destination already has', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'config.json'), '{"model":"current"}')
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"stale"}')
    await writeFile(join(legacyRoot, 'layouts.json'), '{"a":1}')

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    // The live config wins; the gap beside it is filled.
    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"current"}')
    expect(await readFile(join(root, 'layouts.json'), 'utf-8')).toBe('{"a":1}')
    // The legacy root survives, because it still holds the file that was not moved.
    expect(await exists(join(legacyRoot, 'config.json'))).toBe(true)
  })

  test('migrates into an empty destination left behind by something else', async () => {
    // The case that actually bit: a stray `~/.keylimepi/apps` is enough to create the
    // destination, and a migration keyed on mere existence would strand the real
    // workspace next door — the app opening with no apps, history or settings.
    await mkdir(join(root, 'apps'), { recursive: true })
    await seedLegacyApp({ under: legacyRoot, id: 'weather' })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"qwen"}')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.movedWorkspace).toBe(true)
    expect(result.migratedApps).toEqual(['weather'])
    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"qwen"}')
    expect(await exists(join(root, 'apps', 'weather', '.keylimepi-meta.json'))).toBe(true)
    expect(await exists(legacyRoot)).toBe(false)
  })

  test('merges an apps directory that exists on both sides', async () => {
    await seedLegacyApp({ under: root, id: 'already-here' })
    await seedLegacyApp({ under: legacyRoot, id: 'incoming' })

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(await exists(join(root, 'apps', 'already-here'))).toBe(true)
    expect(await exists(join(root, 'apps', 'incoming'))).toBe(true)
    expect(await exists(legacyRoot)).toBe(false)
  })

  test("renames each app's metadata file and commits the rename", async () => {
    await seedLegacyApp({ under: legacyRoot, id: 'weather' })

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.migratedApps).toEqual(['weather'])

    const appPath = join(root, 'apps', 'weather')
    expect(await exists(join(appPath, '.keylimepi-meta.json'))).toBe(true)
    expect(await exists(join(appPath, '.anyapp-meta.json'))).toBe(false)

    // The whole point of committing: the app must not be left dirty.
    expect(await dirtyPaths(appPath)).toEqual([])

    // Found by message rather than by position: a migration is several independent
    // repairs and any of the others may legitimately commit after this one.
    const log = await git.log({ fs, dir: appPath })
    const rename = log.find((entry) => entry.commit.message.includes('Key Lime Pi rebrand'))
    expect(rename).toBeDefined()
    expect(rename?.commit.author.name).toBe('Key Lime Pi Agent')
  })

  test('migrates every app, and leaves already-migrated ones alone', async () => {
    await seedLegacyApp({ under: legacyRoot, id: 'weather' })
    await seedLegacyApp({ under: legacyRoot, id: 'notes' })

    const first = await migrateWorkspace({ legacyRoots: [legacyRoot], root })
    expect(first.migratedApps.sort()).toEqual(['notes', 'weather'])

    // A second pass finds nothing to do and adds no further commits.
    const before = await git.log({ fs, dir: join(root, 'apps', 'weather') })
    const second = await migrateWorkspace({ legacyRoots: [legacyRoot], root })
    const after = await git.log({ fs, dir: join(root, 'apps', 'weather') })

    expect(second.migratedApps).toEqual([])
    expect(after.length).toBe(before.length)
  })

  test('finishes the app pass when an earlier run moved the directory but stopped', async () => {
    // An interrupted migration: the directory is already at its new name, but an app
    // inside it still carries the pre-rebrand metadata file.
    await seedLegacyApp({ under: root, id: 'weather' })

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.movedWorkspace).toBe(false)
    expect(result.migratedApps).toEqual(['weather'])
    expect(await exists(join(root, 'apps', 'weather', '.keylimepi-meta.json'))).toBe(true)
  })

  test('still renames the metadata file when the app has no git repository', async () => {
    const appPath = join(legacyRoot, 'apps', 'bare')
    await mkdir(appPath, { recursive: true })
    await writeFile(join(appPath, '.anyapp-meta.json'), '{"id":"bare"}')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.migratedApps).toEqual(['bare'])
    expect(await exists(join(root, 'apps', 'bare', '.keylimepi-meta.json'))).toBe(true)
  })

  test('tolerates a workspace with no apps directory', async () => {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{}')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.movedWorkspace).toBe(true)
    expect(result.migratedApps).toEqual([])
  })

  test('leaves a non-app entry under apps/ alone', async () => {
    await mkdir(join(legacyRoot, 'apps', 'not-an-app'), { recursive: true })
    await writeFile(join(legacyRoot, 'apps', 'not-an-app', 'stray.txt'), 'hello')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.migratedApps).toEqual([])
    expect(await exists(join(root, 'apps', 'not-an-app', 'stray.txt'))).toBe(true)
  })
})

describe('rewriteTranscriptCwd', () => {
  const from = '/Users/someone/.anyapp/apps/moon-phase'
  const to = '/Users/someone/.keylimepi/apps/moon-phase'

  test('rewrites the recorded cwd and leaves the body byte-identical', () => {
    const body =
      '{"type":"message","id":"m1","message":{"role":"user","content":"hi — \\"quoted\\""}}\n'
    const raw = `${JSON.stringify({ type: 'session', version: 3, id: 'a', cwd: from })}\n${body}`

    const out = rewriteTranscriptCwd({ raw, from, to })

    expect(JSON.parse(out.slice(0, out.indexOf('\n'))).cwd).toBe(to)
    // The conversation itself is what must survive untouched: Pi's branch links resolve
    // against the ids in these lines.
    expect(out.slice(out.indexOf('\n') + 1)).toBe(body)
  })

  test('preserves the header fields it is not there to change', () => {
    const header = { type: 'session', version: 3, id: 'a', timestamp: 'ts', cwd: from }
    const raw = `${JSON.stringify(header)}\n`

    const parsed = JSON.parse(rewriteTranscriptCwd({ raw, from, to }).trim())

    expect(parsed).toEqual({ ...header, cwd: to })
  })

  test('leaves a header naming some other directory alone', () => {
    // Only the path this app actually used to live at is rewritten. Anything else is a
    // transcript that belongs somewhere the migration knows nothing about.
    const raw = `${JSON.stringify({ type: 'session', cwd: '/elsewhere' })}\n`

    expect(rewriteTranscriptCwd({ raw, from, to })).toBe(raw)
  })

  test('leaves a file it cannot parse alone rather than dropping it', () => {
    const raw = 'not json at all\nsecond line\n'

    expect(rewriteTranscriptCwd({ raw, from, to })).toBe(raw)
  })

  test('tolerates a header with no trailing newline', () => {
    const raw = JSON.stringify({ type: 'session', cwd: from })

    expect(JSON.parse(rewriteTranscriptCwd({ raw, from, to })).cwd).toBe(to)
  })
})

describe('migrateWorkspace: chat transcripts', () => {
  test("moves a migrated app's transcripts into the directory it now reads", async () => {
    // The defect this covers: renaming the workspace changed the app's absolute path,
    // which changed the slug Key Lime Pi derives a session directory from *and* invalidated
    // the cwd recorded inside every transcript. Both have to be fixed or the history is
    // invisible, so the assertion is Pi's own listing rather than the file's location.
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    const agentDir = agentDirFor(legacyRoot)
    await seedTranscript({ agentDir, appPath: legacyAppPath, id: 'sess-1', userText: 'one' })
    await seedTranscript({ agentDir, appPath: legacyAppPath, id: 'sess-2', userText: 'two' })

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const appPath = join(root, 'apps', 'moon-phase')
    expect(result.migratedSessions).toEqual(['moon-phase'])
    expect(
      (await listedSessionIds({ agentDir: agentDirFor(root), appPath })).sort()
    ).toEqual(['sess-1', 'sess-2'])
  })

  test('the transcript is readable, not merely listed', async () => {
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'sess-1',
      userText: 'the message that must survive'
    })

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const appPath = join(root, 'apps', 'moon-phase')
    const dir = getAppSessionDir({ agentDir: agentDirFor(root), appPath })
    const [info] = await SessionManager.list(appPath, dir)
    expect(info.firstMessage).toContain('the message that must survive')
  })

  test('leaves the legacy session directory empty and gone', async () => {
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    const legacyDir = getAppSessionDir({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath
    })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'sess-1',
      userText: 'one'
    })

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(await exists(legacyDir)).toBe(false)
  })

  test('never overwrites a transcript the live directory already has', async () => {
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'sess-1',
      userText: 'stale'
    })

    // The same filename already present at the destination, holding the live copy.
    const appPath = join(root, 'apps', 'moon-phase')
    await seedTranscript({
      agentDir: agentDirFor(root),
      appPath,
      id: 'sess-1',
      userText: 'live'
    })

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const dir = getAppSessionDir({ agentDir: agentDirFor(root), appPath })
    const [info] = await SessionManager.list(appPath, dir)
    expect(info.firstMessage).toContain('live')
  })

  test('is a no-op on the second run', async () => {
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'sess-1',
      userText: 'one'
    })

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })
    const second = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(second.migratedSessions).toEqual([])
    // And the run that did nothing did not cost the app its history.
    expect(
      await listedSessionIds({ agentDir: agentDirFor(root), appPath: join(root, 'apps', 'moon-phase') })
    ).toEqual(['sess-1'])
  })

  test('finishes the transcripts when an earlier run moved the directory but stopped', async () => {
    // An install that ran a version of this file predating the transcript pass: the
    // workspace is already at its new name and the transcripts are still orphaned.
    const appPath = join(root, 'apps', 'moon-phase')
    await mkdir(appPath, { recursive: true })
    await writeFile(join(appPath, META_FILE), JSON.stringify({ id: 'moon-phase' }))
    await seedTranscript({
      agentDir: agentDirFor(root),
      appPath: join(legacyRoot, 'apps', 'moon-phase'),
      id: 'sess-1',
      userText: 'one'
    })

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.movedWorkspace).toBe(false)
    expect(result.migratedSessions).toEqual(['moon-phase'])
    expect(await listedSessionIds({ agentDir: agentDirFor(root), appPath })).toEqual(['sess-1'])
  })
})

describe('migrateWorkspace: .gitignore backfill', () => {
  test('gives an app scaffolded without one the default, and commits it', async () => {
    await seedLegacyApp({ under: legacyRoot, id: 'magic-8-ball' })

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const appPath = join(root, 'apps', 'magic-8-ball')
    expect(result.backfilledGitignore).toEqual(['magic-8-ball'])
    expect(await readFile(join(appPath, '.gitignore'), 'utf-8')).toContain('node_modules/')
    // Committed, for the reason the metadata rename is: `initGitRepo` tracks everything,
    // so an uncommitted file reports as a change forever — the state being fixed.
    expect(await dirtyPaths(appPath)).toEqual([])
  })

  test('the backfill is what makes git_status small again', async () => {
    // The measurable point of the whole step. Without a `.gitignore`, `statusMatrix`
    // reports every untracked dependency as a change.
    const appPath = await seedLegacyApp({ under: legacyRoot, id: 'magic-8-ball' })
    await mkdir(join(appPath, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(appPath, 'node_modules', 'pkg', 'index.js'), 'x\n')

    const before = await dirtyPaths(appPath)
    await migrateWorkspace({ legacyRoots: [legacyRoot], root })
    const after = await dirtyPaths(join(root, 'apps', 'magic-8-ball'))

    expect(before).toContain('node_modules/pkg/index.js')
    expect(after).toEqual([])
  })

  test('never rewrites a .gitignore the app already has', async () => {
    const appPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    await writeFile(join(appPath, '.gitignore'), 'just-this\n')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.backfilledGitignore).toEqual([])
    expect(await readFile(join(root, 'apps', 'moon-phase', '.gitignore'), 'utf-8')).toBe(
      'just-this\n'
    )
  })

  test('still writes the file when the app has no git repository', async () => {
    const appPath = join(legacyRoot, 'apps', 'half-scaffolded')
    await mkdir(appPath, { recursive: true })
    await writeFile(join(appPath, '.anyapp-meta.json'), JSON.stringify({ id: 'half-scaffolded' }))

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.backfilledGitignore).toEqual(['half-scaffolded'])
  })
})

describe('migrateWorkspace: active-session pointer', () => {
  test("clears a pointer naming a session the app does not have", async () => {
    // The misalignment found on a real install: one app's pointer holding another app's
    // session id, which `loadManifest` masks on read and therefore never corrects.
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'pony-pony-pony' })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'mine',
      userText: 'one'
    })
    await writeFile(
      join(legacyAppPath, '.chat-sessions.json'),
      JSON.stringify({ activeSessionId: 'belongs-to-another-app' })
    )

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const pointer = join(root, 'apps', 'pony-pony-pony', '.chat-sessions.json')
    expect(result.repairedPointers).toEqual(['pony-pony-pony'])
    expect(JSON.parse(await readFile(pointer, 'utf-8')).activeSessionId).toBeNull()
  })

  test("leaves a pointer that names one of the app's own sessions alone", async () => {
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'sess-1',
      userText: 'one'
    })
    await writeFile(
      join(legacyAppPath, '.chat-sessions.json'),
      JSON.stringify({ activeSessionId: 'sess-1' })
    )

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const pointer = join(root, 'apps', 'moon-phase', '.chat-sessions.json')
    expect(result.repairedPointers).toEqual([])
    expect(JSON.parse(await readFile(pointer, 'utf-8')).activeSessionId).toBe('sess-1')
  })

  test('runs after the transcripts, so a restored session keeps its pointer', async () => {
    // Ordering matters: before the transcript pass every pre-rebrand pointer names a
    // session the app cannot yet see, so repairing first would clear all of them.
    const legacyAppPath = await seedLegacyApp({ under: legacyRoot, id: 'moon-phase' })
    await seedTranscript({
      agentDir: agentDirFor(legacyRoot),
      appPath: legacyAppPath,
      id: 'restored',
      userText: 'one'
    })
    await writeFile(
      join(legacyAppPath, '.chat-sessions.json'),
      JSON.stringify({ activeSessionId: 'restored' })
    )

    await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    const pointer = join(root, 'apps', 'moon-phase', '.chat-sessions.json')
    expect(JSON.parse(await readFile(pointer, 'utf-8')).activeSessionId).toBe('restored')
  })
})

describe('migrateWorkspace: restraint', () => {
  test('touches nothing inside a non-app directory under apps/', async () => {
    // The new passes all *write* into the app — a `.gitignore`, a commit, a pointer — so
    // what identifies an app has to be the metadata file rather than mere location.
    await mkdir(join(legacyRoot, 'apps', 'not-an-app'), { recursive: true })
    await writeFile(join(legacyRoot, 'apps', 'not-an-app', 'stray.txt'), 'hello')

    const result = await migrateWorkspace({ legacyRoots: [legacyRoot], root })

    expect(result.backfilledGitignore).toEqual([])
    expect(result.migratedSessions).toEqual([])
    expect(result.repairedPointers).toEqual([])
    expect(await exists(join(root, 'apps', 'not-an-app', '.gitignore'))).toBe(false)
    expect(await exists(join(root, 'apps', 'not-an-app', 'stray.txt'))).toBe(true)
  })
})


describe('the rename chain', () => {
  test('the legacy roots are ordered newest first', () => {
    // Load-bearing, not cosmetic: `moveMissingEntries` never overwrites, so the root
    // merged first wins every collision. Verified by the collision test below, which
    // fails outright if this array is reversed.
    expect(LEGACY_WORKSPACE_DIRS).toEqual(['.pitaster', '.anyapp'])
    expect(LEGACY_META_FILES).toEqual(['.pitaster-meta.json', '.anyapp-meta.json'])
  })

  test('carries a Pi Taster-era install to the current name in one launch', async () => {
    const legacyAppPath = await seedLegacyApp({
      under: pitasterRoot,
      id: 'moon-phase',
      metaFile: '.pitaster-meta.json'
    })
    await seedTranscript({
      agentDir: agentDirFor(pitasterRoot),
      appPath: legacyAppPath,
      id: 'sess-1',
      userText: 'what phase is the moon in'
    })

    const result = await migrateWorkspace({ legacyRoots: allLegacyRoots(), root })

    const appPath = join(root, 'apps', 'moon-phase')
    expect(result.movedWorkspace).toBe(true)
    expect(result.migratedApps).toEqual(['moon-phase'])
    expect(result.migratedSessions).toEqual(['moon-phase'])
    expect(await exists(join(appPath, META_FILE))).toBe(true)
    expect(await exists(join(appPath, '.pitaster-meta.json'))).toBe(false)

    // Through Pi's own listing, not the file's location: the header `cwd` names the old
    // path until it is rewritten, and a transcript Pi will not list is a lost chat.
    expect(
      await listedSessionIds({ agentDir: agentDirFor(root), appPath })
    ).toEqual(['sess-1'])

    // The metadata rename must be committed, or the app opens permanently dirty.
    expect(await dirtyPaths(appPath)).toEqual([])
  })

  test('drains an anyapp-era and a Pi Taster-era app in the same launch', async () => {
    await seedLegacyApp({ under: legacyRoot, id: 'old-one' })
    await seedLegacyApp({
      under: pitasterRoot,
      id: 'newer-one',
      metaFile: '.pitaster-meta.json'
    })

    const result = await migrateWorkspace({ legacyRoots: allLegacyRoots(), root })

    expect(result.migratedApps.sort()).toEqual(['newer-one', 'old-one'])
    expect(await exists(join(root, 'apps', 'old-one', META_FILE))).toBe(true)
    expect(await exists(join(root, 'apps', 'newer-one', META_FILE))).toBe(true)
  })

  test('keeps the newer copy when both legacy roots hold the same file', async () => {
    // `moveMissingEntries` fills gaps and never overwrites, so whichever root is merged
    // first wins. This asserts the loop order is newest-first: getting it backwards
    // silently restores an abandoned `~/.anyapp` over the workspace actually in use.
    await mkdir(legacyRoot, { recursive: true })
    await mkdir(pitasterRoot, { recursive: true })
    await writeFile(join(legacyRoot, 'config.json'), '{"model":"stale"}')
    await writeFile(join(pitasterRoot, 'config.json'), '{"model":"current"}')

    await migrateWorkspace({ legacyRoots: allLegacyRoots(), root })

    expect(await readFile(join(root, 'config.json'), 'utf-8')).toBe('{"model":"current"}')
  })

  test('leaves a current metadata file alone when an older one sits beside it', async () => {
    const appPath = await seedLegacyApp({ under: pitasterRoot, id: 'weather' })
    await writeFile(join(appPath, META_FILE), JSON.stringify({ id: 'weather', kept: true }))

    await migrateWorkspace({ legacyRoots: allLegacyRoots(), root })

    const migrated = join(root, 'apps', 'weather', META_FILE)
    expect(JSON.parse(await readFile(migrated, 'utf-8')).kept).toBe(true)
  })
})

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true })
})
