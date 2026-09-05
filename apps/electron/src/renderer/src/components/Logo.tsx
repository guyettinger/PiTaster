/**
 * Props for the Logo component.
 */
interface LogoProps {
  /** Edge length in pixels. Defaults to 22, the size the shell header uses. */
  size?: number
  /** Additional classes for the SVG root. */
  className?: string
}

/**
 * The Pi Taster mark: a slice of key lime pie shaped like π under a dollop of
 * whipped cream, seen isometrically.
 *
 * The π is a slab extruded back and to the right at the 2:1 slope, two blocks
 * deep, and **the far depth row is crust on every face it shows**. The face
 * turned toward you is the cut face — key lime filling on a graham base — and
 * the near row carries that same filling on its top and its right-facing walls.
 * The far row is the pie's rim: crust across the back of the top, crust down the
 * walls, running into the graham base. The name is the thesis: this is a place to
 * *taste* Pi on local models, so the mark is the thing being tasted.
 *
 * The colors are the app's own. Key lime is the accent everywhere in the UI —
 * the agent acting — and it is the filling here because the thing the mark is
 * *about* should be its largest surface. Brass did not leave when it stopped
 * being the accent; it became the crust, which is what it always looked like.
 *
 * ## Geometry
 *
 * Everything sits on a **block grid**. One block is 2.04 units of the 24-unit
 * viewBox, and every dimension below is a whole number of blocks — which is why
 * the numbers in the paths are all multiples of 2.04 off the origin (1.8, 9.55).
 * Reading a path, the landmarks are:
 *
 * | | x | | | y |
 * |---|---|---|---|---|
 * | slab left | 1.80 | | bar top | 9.55 |
 * | left leg | 3.84 – 5.88 | | bar bottom / legs | 11.59 |
 * | right leg | 14.04 – 16.08 | | filling ends / base | 19.75 |
 * | slab right | 18.12 | | foot | 21.79 |
 *
 * In blocks: a bar 8 wide and 1 thick, legs 1 wide under a 1-block overhang at
 * each end, a 4-block counter between them, filling running 4 blocks down the
 * legs, and a 1-block graham base at each foot. **Extrusion e = (2, -1) blocks**
 * — `(4.08, -2.04)` in units.
 *
 * **The counter and the extrusion are sized against each other**, and that is
 * the one proportion worth protecting. The counter wall's width on screen is
 * exactly `e.x`, so the background visible through the π is `counter - e.x`. At
 * two blocks of depth a two-block counter would leave *nothing* — the π closes
 * up into a slab with a notch. Four blocks of counter split it evenly, two of
 * wall and two of void, which is the same even split the one-block-deep mark
 * had and is what survives the 22px header.
 *
 * The whole drawing is scaled to fill 85% of the box and centred, which lands
 * the silhouette on x 1.8..22.2 and y 2.21..21.79 — centred on 12 both ways.
 *
 * ## Why exactly four extruded faces
 *
 * Walking the front-face path, four edges have an outward normal pointing up or
 * right, and those are the only ones the viewer can see: the bar's top, the
 * bar's right end, and the right-facing edge of each leg. Every other edge is
 * back-facing and is not drawn at all — which is why this mark needs no mask and
 * no `clip-path`.
 *
 * The fourth face is the one worth defending. It is the left leg's right-facing
 * wall, seen *through* the counter of the π, and it is what makes the slice read
 * as a solid rather than as a flat letter with a drop shadow.
 *
 * **Every visible face is two strips, one per depth row**, and only the near one
 * is filling. On a wall the far strip is `brass-deep` from the bar all the way to
 * the foot, so it runs into the graham base and the two read as one continuous
 * crust; the near strip is `keylime-deep` above the base line and `brass-deep`
 * below it, the same split the front face makes. The top face splits the same
 * way — `brass` across the back, `keylime-lit` in front of it. Drawing all of
 * this in brass was defensible while the slab was one block deep and the faces
 * were slivers; at two blocks they are a third of the mark, and crust on all of
 * them makes the pie read as solid crust with a green stripe painted on the
 * front.
 *
 * **The top's near strip needs its own green**, which is why `keylime-lit`
 * exists. It shares an edge with the front face, so drawing both in `keylime`
 * erases the bar's front top edge and the slab reads flat. Brass never needed a
 * third step because no lit brass surface touches a brass front face.
 *
 * **Draw order is the whole occlusion model**: the top's two strips, then the
 * walls' far row, then their near row, then the front face over both, then the
 * graham base, then the dollop. Far before near is what puts the bar's right-end
 * *near* strip over the top of the right leg's *far* strip — the only place two
 * strips overlap, and a place where two different colors meet, so getting it
 * backwards paints crust over filling. The bar's front face is what covers the
 * part of the counter wall which rises behind it; draw it first and that seam
 * opens. The top strips go first of all: they meet every wall edge-to-edge and
 * overlap none.
 *
 * ## The dollop goes on the bar, never in the counter
 *
 * It is four stacked ellipses and a leaning peak: a shade ellipse for the
 * underside, then three cream tiers, then the tip. The peak is what makes it
 * whipped cream rather than a scoop — without it the mark reads as a marshmallow
 * — and it leans right, with the light. Same-fill overlaps mean no seams.
 *
 * **Its underside clears the front face entirely.** The shade ellipse bottoms
 * out at y 9.35, a fifth of a block above the top face's front edge at 9.55, so
 * the cream sits *on* the slab rather than lapping over the lit edge onto the
 * front. It used to overlap by most of a block, which read as the dollop being
 * in front of the slice instead of on top of it.
 *
 * **It is centred on its own bounding box, not on any one ellipse.** The tiers
 * are offset from each other and the peak leans right, so the stack's mass does
 * not sit under any of the four centres — placing the *shade ellipse* on the
 * mark's midline left the whole dollop reading a block to the left. The bbox
 * spans x 7.85..16.15 and centres on 12.00, which is exactly where the mark's
 * silhouette (1.8..22.2) and the top face's own centroid both centre. If a tier
 * or the peak ever moves, that measurement has to be redone — the numbers below
 * carry no offset that would keep it true on its own.
 *
 * The counter stays empty. An earlier mark held a drop there, and anything
 * sitting in that space competes with the counter wall and flattens the slice
 * back into a letter. On top of the bar is a different place, and it is where a
 * dollop would actually be.
 *
 * The dock icon is built separately by `dockIconSvg()` in `@pitaster/shared`,
 * which adds the macOS app tile and scales this same geometry. Keep the two in
 * step — they are one drawing at two scales.
 */
