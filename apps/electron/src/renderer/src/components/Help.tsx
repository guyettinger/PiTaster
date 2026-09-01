import { PERMISSION_MODES } from './PermissionModeControl'
import type { PermissionModeDescriptor } from './PermissionModeControl'

/**
 * Help component that explains how to use anyapp to enhance the UI.
 */

import { useState } from 'react'

/**
 * Section component for help content organization.
 */
function HelpSection({ 
  title, 
  children,
  defaultExpanded = false 
}: { 
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="rounded-lg border border-line bg-panel">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-raised/50"
      >
        <h2 className="text-[14px] font-semibold text-bone">{title}</h2>
        <span className="text-ash">{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && (
        <div className="border-t border-line p-4 [&_p]:max-w-prose">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Code example component with syntax highlighting.
 */
function CodeExample({ 
  title, 
  code,
  description 
}: { 
  title: string
  code: string
  description?: string
}) {
  return (
    <div className="mb-4">
      <h4 className="mb-2 font-semibold text-bone">{title}</h4>
      {description && (
        <p className="mb-2 text-sm text-ash">{description}</p>
      )}
      <div className="rounded border border-line bg-raised p-3">
        <code className="text-sm text-bone">{code}</code>
      </div>
    </div>
  )
}

/** Mode swatches, matching the shell header's hairline. */
const MODE_SWATCH: Record<PermissionModeDescriptor['accent'], string> = {
  patina: 'h-1 bg-patina',
  brass: 'h-1 bg-brass',
  rust: 'h-1 bg-rust'
}

/**
 * Help page explaining how to enhance the UI through chat.
 */
export function Help() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-line px-6 py-4">
        <h1 className="text-[15px] font-semibold text-bone">Help</h1>
        <p className="text-[12px] text-ash">
          How to work with the agent, and what it is allowed to do
        </p>
      </header>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-6">
          
          {/* Quick Start */}
          <HelpSection title="Quick start" defaultExpanded={true}>
            <div className="space-y-4">
              <p className="text-bone">
                anyapp is a self-modifying AI that can enhance its own user interface. 
                Simply ask in the chat, and I'll read, modify, and improve the UI components in real-time.
              </p>
              
              <div className="rounded-lg bg-brass/10 border border-brass/40 p-4">
                <h3 className="font-semibold text-bone mb-2">Pro Tip</h3>
                <p className="text-sm text-bone">
                  Use the <strong>@enhance-ui</strong> skill when requesting UI improvements. 
                  This activates specialized knowledge about the component library and design system.
                </p>
              </div>

              <CodeExample
                title="Example Request"
                code="@enhance-ui add a dark/light theme toggle to the settings page"
                description="This will activate the UI enhancement skill and create a theme toggle component."
              />
            </div>
          </HelpSection>

          {/* Permission Modes */}
          <HelpSection title="Permission modes">
            <div className="space-y-4">
              <p className="text-bone">
                Set the mode under the chat composer, where it takes effect — or in
                Settings when no app is open. The header&rsquo;s bottom hairline takes the
                mode&rsquo;s color, so the top of the window always shows how much the
                agent is allowed to do.
              </p>
              
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {PERMISSION_MODES.map((mode) => (
                  <div
                    key={mode.id}
                    className="overflow-hidden rounded border border-line bg-raised/50"
                  >
                    {/* The same swatch the shell header's hairline uses for this mode. */}
                    <div className={MODE_SWATCH[mode.accent]} />
                    <div className="p-3">
                      <h4 className="font-semibold text-bone">{mode.label}</h4>
                      <p className="mt-1 text-sm text-ash">{mode.hint}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </HelpSection>

          {/* UI Enhancement Examples */}
          <HelpSection title="What to ask for">
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 font-semibold text-bone">Creating New Components</h3>
                <div className="space-y-3">
                  <CodeExample
                    title="Add a new page"
                    code="@enhance-ui create a dashboard page with project statistics"
                  />
                  <CodeExample
                    title="Create a modal dialog"
                    code="@enhance-ui add a confirmation dialog for deleting files"
                  />
                  <CodeExample
                    title="Build a form component"
                    code="@enhance-ui create a user preferences form with validation"
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-semibold text-bone">Improving Existing UI</h3>
                <div className="space-y-3">
                  <CodeExample
                    title="Enhance styling"
                    code="@enhance-ui improve the chat input with better focus states and animations"
                  />
                  <CodeExample
                    title="Add functionality"
                    code="@enhance-ui add keyboard shortcuts to the version control panel"
                  />
                  <CodeExample
                    title="Responsive design"
                    code="@enhance-ui make the sidebar responsive for mobile devices"
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-semibold text-bone">Adding Features</h3>
                <div className="space-y-3">
                  <CodeExample
                    title="Search functionality"
                    code="@enhance-ui add a global search that can find files, chat messages, and commits"
                  />
                  <CodeExample
                    title="Drag and drop"
                    code="@enhance-ui enable drag and drop file upload in the chat"
                  />
                  <CodeExample
                    title="Real-time updates"
                    code="@enhance-ui show live file change notifications in the sidebar"
                  />
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Design system */}
          <HelpSection title="Design system">
            <div className="space-y-4">
              <p className="text-bone">
                anyapp is built on a small set of design tokens. Ask for changes in these
                terms and the agent will keep new UI consistent with the rest of the app.
              </p>

              <div>
                <h4 className="mb-2 font-semibold text-bone">Surfaces and text</h4>
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                  <div className="rounded border border-line bg-ground p-2 font-mono">ground</div>
                  <div className="rounded border border-line bg-panel p-2 font-mono">panel</div>
                  <div className="rounded border border-line bg-raised p-2 font-mono">raised</div>
                  <div className="rounded border border-line p-2 font-mono text-bone">bone</div>
                  <div className="rounded border border-line p-2 font-mono text-ash">ash</div>
                  <div className="rounded border border-line bg-line p-2 font-mono">line</div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-bone">Accents</h4>
                <p className="mb-2 text-sm text-ash">
                  Only two hues are ever saturated, and each one means something.
                </p>
                <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                  <div className="rounded border border-brass/40 bg-brass/10 p-2">
                    <span className="font-mono text-brass">brass</span>
                    <span className="mt-0.5 block text-ash">
                      The agent acting: focus, primary action, permission.
                    </span>
                  </div>
                  <div className="rounded border border-patina/40 bg-patina/10 p-2">
                    <span className="font-mono text-patina">patina</span>
                    <span className="mt-0.5 block text-ash">
                      History and reversibility: commits, branches, running.
                    </span>
                  </div>
                  <div className="rounded border border-rust/40 bg-rust/10 p-2">
                    <span className="font-mono text-rust">rust</span>
                    <span className="mt-0.5 block text-ash">
                      Stopping and destroying, and the ungated permission mode.
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-bone">Type</h4>
                <ul className="space-y-1 text-sm text-ash">
                  <li>
                    &bull; <span className="text-bone">Archivo</span> for everything except
                    code
                  </li>
                  <li>
                    &bull; <span className="font-mono text-bone">IBM Plex Mono</span> for
                    paths, commit SHAs, tool arguments, and terminal output
                  </li>
                  <li>
                    &bull; The <span className="eyebrow text-bone">eyebrow</span> utility for
                    section labels
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-bone">Layout</h4>
                <ul className="space-y-1 text-sm text-ash">
                  <li>&bull; A draggable shell header carries the app&rsquo;s identity and the agent&rsquo;s permission mode</li>
                  <li>&bull; The rail holds only what exists without an open app</li>
                  <li>&bull; The column beside it holds everything scoped to the open app</li>
                  <li>&bull; Destinations replace the view; panels dock beside or below it</li>
                </ul>
              </div>
            </div>
          </HelpSection>

          {/* Skills System */}
          <HelpSection title="Skills">
            <div className="space-y-4">
              <p className="text-bone">
                A skill is a short instruction file the agent loads when a task matches
                it &mdash; how to add a feature here, how this project verifies a change,
                what not to do. The agent decides when to reach for one, and you can hand
                it one by typing <span className="font-mono text-bone">@</span> in the
                composer.
              </p>

              <p className="text-bone">
                Every skill&rsquo;s <strong>description</strong> is sent to the model in
                every request &mdash; that is what makes a skill trigger, and what the
                Skills page counts. Its <strong>instructions</strong> cost nothing until
                the agent actually loads it, which shows in the transcript as a
                &ldquo;Load skill&rdquo; step. Turning a skill off removes its description
                too, so the count on the Skills page drops.
              </p>

              <div className="space-y-3">
                <div className="rounded border border-line bg-raised/30 p-3">
                  <h4 className="eyebrow text-patina">This app</h4>
                  <p className="mt-1 text-sm text-bone">
                    Kept in the app&rsquo;s own{' '}
                    <span className="font-mono">skills/</span> folder, committed with it,
                    and rolled back with it. The agent can write these itself. Where an
                    app skill and a workspace skill share a name, the app&rsquo;s wins.
                  </p>
                </div>

                <div className="rounded border border-line bg-raised/30 p-3">
                  <h4 className="eyebrow text-ash">Workspace</h4>
                  <p className="mt-1 text-sm text-bone">
                    Kept in <span className="font-mono">~/.anyapp/skills</span> and
                    offered to every app. anyapp seeds a few to start with; they are
                    yours to edit or delete.
                  </p>
                </div>
              </div>

              <p className="text-sm text-ash">
                Skills for the agent that builds <strong>anyapp itself</strong> are a
                different thing entirely &mdash; they live in the repository under{' '}
                <span className="font-mono">.claude/skills/</span> and never appear here.
              </p>
            </div>
          </HelpSection>

          {/* Version Control */}
          <HelpSection title="Version control and safety">
            <div className="space-y-4">
              <p className="text-bone">
                All changes are automatically tracked with Git. You can safely experiment 
                and roll back if needed.
              </p>

              <div className="space-y-3">
                <div className="rounded border border-line bg-raised/30 p-3">
                  <h4 className="font-semibold text-patina">Automatic Commits</h4>
                  <p className="text-sm text-bone mt-1">
                    Every file change is automatically committed with a descriptive message.
                  </p>
                </div>

                <div className="rounded border border-line bg-raised/30 p-3">
                  <h4 className="font-semibold text-brass">Branch Management</h4>
                  <p className="text-sm text-bone mt-1">
                    Create experimental branches for risky changes. Merge successful changes back to main.
                  </p>
                </div>

                <div className="rounded border border-line bg-raised/30 p-3">
                  <h4 className="font-semibold text-brass">Easy Rollback</h4>
                  <p className="text-sm text-bone mt-1">
                    Open <strong>History</strong> in the app&rsquo;s column to see every commit and roll back to any of them.
                  </p>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Best Practices */}
          <HelpSection title="Working well with the agent">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="rounded border border-patina/40 bg-patina/10 p-3">
                  <h4 className="font-semibold text-bone">Do This</h4>
                  <ul className="text-sm text-bone mt-2 space-y-1">
                    <li>• Be specific about what you want to change</li>
                    <li>• Use @enhance-ui for UI-related requests</li>
                    <li>• Start in "Ask to edit" mode if you're new</li>
                    <li>• Test changes in the UI before moving on</li>
                    <li>• Create branches for experimental features</li>
                  </ul>
                </div>

                <div className="rounded border border-rust/40 bg-rust/10 p-3">
                  <h4 className="font-semibold text-rust">Avoid This</h4>
                  <ul className="text-sm text-rust mt-2 space-y-1">
                    <li>• Vague requests like "make it better"</li>
                    <li>• Too many changes in one request</li>
                    <li>• Ignoring TypeScript errors after changes</li>
                    <li>• Forgetting to test responsive behavior</li>
                    <li>• Making breaking changes without backups</li>
                  </ul>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Troubleshooting */}
          <HelpSection title="Troubleshooting">
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <h4 className="font-semibold text-bone">The UI broke after a change</h4>
                  <p className="text-sm text-ash mt-1">
                    Open <strong>History</strong> in the app&rsquo;s column and restore an earlier commit. 
                    Check the console for TypeScript errors.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-bone">Changes aren't appearing</h4>
                  <p className="text-sm text-ash mt-1">
                    The app hot-reloads automatically, but complex changes might require a restart. 
                    Check the terminal for build errors.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-bone">Permission denied errors</h4>
                  <p className="text-sm text-ash mt-1">
                    Switch to a higher permission mode or approve the requested action 
                    when prompted.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-bone">Styling looks broken</h4>
                  <p className="text-sm text-ash mt-1">
                    Make sure Tailwind classes are being applied correctly. 
                    Check for typos in class names or missing imports.
                  </p>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Footer */}
          <div className="mt-8 rounded-lg border border-brass/40 bg-brass/10 p-4">
            <h3 className="mb-2 font-semibold text-bone">Start with one small change</h3>
            <p className="text-sm text-ash">
              Open an app, describe the change you want in the chat, and check the result in
              History. Every write the agent makes is its own commit, so nothing you try is
              permanent.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}