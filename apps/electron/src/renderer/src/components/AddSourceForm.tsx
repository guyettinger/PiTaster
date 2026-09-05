import { useState, useCallback } from 'react'

/**
 * Form data for an MCP source.
 */
interface McpSourceFormData {
  /** Display name for the source. */
  name: string
  /** Command to run (e.g., 'npx', 'node', 'docker'). */
  command: string
  /** Command arguments as a single string (split on save). */
  args: string
  /** Environment variables as key=value lines. */
  env: string
}

/**
 * Props for the AddSourceForm component.
 */
interface AddSourceFormProps {
  /** Callback when form is submitted with valid data. */
  onSave: (data: McpSourceFormData) => void
  /** Callback when form is cancelled. */
  onCancel: () => void
  /** Whether a save is in progress. */
  isSaving?: boolean
  /** If provided, pre-fills the form for editing an existing source. */
  initialData?: McpSourceFormData
  /** Button label override (e.g., "Save Changes" for edit mode). */
  submitLabel?: string
}

/**
 * Generate a URL-safe ID from a name.
 * @param name - The display name to slugify
 * @returns A URL-safe identifier
 */
function generateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || `source-${Date.now()}`
}

/**
 * Parse environment variable lines into a record.
 * Accepts "KEY=VALUE" format, one per line. Blank lines and comments (#) are skipped.
 * @param text - Newline-separated KEY=VALUE pairs
 * @returns A record of environment variables
 */
function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      env[key] = value
    }
  }
  return env
}

/**
 * Validates the form data and returns an error message or null.
 * @param data - The form data to validate
 * @returns An error message string, or null if valid
 */
function validate(data: McpSourceFormData): string | null {
  if (!data.name.trim()) return 'Name is required'
  if (!data.command.trim()) return 'Command is required'
  return null
}

/**
 * Inline form for adding or editing an MCP source configuration.
 */
export function AddSourceForm({
  onSave,
  onCancel,
  isSaving = false,
  initialData,
  submitLabel
}: AddSourceFormProps) {
  const [name, setName] = useState(initialData?.name ?? '')
  const [command, setCommand] = useState(initialData?.command ?? '')
  const [args, setArgs] = useState(initialData?.args ?? '')
  const [env, setEnv] = useState(initialData?.env ?? '')
  const [error, setError] = useState<string | null>(null)

  const label = submitLabel ?? (initialData ? 'Save Changes' : 'Add Source')

  const handleSubmit = useCallback(() => {
    const data: McpSourceFormData = { name, command, args, env }
    const validationError = validate(data)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    onSave(data)
  }, [name, command, args, env, onSave])

  return (
    <div className="border-b border-line bg-panel/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-bone">
        {initialData ? 'Edit MCP Source' : 'Add MCP Source'}
      </h3>

      <div className="space-y-2">
        {/* Name */}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          className="w-full rounded border border-line bg-raised px-3 py-1.5 text-sm
                     text-bone placeholder-ash
                     transition-colors hover:border-ash"
          autoFocus
        />

        {/* Command */}
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Command (e.g., npx, node, docker)"
          className="w-full rounded border border-line bg-raised px-3 py-1.5 text-sm
                     text-bone placeholder-ash
                     transition-colors hover:border-ash"
        />

        {/* Arguments */}
        <input
          type="text"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="Arguments (e.g., -y @modelcontextprotocol/server-filesystem /path)"
          className="w-full rounded border border-line bg-raised px-3 py-1.5 text-sm
                     text-bone placeholder-ash
                     transition-colors hover:border-ash"
        />

        {/* Environment variables (optional, collapsible) */}
        <details className="text-sm">
          <summary className="cursor-pointer text-ash hover:text-bone">
            Environment variables (optional)
          </summary>
          <textarea
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            placeholder={'KEY=value\nANOTHER_KEY=value'}
            rows={3}
            className="mt-2 w-full rounded border border-line bg-raised px-3 py-1.5
                       font-mono text-xs text-bone placeholder-ash
                       transition-colors hover:border-ash"
          />
        </details>

        {/* Error */}
        {error && <p className="text-xs text-rust">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex-1 rounded bg-keylime px-3 py-1.5 text-sm text-ground
                       hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : label}
          </button>
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="rounded border border-line px-3 py-1.5 text-sm text-bone
                       hover:bg-raised disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export { generateId, parseEnvLines, validate }
export type { McpSourceFormData }
