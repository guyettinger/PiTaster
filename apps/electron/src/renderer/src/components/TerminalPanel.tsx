import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useRunningApps } from '../context/RunningAppsContext'

/** ANSI color code mappings. */
const ANSI_COLORS: Record<string, string> = {
  '30': 'text-neutral-900',
  '31': 'text-red-500',
  '32': 'text-green-500',
  '33': 'text-yellow-500',
  '34': 'text-blue-500',
  '35': 'text-purple-500',
  '36': 'text-cyan-500',
  '37': 'text-neutral-200',
  '90': 'text-neutral-500',
  '91': 'text-red-400',
  '92': 'text-green-400',
  '93': 'text-yellow-400',
  '94': 'text-blue-400',
  '95': 'text-purple-400',
  '96': 'text-cyan-400',
  '97': 'text-white',
}

/**
 * Parse ANSI codes and return styled spans.
 */
function parseAnsi(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /\x1b\[(\d+)m/g
  let lastIndex = 0
  let currentClass = ''
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before this code
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      parts.push(
        <span key={lastIndex} className={currentClass}>
          {segment}
        </span>
      )
    }

    // Update color class
    const code = match[1]
    if (code === '0' || code === '39') {
      currentClass = ''
    } else if (ANSI_COLORS[code]) {
      currentClass = ANSI_COLORS[code]
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={lastIndex} className={currentClass}>
        {text.slice(lastIndex)}
      </span>
    )
  }

  return parts.length > 0 ? parts : [text]
}

/**
 * Props for the TerminalPanel component.
 */
interface TerminalPanelProps {
  /** App ID to show logs for. */
  appId: string
  /** Whether the panel is visible. */
  isVisible: boolean
}

/**
 * Terminal panel for displaying app logs.
 */
export function TerminalPanel({ appId, isVisible }: TerminalPanelProps) {
  const { getLogs, clearLogs, getStatus } = useRunningApps()
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [filter, setFilter] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all')

  const logs = getLogs(appId)
  const status = getStatus(appId)

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs
    return logs.filter(log => log.type === filter)
  }, [logs, filter])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [filteredLogs, autoScroll])

  // Handle scroll to detect manual scrolling
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
  }, [])

  const formatTimestamp = useCallback((iso: string) => {
    return new Date(iso).toLocaleTimeString()
  }, [])

  if (!isVisible) return null

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Terminal</span>
          {status && (
            <span className={`text-xs ${
              status === 'running' ? 'text-green-500' : 
              status === 'starting' ? 'text-yellow-500' :
              status === 'error' ? 'text-red-500' : 'text-neutral-500'
            }`}>
              {status}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
          >
            <option value="all">All</option>
            <option value="stdout">stdout</option>
            <option value="stderr">stderr</option>
            <option value="system">system</option>
          </select>

          {/* Timestamps toggle */}
          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={`rounded px-2 py-1 text-xs ${
              showTimestamps ? 'bg-neutral-700' : 'hover:bg-neutral-800'
            }`}
            title="Toggle timestamps"
          >
            Time
          </button>

          {/* Auto-scroll indicator */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded px-2 py-1 text-xs ${
              autoScroll ? 'bg-neutral-700' : 'hover:bg-neutral-800'
            }`}
            title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
          >
            Scroll
          </button>

          {/* Clear */}
          <button
            onClick={() => clearLogs(appId)}
            className="rounded px-2 py-1 text-xs hover:bg-neutral-800"
            title="Clear logs"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-neutral-500">
            {status === 'starting' ? 'Starting...' : 'No logs yet. Run the app to see output.'}
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={`${log.timestamp}-${index}`}
              className={`whitespace-pre-wrap ${
                log.type === 'stderr' ? 'text-red-400' :
                log.type === 'system' ? 'text-blue-400' : ''
              }`}
            >
              {showTimestamps && (
                <span className="mr-2 text-neutral-600">
                  [{formatTimestamp(log.timestamp)}]
                </span>
              )}
              {log.type === 'system' && (
                <span className="mr-1 text-blue-500">[system]</span>
              )}
              {parseAnsi(log.message)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
