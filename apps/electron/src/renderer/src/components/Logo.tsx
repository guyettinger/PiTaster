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
 * The Pi Taster mark: a brass π on flared feet, holding a patina drop.
 *
 * The π is the agent — this app is a place to taste [Pi](https://pi.dev/) running on
 * local models. Its legs splay outward the way a real π's feet do, which is what
 * makes the glyph legible at 19px, and the splay plus the bar reads as a footed
 * vessel with the drop held in its counter. The drop is the sample: what the agent
 * produced. That pairing is the word the code already uses — `agent/sampling.ts` is
 * what resolves the temperature and `top_p` a model is tasted at.
 *
 * The colors keep their usual meanings rather than taking new ones: brass is the
 * agent acting, patina is what came out of it and can be rolled back.
 *
 * The geometry was chosen against a render, not on paper. Legs that curve *inward*
 * read as a cup with a lid rather than as π — the bar and two verticals are what
 * carry the letterform, and closing them at the bottom throws it away. The drop is
 * sized to survive the 19px header: at r=2.4 it thins to a smudge there.
 *
 * Nothing overlaps, which is why there is no mask. The old aperture mark needed one
 * to cut its stroke where the inner square crossed it, and that mask id was the one
 * thing this file and the dock icon had to keep unique between them.
 *
 * The dock icon is built separately by `dockIconSvg()` in `@pitaster/shared`, which
 * adds the macOS app tile and scales this same geometry. Keep the two in step — they
 * are one drawing at two scales.
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
      {/* Bar and legs are one stroked group: same weight, same caps. */}
      <g
        stroke="var(--color-brass)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.6 7H19.4" />
        <path d="M8.6 8.8C8.6 13 8.2 15.6 7.3 17.6" />
        <path d="M15.4 8.8C15.4 13 15.8 15.6 16.7 17.6" />
      </g>
      {/* The drop clears both legs by ~0.9 units, so nothing needs masking. */}
      <circle cx="12" cy="14.1" r="2.7" fill="var(--color-patina)" />
    </svg>
  )
}
