/**
 * The anyapp icon set.
 *
 * One hand-drawn 24x24 stroke system, replacing the mix of literal emoji and
 * ad-hoc heroicons paths that chrome used to be built from. Every glyph draws
 * in `currentColor` at a 1.5 stroke, so an icon inherits the color of whatever
 * nav item, button, or label contains it.
 *
 * Template emoji in the app listing are content, not chrome, and stay as they are.
 */

import type { ReactNode, SVGProps } from 'react'

/**
 * Props shared by every icon.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Edge length in pixels. Defaults to 20, the size chrome uses. */
  size?: number
}

/**
 * Shared SVG frame. Keeps stroke geometry identical across the set so icons
 * sit on the same optical weight next to each other.
 */
function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Four tiles: the app library. */
export function AppsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </Icon>
  )
}

/** A spark: reusable instructions the agent can be handed. */
export function SkillsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.2c0 3.4 2.4 5.8 5.8 5.8-3.4 0-5.8 2.4-5.8 5.8 0-3.4-2.4-5.8-5.8-5.8 3.4 0 5.8-2.4 5.8-5.8Z" />
      <path d="M17.6 15.2c0 1.7 1.2 2.9 2.9 2.9-1.7 0-2.9 1.2-2.9 2.9 0-1.7-1.2-2.9-2.9-2.9 1.7 0 2.9-1.2 2.9-2.9Z" />
    </Icon>
  )
}

/** A question mark: help and documentation. */
export function HelpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 2.9 2.9v1.4" />
      <path d="M12.5 16.7h.01" />
    </Icon>
  )
}

/** Sliders: settings. Reads more clearly than a gear at 20px. */
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7.5h5.5M14 7.5h6" />
      <path d="M4 16.5h6M14.5 16.5h5.5" />
      <circle cx="11.75" cy="7.5" r="2.25" />
      <circle cx="12.25" cy="16.5" r="2.25" />
    </Icon>
  )
}

/** A commit graph: version history. */
export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 5.5v13" />
      <circle cx="7" cy="9" r="2" />
      <circle cx="7" cy="18.5" r="2" fill="currentColor" stroke="none" />
      <circle cx="17" cy="7" r="2" />
      <path d="M17 9v2.5a4 4 0 0 1-4 4H9" />
    </Icon>
  )
}

/** A prompt: the running app's log stream. */
export function TerminalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 7.5 9.5 12 5 16.5" />
      <path d="M12.5 17h6.5" />
    </Icon>
  )
}

/** A browser window: the live preview of the running app. */
export function PreviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="M3 9h18" />
      <path d="M6.2 6.75h.01M8.7 6.75h.01" />
    </Icon>
  )
}

/** Start the app's dev server. */
export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5.6 18.5 12 8 18.4V5.6Z" fill="currentColor" />
    </Icon>
  )
}

/** Stop the app's dev server. */
export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
    </Icon>
  )
}

/** Create. */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Icon>
  )
}

/** The current git branch. */
export function BranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="6.5" r="2.2" />
      <circle cx="7" cy="17.5" r="2.2" />
      <circle cx="17" cy="6.5" r="2.2" />
      <path d="M7 8.7v6.6" />
      <path d="M17 8.7v1.6a4 4 0 0 1-4 4h-3.8" />
    </Icon>
  )
}

/** Open the running app in the system browser. */
export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5Z" />
    </Icon>
  )
}

/** Delete, permanently. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 11.1a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7L17.5 7" />
    </Icon>
  )
}

/** Rename. */
export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16.2 4.6a1.9 1.9 0 0 1 2.7 2.7L8.6 17.6l-3.6.9.9-3.6L16.2 4.6Z" />
    </Icon>
  )
}

/** Dismiss. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  )
}

/** Disclosure, pointing down. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </Icon>
  )
}

/** Disclosure, pointing right. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 6.5 15 12l-5.5 5.5" />
    </Icon>
  )
}

/** Back to the previous surface. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5.5" />
      <path d="M11 5.5 4.5 12l6.5 6.5" />
    </Icon>
  )
}

/** Reload. */
export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.8 4.5v4h-4" />
    </Icon>
  )
}

/** Filter a list. */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.4 15.4 20 20" />
    </Icon>
  )
}

/** Confirmed. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 9.8 17 19 6.8" />
    </Icon>
  )
}

/** Two offset sheets: take a copy of this. */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M15 6.2V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h.7" />
    </Icon>
  )
}

/** Something needs attention before it will work. */
export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.6 21 19.4H3L12 4.6Z" />
      <path d="M12 10v3.6M12 16.6h.01" />
    </Icon>
  )
}

/** A connected MCP source. */
export function SourceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
      <path d="M7 7.25h.01M7 16.75h.01" />
    </Icon>
  )
}

/** A file the agent read. */
export function FileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
      <path d="M13.5 3.5V9H19" />
    </Icon>
  )
}

/** A file the agent wrote or edited. */
export function FileEditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 10.5V9l-5.5-5.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h3.5" />
      <path d="M13.5 3.5V9H19" />
      <path d="M18 13.4a1.6 1.6 0 0 1 2.3 2.3l-5.4 5.4-2.9.6.6-2.9 5.4-5.4Z" />
    </Icon>
  )
}

/** A directory listing. */
export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7a2 2 0 0 1 2-2h3.4l2 2.5h7.6a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z" />
    </Icon>
  )
}

/** A shell command. */
export function CommandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7 9.5 9.8 12 7 14.5" />
      <path d="M12.5 15h4.5" />
    </Icon>
  )
}

/** The conversation with the agent. */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5a10 10 0 0 1-2.6-.34L4.5 20.5l1.2-3.3A6.9 6.9 0 0 1 3.5 12.5C3.5 8.9 7.3 6 12 6s8.5 2.9 8.5 6.5Z" />
    </Icon>
  )
}

/** The workspace: panels docked around each other. */
export function LayoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
      <path d="M9.5 13.5h11" />
    </Icon>
  )
}

/** A thought bubble: the model's reasoning, before its answer. */
export function ThinkingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 5.5a3.6 3.6 0 0 1 7 0 3.4 3.4 0 0 1 1.9 5.9 3.6 3.6 0 0 1-6.4 2.4 3.6 3.6 0 0 1-5.5-4.3 3.4 3.4 0 0 1 3-4Z" />
      <path d="M9.5 17.5h.01" />
      <path d="M7 20.5h.01" />
    </Icon>
  )
}

/** Anything the icon set has no specific glyph for. */
export function ToolIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.8 4.4a4.6 4.6 0 0 0-5.6 6l-5 5a1.8 1.8 0 0 0 2.5 2.5l5-5a4.6 4.6 0 0 0 6-5.6l-2.7 2.7-2.4-.5-.5-2.4 2.7-2.7Z" />
    </Icon>
  )
}

/** A pulse trace: the agent working, and what that work has cost. */
export function PulseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12h3.8l2.6-6.4 4 14.2 2.7-7.8h5.9" />
    </Icon>
  )
}

/** Stacked racks: the local daemon, holding a model. */
export function DaemonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="17" height="6.5" rx="1.8" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8" />
      <path d="M7 7.25h.01M7 16.75h.01" />
    </Icon>
  )
}
