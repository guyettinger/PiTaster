/**
 * The Pi Taster mark.
 *
 * A slice of key lime pie shaped like π under a dollop of whipped cream, seen
 * isometrically. The app is a place to taste Pi on local models, and the mark is
 * the thing being tasted.
 *
 * The renderer draws the bare mark as JSX in `components/Logo.tsx`, which carries
 * the full account of the geometry — the block grid every dimension sits on, the
 * four visible faces of the slab, why each of them splits into a filling strip
 * and a crust strip along the depth, why draw order is the occlusion model, why
 * the dollop is centred on its bounding box rather than on any one ellipse, and
 * why the counter is four blocks wide against two blocks of depth. This module
 * builds the macOS dock tile: the same
 * drawing, on a rounded app tile with HIG padding. Keep the two in step — they
 * are one drawing at two scales.
 */

/**
 * Mark colors. These mirror the `@theme` tokens in the renderer's `globals.css`
 * and must be kept in step with them; the main process cannot read that file.
 */
export const LOGO_COLORS = {
  /** The cut face's filling. `--color-keylime`. */
  keylime: '#b7e081',
  /** The same filling on the top face, facing the light. `--color-keylime-lit`. */
  keylimeLit: '#cbe89e',
  /** The same filling on a wall turned away from it. `--color-keylime-deep`. */
  keylimeDeep: '#8ab35c',
  /** Crust catching the light: the top's far row, and the graham base. `--color-brass`. */
  crust: '#c69340',
  /** Crust turned away from it: the slab's far depth row and the base's walls. `--color-brass-deep`. */
  crustDeep: '#8a662a',
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

  // Mark geometry, centred in the tile and sized to about 59% of it. The unit is
  // one step of `Logo.tsx`'s 24-unit viewBox, so every number below is that file's
  // number unchanged — which is what keeps the two drawings identical.
  //
  // This fraction is not a measure of how big the mark looks; it scales the whole
  // 24-unit box, and the drawing fills 85% of that box. It was 0.62 while the
  // drawing filled 81%, and the product of the two is what the eye reads — so
  // deepening the slab, which widened the silhouette, had to be paid for here.
  const mark = tileSize * 0.59
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
    // The top face, far depth row: crust — the pie's rim.
    `<path d="M${at(3.84)} ${av(8.53)}L${at(20.16)} ${av(8.53)}L${at(22.2)} ${av(7.51)}L${at(5.88)} ${av(7.51)}Z" fill="${LOGO_COLORS.crust}"/>`,
    // …and its near row: filling, lifted so the bar's front top edge reads.
    `<path d="M${at(1.8)} ${av(9.55)}L${at(18.12)} ${av(9.55)}L${at(20.16)} ${av(8.53)}L${at(3.84)} ${av(8.53)}Z" fill="${LOGO_COLORS.keylimeLit}"/>`,
    // The far depth row of every wall is crust, top to foot — and so is the near
    // row below the base line. Drawn before the near row, which overlaps it.
    `<g fill="${LOGO_COLORS.crustDeep}">`,
    `<path d="M${at(7.92)} ${av(10.57)}L${at(7.92)} ${av(20.77)}L${at(9.96)} ${av(19.75)}L${at(9.96)} ${av(9.55)}Z"/>`,
    `<path d="M${at(18.12)} ${av(10.57)}L${at(18.12)} ${av(20.77)}L${at(20.16)} ${av(19.75)}L${at(20.16)} ${av(9.55)}Z"/>`,
    `<path d="M${at(20.16)} ${av(8.53)}L${at(20.16)} ${av(10.57)}L${at(22.2)} ${av(9.55)}L${at(22.2)} ${av(7.51)}Z"/>`,
    `<path d="M${at(5.88)} ${av(19.75)}L${at(5.88)} ${av(21.79)}L${at(7.92)} ${av(20.77)}L${at(7.92)} ${av(18.73)}Z"/>`,
    `<path d="M${at(16.08)} ${av(19.75)}L${at(16.08)} ${av(21.79)}L${at(18.12)} ${av(20.77)}L${at(18.12)} ${av(18.73)}Z"/>`,
    `</g>`,
    // The near depth row above the base line is filling. The first is the counter
    // wall; the third covers the top of the right leg's far strip.
    `<g fill="${LOGO_COLORS.keylimeDeep}">`,
    `<path d="M${at(5.88)} ${av(11.59)}L${at(5.88)} ${av(19.75)}L${at(7.92)} ${av(18.73)}L${at(7.92)} ${av(10.57)}Z"/>`,
    `<path d="M${at(16.08)} ${av(11.59)}L${at(16.08)} ${av(19.75)}L${at(18.12)} ${av(18.73)}L${at(18.12)} ${av(10.57)}Z"/>`,
    `<path d="M${at(18.12)} ${av(9.55)}L${at(18.12)} ${av(11.59)}L${at(20.16)} ${av(10.57)}L${at(20.16)} ${av(8.53)}Z"/>`,
    `</g>`,
    // The cut face: filling above, graham base below. Drawn after the walls —
    // draw order is the occlusion model, and drawing this first opens two seams.
    `<path d="M${at(1.8)} ${av(9.55)}H${at(18.12)}V${av(11.59)}H${at(16.08)}V${av(19.75)}`,
    `H${at(14.04)}V${av(11.59)}H${at(5.88)}V${av(19.75)}H${at(3.84)}V${av(11.59)}H${at(1.8)}Z"`,
    ` fill="${LOGO_COLORS.keylime}"/>`,
    `<g fill="${LOGO_COLORS.crust}">`,
    `<path d="M${at(3.84)} ${av(19.75)}L${at(5.88)} ${av(19.75)}L${at(5.88)} ${av(21.79)}L${at(3.84)} ${av(21.79)}Z"/>`,
    `<path d="M${at(14.04)} ${av(19.75)}L${at(16.08)} ${av(19.75)}L${at(16.08)} ${av(21.79)}L${at(14.04)} ${av(21.79)}Z"/>`,
    `</g>`,
    // The dollop: underside, three tiers, then the peak.
    ellipse(12.17, 7.7, 3.98, 1.65, LOGO_COLORS.creamShade),
    `<g fill="${LOGO_COLORS.cream}">`,
    ellipse(11.69, 7.02, 3.84, 1.58, LOGO_COLORS.cream),
    ellipse(11.82, 5.57, 2.81, 1.3, LOGO_COLORS.cream),
    ellipse(12.09, 4.34, 1.78, 1.03, LOGO_COLORS.cream),
    `<path d="M${at(11.64)} ${av(3.99)}C${at(11.98)} ${av(2.76)} ${at(12.65)} ${av(2.34)} ${at(13.32)} ${av(2.21)}`,
    `C${at(13.1)} ${av(3.17)} ${at(13.1)} ${av(3.72)} ${at(13.04)} ${av(4.2)}Z"/>`,
    `</g>`,
    `</svg>`
  ].join('')
}
