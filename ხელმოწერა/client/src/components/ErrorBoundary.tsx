import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
  onReset?: () => void;
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

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            {this.props.fallbackMessage || "დაფიქსირდა შეცდომა"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {this.state.error?.message || "მოხდა მოულოდნელი შეცდომა. გთხოვთ, სცადოთ თავიდან."}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            თავიდან სცადეთ
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
