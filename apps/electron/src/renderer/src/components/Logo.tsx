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
 * The π is a slab extruded back and to the right at the 2:1 slope. The face
 * turned toward you is the cut face — key lime filling on a graham base — and
 * the surfaces catching the light above and to the right are the crust. The
 * name is the thesis: this is a place to *taste* Pi on local models, so the mark
 * is the thing being tasted.
 *
 * The colors are the app's own. Key lime is the accent everywhere in the UI —
 * the agent acting — and it is the filling here because the thing the mark is
 * *about* should be its largest surface. Brass did not leave when it stopped
 * being the accent; it became the crust, which is what it always looked like.
 *
 * ## Geometry
 *
 * Built in a 24-unit space of its own and then scaled 1.05 and centred, which is
 * why no number below is round. In that space: extrusion **e = (2.8, -1.4)**, a
 * bar 2.8 thick, legs 2.6 wide, a 2.5 overhang at each end of the bar, a 5.6
 * counter between the legs, and a graham base 4.0 deep at the foot of each leg.
 *
 * **The counter and the extrusion are sized against each other**, and that is
 * the one proportion worth protecting. The counter wall's width on screen is
 * exactly `e.x`, so the background visible through the π is `counter - e.x`. At
 * the proportions first tried — a 4.6 counter under a 3.2 extrusion — that left
 * 1.4, and at 19px the mark closed up into a slab with a notch. Evenly split, it
 * survives the header: after the scale the wall runs x 7.59..10.53 and the right
 * leg's front edge is at 13.47, so wall and void are 2.94 each.
 *
 * The graham base is 4.0 rather than the 2.6 first drawn, because a thin base
 * leaves the legs reading as furniture — the mass at the foot is what keeps this
 * a slice rather than a table.
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
 * **Draw order is the whole occlusion model**: the four quads, then the front
 * face over them, then the dollop over the bar's top face. The bar's front face
 * is what covers the part of the counter wall which rises behind it, and the
 * bar's right-end quad is what covers the top of the right leg's side wall. Draw
 * the front face first and both seams open.
 *
 * ## The dollop goes on the bar, never in the counter
 *
 * It is four stacked ellipses and a leaning peak: a shade ellipse for the
 * underside, then three cream tiers, then the tip. The peak is what makes it
 * whipped cream rather than a scoop — without it the mark reads as a marshmallow
 * — and it leans right, with the light. Same-fill overlaps mean no seams.
 *
 * Its height is set against the top face's front edge at y 6.15: the shade
 * ellipse's underside lands just below that, so the cream reads as *resting on*
 * the crust with a slight settle. Lower and it sinks into the lime bar; higher
 * and crust shows beneath it and it perches.
 *
 * The counter stays empty. An earlier mark held a drop there, and anything
 * sitting in that space competes with the counter wall and flattens the slice
 * back into a letter. On top of the bar is a different place, and it is where a
 * dollop would actually be.
 *
 * ## Centring
 *
 * The silhouette spans y 1.56..21.9, so it centres on 11.7 rather than 12. That
 * is deliberate and should not be "corrected": the top of that range is the
 * peak's thin tip, which carries almost no visual weight, and centring on it
 * would push the slab low in the box.
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
      {/* Crust, lit: the bar's top surface. */}
      <path d="M2.23 6.15L18.82 6.15L21.77 4.68L5.17 4.68Z" fill="var(--color-brass)" />
      {/* Crust, in shadow: three right-facing walls. */}
      <g fill="var(--color-brass-deep)">
        <path d="M18.82 6.15L18.82 9.09L21.77 7.62L21.77 4.68Z" />
        <path d="M16.2 9.09L16.2 21.9L19.14 20.43L19.14 7.62Z" />
        {/* The counter wall — see the note above before removing it. */}
        <path d="M7.59 9.09L7.59 21.9L10.53 20.43L10.53 7.62Z" />
      </g>
      {/* The cut face: filling above, graham base below. */}
      <path
        d="M2.23 6.15H18.82V9.09H16.2V17.7H13.47V9.09H7.59V17.7H4.86V9.09H2.23Z"
        fill="var(--color-keylime)"
      />
      <g fill="var(--color-brass)">
        <path d="M4.86 17.7L7.59 17.7L7.59 21.9L4.86 21.9Z" />
        <path d="M13.47 17.7L16.2 17.7L16.2 21.9L13.47 21.9Z" />
      </g>

      {/* The dollop: underside, three tiers, then the peak. */}
      <ellipse cx="12.31" cy="6.46" rx="3.55" ry="1.47" fill="var(--color-cream-shade)" />
      <g fill="var(--color-cream)">
        <ellipse cx="11.88" cy="5.85" rx="3.43" ry="1.41" />
        <ellipse cx="12" cy="4.56" rx="2.51" ry="1.16" />
        <ellipse cx="12.24" cy="3.46" rx="1.59" ry="0.92" />
        <path d="M11.84 3.15C12.14 2.05 12.74 1.68 13.34 1.56C13.14 2.42 13.14 2.91 13.09 3.34Z" />
      </g>
    </svg>
  )
}
