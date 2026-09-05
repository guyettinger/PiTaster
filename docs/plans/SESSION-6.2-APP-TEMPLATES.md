# Session 6.2: App Templates

## Overview

This sub-session adds the app template configurations and the `createApp` method to scaffold new sub-apps.

**Estimated scope**: Small  
**Prerequisites**: Session 6.1 complete  
**Deliverable**: App creation with 5 template options

## Objectives

1. Define template configurations
2. Implement `createApp` method
3. Test app scaffolding

---

## Task 1: Add Template Types

### Update packages/core/src/apps.ts

Add the template config interface:

```typescript
/**
 * Template file definition.
 */
export interface TemplateFile {
  /** Relative path within the app. */
  path: string
  /** File content (supports {{APP_NAME}}, {{APP_DESCRIPTION}}, {{APP_ID}} placeholders). */
  content: string
}

/**
 * Template definition for scaffolding.
 */
export interface AppTemplateConfig {
  /** Template identifier. */
  id: AppTemplate
  /** Display name. */
  name: string
  /** Description. */
  description: string
  /** Files to create. */
  files: TemplateFile[]
  /** Dependencies to install. */
  dependencies?: Record<string, string>
  /** Dev dependencies to install. */
  devDependencies?: Record<string, string>
  /** Scripts for package.json. */
  scripts?: Record<string, string>
}
```

---

## Task 2: Create Templates Module

### Create packages/shared/src/apps/templates.ts

```typescript
import type { AppTemplate, AppTemplateConfig } from '@keylimepi/core'

/**
 * Get all available templates.
 */
export function getTemplates(): AppTemplateConfig[] {
  return [
    getReactViteTemplate(),
    getNodeCliTemplate(),
    getNodeServerTemplate(),
    getStaticSiteTemplate(),
    getBlankTemplate()
  ]
}

/**
 * Get a specific template by ID.
 */
export function getTemplate(id: AppTemplate): AppTemplateConfig {
  const templates: Record<AppTemplate, () => AppTemplateConfig> = {
    'react-vite': getReactViteTemplate,
    'node-cli': getNodeCliTemplate,
    'node-server': getNodeServerTemplate,
    'static-site': getStaticSiteTemplate,
    'blank': getBlankTemplate
  }
  return templates[id]()
}

function getReactViteTemplate(): AppTemplateConfig {
  return {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'Modern React app with Vite bundler',
    files: [
      {
        path: 'src/main.tsx',
        content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)`
      },
      {
        path: 'src/App.tsx',
        content: `export function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          {{APP_NAME}}
        </h1>
        <p className="text-gray-600">{{APP_DESCRIPTION}}</p>
      </div>
    </div>
  )
}`
      },
      {
        path: 'src/index.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{APP_NAME}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()]
})`
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Development

\`\`\`bash
bun install
bun run dev
\`\`\`

## Build

\`\`\`bash
bun run build
\`\`\``
      }
    ],
    dependencies: {
      'react': '^19.0.0',
      'react-dom': '^19.0.0'
    },
    devDependencies: {
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      '@vitejs/plugin-react': '^4.0.0',
      'typescript': '^5.5.0',
      'vite': '^6.0.0',
      'tailwindcss': '^4.0.0',
      '@tailwindcss/vite': '^4.0.0'
    },
    scripts: {
      'dev': 'vite',
      'build': 'tsc && vite build',
      'preview': 'vite preview'
    }
  }
}

function getNodeCliTemplate(): AppTemplateConfig {
  return {
    id: 'node-cli',
    name: 'Node.js CLI',
    description: 'Command-line tool with TypeScript',
    files: [
      {
        path: 'src/index.ts',
        content: `#!/usr/bin/env node

/**
 * {{APP_NAME}}
 * {{APP_DESCRIPTION}}
 */

const args = process.argv.slice(2)

console.log('{{APP_NAME}}')
console.log('Arguments:', args)

// Your CLI logic here
`
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Usage

\`\`\`bash
bun run src/index.ts [args]
\`\`\``
      }
    ],
    devDependencies: {
      'typescript': '^5.5.0',
      '@types/node': '^22.0.0'
    },
    scripts: {
      'start': 'bun run src/index.ts',
      'build': 'tsc'
    }
  }
}

function getNodeServerTemplate(): AppTemplateConfig {
  return {
    id: 'node-server',
    name: 'Node.js Server',
    description: 'HTTP server with Hono framework',
    files: [
      {
        path: 'src/index.ts',
        content: `import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

app.get('/', (c) => {
  return c.json({
    name: '{{APP_NAME}}',
    description: '{{APP_DESCRIPTION}}'
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

const port = process.env.PORT ?? 3000
console.log(\`Server running at http://localhost:\${port}\`)

serve({ fetch: app.fetch, port: Number(port) })
`
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Development

\`\`\`bash
bun install
bun run dev
\`\`\`

## API

- \`GET /\` - App info
- \`GET /health\` - Health check`
      }
    ],
    dependencies: {
      'hono': '^4.0.0',
      '@hono/node-server': '^1.0.0'
    },
    devDependencies: {
      'typescript': '^5.5.0',
      '@types/node': '^22.0.0'
    },
    scripts: {
      'dev': 'bun run --watch src/index.ts',
      'start': 'bun run src/index.ts'
    }
  }
}

