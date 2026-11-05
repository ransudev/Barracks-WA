"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/app/components/ui";

type ErrorBoundaryProps = {
  children: ReactNode;
  // Changing this value, for example by navigating, clears the error.
  resetKey?: string;
};

// Shows a recovery message when a screen fails to render or its code fails to
// load, instead of leaving a blank page.
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Unable to display this screen", error);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-loading" role="alert">
        <p className="eyebrow">Barracks</p>
        <h1>This screen could not be displayed</h1>
        <p>Your saved data is not affected. Reload the page to try again.</p>
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    );
  }
}
