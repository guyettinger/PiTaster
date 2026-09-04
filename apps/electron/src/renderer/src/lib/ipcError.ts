/**
 * Making an IPC rejection worth showing to a person.
 */

/**
 * Strip Electron's wrapper from an IPC rejection.
 *
 * `ipcRenderer.invoke` rethrows a handler's error as
 * `Error invoking remote method 'agent:compact': Error: Nothing to compact`. The part
 * worth showing is the last clause — the handlers on the other side write messages
 * meant for a person, and the channel name in front of them is noise.
 *
 * Shared rather than copied because every `invoke` in the renderer rejects in this
 * shape, and a second copy would be one more place for the pattern to fall out of step
 * with Electron's wording.
 *
 * @param caught - The rejection
 * @returns A message worth putting in the UI
 */
export function readableError(caught: unknown): string {
  const message = (caught as Error)?.message ?? String(caught)
  return message.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}
