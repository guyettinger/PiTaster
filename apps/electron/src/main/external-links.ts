/**
 * The single place that decides which URLs may leave the app.
 *
 * Markdown in the chat transcript is written by the model, so every link the
 * renderer can act on is agent-authored and therefore untrusted. Both routes
 * out — the `shell:open-external` IPC handler and the window's
 * `setWindowOpenHandler` — go through `openExternalUrl` here, so there is one
 * definition of "safe to hand to the OS" rather than two that can drift.
 */

import { shell } from 'electron'

/** Upper bound on a URL we will even parse. Well past any real link. */
const MAX_URL_LENGTH = 2048

/** The only schemes the OS handler may ever receive. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Whether a value from the renderer is a URL we are willing to open.
 *
 * Rejects anything that is not a parseable absolute `http:`/`https:` URL —
 * notably `file:`, `javascript:`, and `data:`, which are the schemes that turn
 * an external-link affordance into code execution or local file disclosure.
 * @param url - Untrusted candidate, straight off the IPC boundary
 * @returns True when the URL may be passed to the OS
 */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false

  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    // Not an absolute URL. Relative links have no meaning outside the app.
    return false
  }
}

/**
 * Opens a URL in the user's browser if — and only if — it passes
 * {@link isSafeExternalUrl}.
 * @param url - Untrusted candidate, straight off the IPC boundary
 * @throws {Error} If the URL is not an absolute `http:` or `https:` URL
 */
export async function openExternalUrl(url: unknown): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    throw new Error('Only absolute http: and https: URLs can be opened')
  }

  await shell.openExternal(url)
}
