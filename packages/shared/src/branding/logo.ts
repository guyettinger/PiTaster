/**
 * The Pi Taster mark.
 *
 * A brass π on flared feet, holding a patina drop. The π is the agent — this app is
 * a place to taste Pi running on local models — and the splay of its feet, with the
 * bar above, reads as a footed vessel holding the drop. The drop is the sample.
 *
 * The renderer draws the bare mark as JSX in `components/Logo.tsx`. This module
 * builds the macOS dock tile: the same geometry, on a rounded app tile with HIG
 * padding. Keep the two in step — they are one drawing at two scales.
 */

/**
 * Mark colors. These mirror the `@theme` tokens in the renderer's `globals.css`
 * and must be kept in step with them; the main process cannot read that file.
 */
export const LOGO_COLORS = {
  /** The π stroke. `--color-brass`. */
  brass: '#d2a24c',
  /** The drop. `--color-patina`. */
  patina: '#6fa292',
  /** The dock tile ground. `--color-panel`. */
  tile: '#191b1f'
} as const

/**
 * Options for {@link dockIconSvg}.
 */
export interface DockIconOptions {
  /** Canvas edge length in pixels. Defaults to 1024, the size macOS wants. */
  size?: number
}

/**
 * Builds the macOS dock icon as an SVG document.
 *
 * The tile is inset from the canvas by ~10% per the macOS HIG, so the icon does
 * not visually overflow its neighbours in the dock.
 *
 * @param options - Canvas sizing
 * @returns A complete, standalone SVG document
 */
export function dockIconSvg({ size = 1024 }: DockIconOptions = {}): string {
  // Tile geometry, expressed as fractions of the canvas so any size works.
  const tileInset = size * 0.098
  const tileSize = size - tileInset * 2
  const tileRadius = tileSize * 0.225

  // Mark geometry, centred in the tile and sized to about 64% of it. The unit is
  // one step of `Logo.tsx`'s 24-unit viewBox, so every number below is that file's
  // number unchanged — which is what keeps the two drawings identical.
  const mark = tileSize * 0.64
  const unit = mark / 24
  const originX = tileInset + (tileSize - mark) / 2
  const originY = tileInset + (tileSize - mark) / 2
  const at = (n: number): number => Math.round((originX + n * unit) * 100) / 100
  const av = (n: number): number => Math.round((originY + n * unit) * 100) / 100
  const u = (n: number): number => Math.round(n * unit * 100) / 100

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect x="${tileInset}" y="${tileInset}" width="${tileSize}" height="${tileSize}" rx="${tileRadius}" fill="${LOGO_COLORS.tile}"/>`,
    `<g fill="none" stroke="${LOGO_COLORS.brass}" stroke-width="${u(2.5)}"`,
    ` stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="M${at(4.6)} ${av(7)}H${at(19.4)}"/>`,
    `<path d="M${at(8.6)} ${av(8.8)}C${at(8.6)} ${av(13)} ${at(8.2)} ${av(15.6)} ${at(7.3)} ${av(17.6)}"/>`,
    `<path d="M${at(15.4)} ${av(8.8)}C${at(15.4)} ${av(13)} ${at(15.8)} ${av(15.6)} ${at(16.7)} ${av(17.6)}"/>`,
    `</g>`,
    `<circle cx="${at(12)}" cy="${av(14.1)}" r="${u(2.7)}" fill="${LOGO_COLORS.patina}"/>`,
    `</svg>`
  ].join('')
}
