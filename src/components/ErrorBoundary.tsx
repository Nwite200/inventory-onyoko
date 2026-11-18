import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/** Keeps one broken screen from taking the whole till down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen crashed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state screen-error">
        <span className="empty-ico"><Icon name="alert" size={22} /></span>
        <strong>This screen could not be displayed</strong>
        <p>{this.state.error.message || 'An unexpected error occurred.'}</p>
        <div className="row-actions" style={{ marginTop: 6 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>Try again</button>
          <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}
