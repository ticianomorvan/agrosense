import { Component, type ReactNode } from "react";
import { DataState } from "./index";

export class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <DataState title="Map unavailable">
        Use the field list to review your fields. Reload the page to try loading
        the map again.
      </DataState>
    ) : (
      this.props.children
    );
  }
}