export function Logo({ size = 22, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role="img"
      aria-label="Pi Taster"
    >
      {/* The top face, far depth row: crust — the pie's rim. */}
      <path d="M3.84 8.53L20.16 8.53L22.2 7.51L5.88 7.51Z" fill="var(--color-brass)" />
      {/* …and its near row: filling, lifted so the bar's front top edge reads. */}
      <path d="M1.8 9.55L18.12 9.55L20.16 8.53L3.84 8.53Z" fill="var(--color-keylime-lit)" />
      {/* The far depth row of every wall is crust, top to foot — and so is the
          near row below the base line. Drawn before the near row: see above. */}
      <g fill="var(--color-brass-deep)">
        <path d="M7.92 10.57L7.92 20.77L9.96 19.75L9.96 9.55Z" />
        <path d="M18.12 10.57L18.12 20.77L20.16 19.75L20.16 9.55Z" />
        <path d="M20.16 8.53L20.16 10.57L22.2 9.55L22.2 7.51Z" />
        <path d="M5.88 19.75L5.88 21.79L7.92 20.77L7.92 18.73Z" />
        <path d="M16.08 19.75L16.08 21.79L18.12 20.77L18.12 18.73Z" />
      </g>
      {/* The near depth row above the base line is filling — it is a cut face. */}
      <g fill="var(--color-keylime-deep)">
        {/* The counter wall — see the note above before removing it. */}
        <path d="M5.88 11.59L5.88 19.75L7.92 18.73L7.92 10.57Z" />
        <path d="M16.08 11.59L16.08 19.75L18.12 18.73L18.12 10.57Z" />
        <path d="M18.12 9.55L18.12 11.59L20.16 10.57L20.16 8.53Z" />
      </g>
      {/* The cut face: filling above, graham base below. */}
      <path
        d="M1.8 9.55H18.12V11.59H16.08V19.75H14.04V11.59H5.88V19.75H3.84V11.59H1.8Z"
        fill="var(--color-keylime)"
      />
      <g fill="var(--color-brass)">
        <path d="M3.84 19.75H5.88V21.79H3.84Z" />
        <path d="M14.04 19.75H16.08V21.79H14.04Z" />
      </g>

      {/* The dollop: underside, three tiers, then the peak. */}
      <ellipse cx="12.17" cy="7.7" rx="3.98" ry="1.65" fill="var(--color-cream-shade)" />
      <g fill="var(--color-cream)">
        <ellipse cx="11.69" cy="7.02" rx="3.84" ry="1.58" />
        <ellipse cx="11.82" cy="5.57" rx="2.81" ry="1.3" />
        <ellipse cx="12.09" cy="4.34" rx="1.78" ry="1.03" />
        <path d="M11.64 3.99C11.98 2.76 12.65 2.34 13.32 2.21C13.1 3.17 13.1 3.72 13.04 4.2Z" />
      </g>
    </svg>
  )
}
