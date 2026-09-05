/**
 * The Pi Taster mark.
 *
 * A slice of key lime pie shaped like π under a dollop of whipped cream, seen
 * isometrically. The app is a place to taste Pi on local models, and the mark is
 * the thing being tasted.
 *
 * The renderer draws the bare mark as JSX in `components/Logo.tsx`, which carries
 * the full account of the geometry — the four visible faces of the slab, why
 * draw order is the occlusion model, how the dollop's height is set against the
 * top face, why the counter stays empty, and why the silhouette centres on 11.7
 * rather than 12. This module builds the macOS dock tile: the same drawing, on a
 * rounded app tile with HIG padding. Keep the two in step — they are one drawing
 * at two scales.
 */

/**
 * Mark colors. These mirror the `@theme` tokens in the renderer's `globals.css`
 * and must be kept in step with them; the main process cannot read that file.
 */
export const LOGO_COLORS = {
  /** The cut face's filling. `--color-keylime`. */
  keylime: '#b7e081',
  /** Crust catching the light, and the graham base. `--color-brass`. */
  crust: '#d2a24c',
  /** Crust turned away from it. `--color-brass-deep`. */
  crustDeep: '#96702f',
  /** The dollop. `--color-cream`. */
  cream: '#f4ecdc',
  /** Its underside. `--color-cream-shade`. */
  creamShade: '#cfc0a2',
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

  // Mark geometry, centred in the tile and sized to about 62% of it. The unit is
  // one step of `Logo.tsx`'s 24-unit viewBox, so every number below is that file's
  // number unchanged — which is what keeps the two drawings identical.
  //
  // This fraction is not a measure of how big the mark looks; it scales the whole
  // 24-unit box, and the drawing fills 81% of that box's width. The stroked π it
  // replaced filled about 70% at a fraction of 0.64, so a similar apparent size
  // needs a smaller number here, not a larger one.
  const mark = tileSize * 0.62
  const unit = mark / 24
  const originX = tileInset + (tileSize - mark) / 2
  const originY = tileInset + (tileSize - mark) / 2
  const at = (n: number): number => Math.round((originX + n * unit) * 100) / 100
  const av = (n: number): number => Math.round((originY + n * unit) * 100) / 100
  const u = (n: number): number => Math.round(n * unit * 100) / 100

  const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string): string =>
    `<ellipse cx="${at(cx)}" cy="${av(cy)}" rx="${u(rx)}" ry="${u(ry)}" fill="${fill}"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect x="${tileInset}" y="${tileInset}" width="${tileSize}" height="${tileSize}" rx="${tileRadius}" fill="${LOGO_COLORS.tile}"/>`,
    // Crust, lit: the bar's top surface.
    `<path d="M${at(2.23)} ${av(6.15)}L${at(18.82)} ${av(6.15)}L${at(21.77)} ${av(4.68)}L${at(5.17)} ${av(4.68)}Z" fill="${LOGO_COLORS.crust}"/>`,
    // Crust, in shadow: three right-facing walls. The third is the counter wall.
    `<g fill="${LOGO_COLORS.crustDeep}">`,
    `<path d="M${at(18.82)} ${av(6.15)}L${at(18.82)} ${av(9.09)}L${at(21.77)} ${av(7.62)}L${at(21.77)} ${av(4.68)}Z"/>`,
    `<path d="M${at(16.2)} ${av(9.09)}L${at(16.2)} ${av(21.9)}L${at(19.14)} ${av(20.43)}L${at(19.14)} ${av(7.62)}Z"/>`,
    `<path d="M${at(7.59)} ${av(9.09)}L${at(7.59)} ${av(21.9)}L${at(10.53)} ${av(20.43)}L${at(10.53)} ${av(7.62)}Z"/>`,
    `</g>`,
    // The cut face: filling above, graham base below. Drawn after the walls —
    // draw order is the occlusion model, and drawing this first opens two seams.
    `<path d="M${at(2.23)} ${av(6.15)}H${at(18.82)}V${av(9.09)}H${at(16.2)}V${av(17.7)}`,
    `H${at(13.47)}V${av(9.09)}H${at(7.59)}V${av(17.7)}H${at(4.86)}V${av(9.09)}H${at(2.23)}Z"`,
    ` fill="${LOGO_COLORS.keylime}"/>`,
    `<g fill="${LOGO_COLORS.crust}">`,
    `<path d="M${at(4.86)} ${av(17.7)}L${at(7.59)} ${av(17.7)}L${at(7.59)} ${av(21.9)}L${at(4.86)} ${av(21.9)}Z"/>`,
    `<path d="M${at(13.47)} ${av(17.7)}L${at(16.2)} ${av(17.7)}L${at(16.2)} ${av(21.9)}L${at(13.47)} ${av(21.9)}Z"/>`,
    `</g>`,
    // The dollop: underside, three tiers, then the peak.
    ellipse(12.31, 6.46, 3.55, 1.47, LOGO_COLORS.creamShade),
    `<g fill="${LOGO_COLORS.cream}">`,
    ellipse(11.88, 5.85, 3.43, 1.41, LOGO_COLORS.cream),
    ellipse(12, 4.56, 2.51, 1.16, LOGO_COLORS.cream),
    ellipse(12.24, 3.46, 1.59, 0.92, LOGO_COLORS.cream),
    `<path d="M${at(11.84)} ${av(3.15)}C${at(12.14)} ${av(2.05)} ${at(12.74)} ${av(1.68)} ${at(13.34)} ${av(1.56)}`,
    `C${at(13.14)} ${av(2.42)} ${at(13.14)} ${av(2.91)} ${at(13.09)} ${av(3.34)}Z"/>`,
    `</g>`,
    `</svg>`
  ].join('')
}
