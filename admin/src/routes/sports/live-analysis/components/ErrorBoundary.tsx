import { Component } from "react";
import type { ReactNode } from "react";
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Notice } from '@/ui/components/Notice';
import { IconRefresh, IconAlertTriangle } from '@tabler/icons-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card>
          <Notice tone="error" live="assertive" title="Something went wrong"
            icon={<IconAlertTriangle size={18} />}
            action={<Button variant="primary" icon={<IconRefresh size={16} />} onClick={this.handleReset}>Try Again</Button>}>
            {this.state.error?.message || "An unexpected error occurred"}
          </Notice>
        </Card>
      );
    }

    return this.props.children;
  }
}

