import type { AppTemplate, AppTemplateConfig } from '@anyapp/core'

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
import { App } from './App.js'
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
