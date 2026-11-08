import { Component, type ReactNode } from 'react'

/** Shows a plain message and a way back instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <h1 className="font-display text-xl font-semibold">Something broke in this window.</h1>
        <p className="max-w-md font-mono text-sm text-muted">{error.message}</p>
        <p className="text-sm text-muted">
          Your tiles are saved. Tiles keep running from the tray.
        </p>
        <button
          type="button"
          className="rounded-lg bg-glaze px-4 py-2 text-sm font-medium text-ink-900"
          onClick={() => location.reload()}
        >
          Reload
        </button>
      </main>
    )
  }
}
