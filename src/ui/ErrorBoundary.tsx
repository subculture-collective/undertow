import { Component, type ReactNode } from 'react';

/**
 * Catches rendering errors so one broken panel can't blank the editor.
 * The project is autosaved, so reloading loses at most the last second of edits.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) { console.error('Undertow crashed:', error); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h3>Something went wrong</h3>
        <p>Your project is saved. Reload to keep working.</p>
        <pre>{this.state.error.message}</pre>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
