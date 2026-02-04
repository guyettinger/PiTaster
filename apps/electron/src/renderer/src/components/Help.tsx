/**
 * Help component that explains how to use CLIRabbit to enhance the UI.
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
    <div className="rounded-lg border border-neutral-700 bg-neutral-900">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-800/50"
      >
        <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
        <span className="text-neutral-400">{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && (
        <div className="border-t border-neutral-700 p-4">
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
      <h4 className="mb-2 font-semibold text-neutral-200">{title}</h4>
      {description && (
        <p className="mb-2 text-sm text-neutral-400">{description}</p>
      )}
      <div className="rounded border border-neutral-600 bg-neutral-800 p-3">
        <code className="text-sm text-neutral-100">{code}</code>
      </div>
    </div>
  )
}

/**
 * Help page explaining how to enhance the UI through chat.
 */
export function Help() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📚</span>
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">Help & Documentation</h1>
            <p className="text-sm text-neutral-400">Learn how to enhance CLIRabbit's UI through chat</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          
          {/* Quick Start */}
          <HelpSection title="🚀 Quick Start: Enhancing the UI" defaultExpanded={true}>
            <div className="space-y-4">
              <p className="text-neutral-300">
                CLIRabbit is a self-modifying AI that can enhance its own user interface. 
                Simply ask in the chat, and I'll read, modify, and improve the UI components in real-time.
              </p>
              
              <div className="rounded-lg bg-blue-900/20 border border-blue-700/30 p-4">
                <h3 className="font-semibold text-blue-300 mb-2">💡 Pro Tip</h3>
                <p className="text-sm text-blue-200">
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
          <HelpSection title="🔒 Permission Modes">
            <div className="space-y-4">
              <p className="text-neutral-300">
                Choose the right permission mode based on how much automation you want:
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded border border-neutral-700 bg-neutral-800/50 p-3">
                  <h4 className="font-semibold text-green-400">🔍 Explore (Read-only)</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    I can only read files and suggest changes. Perfect for understanding the codebase.
                  </p>
                </div>
                
                <div className="rounded border border-neutral-700 bg-neutral-800/50 p-3">
                  <h4 className="font-semibold text-yellow-400">❓ Ask to Edit</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    I'll ask permission before making any changes. Recommended for most users.
                  </p>
                </div>
                
                <div className="rounded border border-neutral-700 bg-neutral-800/50 p-3">
                  <h4 className="font-semibold text-orange-400">✏️ Auto Edit</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    I can automatically edit files but will ask for dangerous operations.
                  </p>
                </div>
                
                <div className="rounded border border-neutral-700 bg-neutral-800/50 p-3">
                  <h4 className="font-semibold text-red-400">⚡ Auto (All)</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    Full automation. I can perform any operation without asking.
                  </p>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* UI Enhancement Examples */}
          <HelpSection title="🎨 UI Enhancement Examples">
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 font-semibold text-neutral-200">Creating New Components</h3>
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
                <h3 className="mb-3 font-semibold text-neutral-200">Improving Existing UI</h3>
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
                <h3 className="mb-3 font-semibold text-neutral-200">Adding Features</h3>
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

          {/* Design System */}
          <HelpSection title="🎯 Design System & Components">
            <div className="space-y-4">
              <p className="text-neutral-300">
                CLIRabbit uses a consistent design system. When requesting UI changes, 
                I'll automatically follow these patterns:
              </p>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-neutral-200 mb-2">🎨 Color Palette</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="bg-neutral-950 p-2 rounded border">neutral-950 (main bg)</div>
                    <div className="bg-neutral-900 p-2 rounded border">neutral-900 (panels)</div>
                    <div className="bg-neutral-800 p-2 rounded border">neutral-800 (inputs)</div>
                    <div className="bg-neutral-700 p-2 rounded border">neutral-700 (borders)</div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-neutral-200 mb-2">📐 Layout Patterns</h4>
                  <ul className="space-y-1 text-sm text-neutral-300">
                    <li>• Sidebar navigation with main content area</li>
                    <li>• Collapsible right panels for secondary content</li>
                    <li>• Card-based layouts with consistent spacing</li>
                    <li>• Responsive design with mobile-first approach</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold text-neutral-200 mb-2">🧩 Component Library</h4>
                  <p className="text-sm text-neutral-300 mb-2">
                    Based on shadcn/ui with custom styling. Common components include:
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div className="bg-neutral-800/50 p-2 rounded">Button</div>
                    <div className="bg-neutral-800/50 p-2 rounded">Card</div>
                    <div className="bg-neutral-800/50 p-2 rounded">Dialog</div>
                    <div className="bg-neutral-800/50 p-2 rounded">Input</div>
                    <div className="bg-neutral-800/50 p-2 rounded">Select</div>
                    <div className="bg-neutral-800/50 p-2 rounded">Badge</div>
                  </div>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Skills System */}
          <HelpSection title="⚡ Skills System">
            <div className="space-y-4">
              <p className="text-neutral-300">
                Skills are specialized AI capabilities that can be activated with @mentions. 
                Use them to get better results for specific tasks.
              </p>

              <div className="space-y-3">
                <div className="rounded border border-neutral-700 bg-neutral-800/30 p-3">
                  <h4 className="font-semibold text-blue-400">@enhance-ui</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    Specialized UI enhancement with knowledge of the component library, 
                    design patterns, and styling guidelines.
                  </p>
                </div>
                
                <p className="text-sm text-neutral-400">
                  💡 <strong>Tip:</strong> Click the ⚡ Skills button in the sidebar to browse 
                  available skills and insert them into your chat.
                </p>
              </div>
            </div>
          </HelpSection>

          {/* Version Control */}
          <HelpSection title="📜 Version Control & Safety">
            <div className="space-y-4">
              <p className="text-neutral-300">
                All changes are automatically tracked with Git. You can safely experiment 
                and roll back if needed.
              </p>

              <div className="space-y-3">
                <div className="rounded border border-neutral-700 bg-neutral-800/30 p-3">
                  <h4 className="font-semibold text-green-400">🔄 Automatic Commits</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    Every file change is automatically committed with a descriptive message.
                  </p>
                </div>

                <div className="rounded border border-neutral-700 bg-neutral-800/30 p-3">
                  <h4 className="font-semibold text-blue-400">🌿 Branch Management</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    Create experimental branches for risky changes. Merge successful changes back to main.
                  </p>
                </div>

                <div className="rounded border border-neutral-700 bg-neutral-800/30 p-3">
                  <h4 className="font-semibold text-orange-400">⏪ Easy Rollback</h4>
                  <p className="text-sm text-neutral-300 mt-1">
                    Use the 📜 Version Control panel to view history and roll back to any previous state.
                  </p>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Best Practices */}
          <HelpSection title="✨ Best Practices">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="rounded border border-green-700/30 bg-green-900/20 p-3">
                  <h4 className="font-semibold text-green-300">✅ Do This</h4>
                  <ul className="text-sm text-green-200 mt-2 space-y-1">
                    <li>• Be specific about what you want to change</li>
                    <li>• Use @enhance-ui for UI-related requests</li>
                    <li>• Start with "Ask to Edit" mode if you're new</li>
                    <li>• Test changes in the UI before moving on</li>
                    <li>• Create branches for experimental features</li>
                  </ul>
                </div>

                <div className="rounded border border-red-700/30 bg-red-900/20 p-3">
                  <h4 className="font-semibold text-red-300">❌ Avoid This</h4>
                  <ul className="text-sm text-red-200 mt-2 space-y-1">
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
          <HelpSection title="🔧 Troubleshooting">
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <h4 className="font-semibold text-neutral-200">The UI broke after a change</h4>
                  <p className="text-sm text-neutral-400 mt-1">
                    Use the 📜 Version Control panel to roll back to a previous commit. 
                    Check the console for TypeScript errors.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-neutral-200">Changes aren't appearing</h4>
                  <p className="text-sm text-neutral-400 mt-1">
                    The app hot-reloads automatically, but complex changes might require a restart. 
                    Check the terminal for build errors.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-neutral-200">Permission denied errors</h4>
                  <p className="text-sm text-neutral-400 mt-1">
                    Switch to a higher permission mode or approve the requested action 
                    when prompted.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-neutral-200">Styling looks broken</h4>
                  <p className="text-sm text-neutral-400 mt-1">
                    Make sure Tailwind classes are being applied correctly. 
                    Check for typos in class names or missing imports.
                  </p>
                </div>
              </div>
            </div>
          </HelpSection>

          {/* Footer */}
          <div className="mt-8 rounded-lg border border-neutral-700 bg-gradient-to-r from-blue-900/20 to-purple-900/20 p-4">
            <h3 className="font-semibold text-neutral-200 mb-2">🎯 Ready to Get Started?</h3>
            <p className="text-sm text-neutral-300 mb-3">
              Head over to the chat and try asking me to enhance the UI. I'm here to help 
              make CLIRabbit even better!
            </p>
            <div className="flex gap-2 text-xs">
              <span className="rounded bg-blue-600/20 px-2 py-1 text-blue-300">@enhance-ui</span>
              <span className="rounded bg-green-600/20 px-2 py-1 text-green-300">add</span>
              <span className="rounded bg-purple-600/20 px-2 py-1 text-purple-300">improve</span>
              <span className="rounded bg-orange-600/20 px-2 py-1 text-orange-300">create</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}