/**
 * Type declarations for Electron webview element.
 */

declare namespace Electron {
  interface WebviewTag extends HTMLElement {
    src: string
    partition: string
    allowpopups: string
    loadURL(url: string): void
    reload(): void
    goBack(): void
    goForward(): void
    openDevTools(): void
    closeDevTools(): void
    isDevToolsOpened(): boolean
  }

  interface DidFailLoadEvent extends Event {
    errorCode: number
    errorDescription: string
    validatedURL: string
  }

  interface DidNavigateEvent extends Event {
    url: string
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: boolean
          preload?: string
        },
        HTMLElement
      >
    }
  }
}

export {}
