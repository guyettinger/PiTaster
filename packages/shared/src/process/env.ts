/**
 * Environment filtering for spawned subprocesses.
 *
 * Every child process anyapp spawns — MCP servers, `bun install`, anything the
 * agent can reach — inherits the Electron main process environment unless it is
 * filtered first. That environment can hold the user's API keys and tokens, none
 * of which any subprocess needs. One list, used everywhere, so a new spawn site
 * cannot quietly ship with a different idea of what counts as a secret.
 */

/**
 * Environment variables never passed to a subprocess.
 */
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_ORG_ID',
  'CLAUDE_API_KEY'
]

/**
 * Build a subprocess environment with sensitive variables removed.
 *
 * Values in `overrides` are applied after filtering, so a caller can deliberately
 * supply a credential a specific subprocess needs. Undefined entries in
 * `process.env` are dropped, which is what `child_process` expects.
 *
 * @param overrides - Extra variables to merge in after filtering
 * @returns A copy of the process environment safe to hand to a child process
 */
export function buildSubprocessEnv(
  overrides?: Record<string, string>
): Record<string, string> {
  const filtered: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (BLOCKED_ENV_VARS.includes(key)) continue
    filtered[key] = value
  }

  return { ...filtered, ...overrides }
}

/**
 * Whether a variable name is filtered out of subprocess environments.
 * Exposed so tests and audits can assert the policy without duplicating the list.
 *
 * @param name - The environment variable name to test
 * @returns True when the variable is withheld from subprocesses
 */
export function isBlockedEnvVar(name: string): boolean {
  return BLOCKED_ENV_VARS.includes(name)
}