function getStaticSiteTemplate(): AppTemplateConfig {
  return {
    id: 'static-site',
    name: 'Static Site',
    description: 'Simple HTML/CSS/JS website',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{APP_NAME}}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>{{APP_NAME}}</h1>
    <p>{{APP_DESCRIPTION}}</p>
  </main>
  <script src="script.js"></script>
</body>
</html>`
      },
      {
        path: 'styles.css',
        content: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, sans-serif;
  line-height: 1.5;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

main {
  text-align: center;
  padding: 2rem;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  color: #333;
}

p {
  color: #666;
}`
      },
      {
        path: 'script.js',
        content: `// {{APP_NAME}}
console.log('App loaded!')
`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Development

Open \`index.html\` in a browser, or use a local server:

\`\`\`bash
npx serve .
\`\`\``
      }
    ],
    scripts: {
      'dev': 'npx serve .'
    }
  }
}

function getBlankTemplate(): AppTemplateConfig {
  return {
    id: 'blank',
    name: 'Blank Project',
    description: 'Empty project directory',
    files: [
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

This is a blank project. Add your files here!`
      }
    ]
  }
}
```

### Update packages/shared/src/apps/index.ts

```typescript
export { AppManager } from './manager'
export { getTemplate, getTemplates } from './templates'
```

---

## Task 3: Add createApp Method

### Update packages/shared/src/apps/manager.ts

Add the createApp method to the AppManager class:

```typescript
import { getTemplate } from './templates'
import type { SubApp, CreateAppParams, AppMetadata, AppTemplate } from '@keylimepi/core'

// Add to AppManager class:

  /**
   * Create a new sub-app from template.
   */
  async createApp(params: CreateAppParams): Promise<SubApp> {
    await this.ensureAppsDir()
    
    const id = this.generateId(params.name)
    const appPath = join(APPS_DIR, id)
    
    // Check if already exists
    const existing = await this.getApp(id)
    if (existing) {
      throw new Error(`App with ID "${id}" already exists`)
    }
    
    // Create directory
    await mkdir(appPath, { recursive: true })
    
    // Get template config
    const template = getTemplate(params.template)
    
    // Create files from template
    for (const file of template.files) {
      const filePath = join(appPath, file.path)
      const fileDir = join(filePath, '..')
      await mkdir(fileDir, { recursive: true })
      
      // Replace template variables
      const content = file.content
        .replace(/\{\{APP_NAME\}\}/g, params.name)
        .replace(/\{\{APP_DESCRIPTION\}\}/g, params.description ?? '')
        .replace(/\{\{APP_ID\}\}/g, id)
      
      await writeFile(filePath, content)
    }
    
    // Create package.json if template has dependencies/scripts
    if (template.dependencies || template.devDependencies || template.scripts) {
      const packageJson = {
        name: id,
        version: '0.1.0',
        description: params.description ?? '',
        type: 'module',
        scripts: template.scripts ?? {},
        dependencies: template.dependencies ?? {},
        devDependencies: template.devDependencies ?? {}
      }
      await writeFile(
        join(appPath, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      )
    }
    
    // Create metadata
    const now = new Date().toISOString()
    const meta: AppMetadata = {
      id,
      name: params.name,
      description: params.description ?? '',
      template: params.template,
      status: 'ready',
      createdAt: now,
      updatedAt: now
    }
    await this.writeMetadata(appPath, meta)
    
    // Initialize git
    await this.initGitRepo(appPath, `Initial commit: ${params.name}`)
    
    return (await this.getApp(id))!
  }
```

---

## Verification Checklist

- [ ] Template types added to `packages/core/src/apps.ts`
- [ ] `packages/shared/src/apps/templates.ts` created with 5 templates
- [ ] `createApp` method added to AppManager
- [ ] Template variable replacement works (`{{APP_NAME}}`, etc.)
- [ ] Git repository initialized on app creation
- [ ] `bun run typecheck:all` passes

## Test Commands

```bash
# In Node REPL or test file:
import { AppManager } from '@keylimepi/shared'
const manager = new AppManager()

# Create a test app
const app = await manager.createApp({
  name: 'Test App',
  description: 'A test application',
  template: 'react-vite'
})
console.log(app)

# List apps
const apps = await manager.listApps()
console.log(apps)

# Delete test app
await manager.deleteApp('test-app')
```

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(6.2): add app templates and createApp

- Add 5 templates: react-vite, node-cli, node-server, static-site, blank
- Implement createApp with template scaffolding
- Support template variables: APP_NAME, APP_DESCRIPTION, APP_ID
- Auto-generate package.json from template config"
```

---

## Next

Proceed to **SESSION-6.3-APP-LISTING-UI.md** to build the app management UI.
