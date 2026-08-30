/**
 * The anyapp mark.
 *
 * A rounded-square aperture with a second, offset square breaking through its
 * lower-right corner: an app that contains and reshapes apps. The aperture's
 * stroke is cut away where the inner square crosses it, so the inner square
 * reads as sitting in front of — and extending past — its container.
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
  /** The aperture stroke. `--color-brass`. */
  brass: '#d2a24c',
  /** The inner square. `--color-patina`. */
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

  // Mark geometry, centred in the tile and sized to about 54% of it.
  const mark = tileSize * 0.54
  const unit = mark / 24
  const originX = tileInset + (tileSize - mark) / 2
  const originY = tileInset + (tileSize - mark) / 2
  const at = (n: number): number => Math.round((originX + n * unit) * 100) / 100
  const av = (n: number): number => Math.round((originY + n * unit) * 100) / 100
  const u = (n: number): number => Math.round(n * unit * 100) / 100

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<mask id="anyapp-aperture">`,
    `<rect width="${size}" height="${size}" fill="#fff"/>`,
    `<rect x="${at(11.35)}" y="${av(11.35)}" width="${u(10.8)}" height="${u(10.8)}" rx="${u(3.55)}" fill="#000"/>`,
    `</mask>`,
    `<rect x="${tileInset}" y="${tileInset}" width="${tileSize}" height="${tileSize}" rx="${tileRadius}" fill="${LOGO_COLORS.tile}"/>`,
    `<rect x="${at(2.5)}" y="${av(2.5)}" width="${u(15)}" height="${u(15)}" rx="${u(4)}"`,
    ` fill="none" stroke="${LOGO_COLORS.brass}" stroke-width="${u(2.5)}" mask="url(#anyapp-aperture)"/>`,
    `<rect x="${at(12.5)}" y="${av(12.5)}" width="${u(8.5)}" height="${u(8.5)}" rx="${u(2.4)}" fill="${LOGO_COLORS.patina}"/>`,
    `</svg>`
  ].join('')
}
