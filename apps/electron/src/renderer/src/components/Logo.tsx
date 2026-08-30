import { useId } from 'react'

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
 * The anyapp mark: a rounded-square aperture with a second, offset square
 * breaking through its lower-right corner — an app that contains and reshapes
 * apps. The aperture's stroke is masked away where the inner square crosses it,
 * which is what makes the inner square read as sitting in front of it.
 *
 * The dock icon is built separately by `dockIconSvg()` in `@anyapp/shared`,
 * which adds the macOS app tile and a heavier stroke.
 */
export function Logo({ size = 22, className }: LogoProps) {
  // Two Logos on one page would otherwise collide on the mask id.
  const maskId = `anyapp-aperture-${useId()}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role="img"
      aria-label="anyapp"
    >
      <mask id={maskId}>
        <rect width="24" height="24" fill="#fff" />
        <rect x="11.35" y="11.35" width="10.8" height="10.8" rx="3.55" fill="#000" />
      </mask>
      <rect
        x="2.5"
        y="2.5"
        width="15"
        height="15"
        rx="4"
        stroke="var(--color-brass)"
        strokeWidth="2.5"
        mask={`url(#${maskId})`}
      />
      <rect x="12.5" y="12.5" width="8.5" height="8.5" rx="2.4" fill="var(--color-patina)" />
    </svg>
  )
}
