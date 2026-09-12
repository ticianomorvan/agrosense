import { lazy, Suspense } from "react";
import { DataState } from "../../components/data-state";
import { ErrorBoundary } from "../../components/error-boundary";
import type { BoundaryMapDrawerProps } from "./BoundaryMapDrawer";

const BoundaryMapDrawer = lazy(() =>
  import("./BoundaryMapDrawer").then((module) => ({
    default: module.BoundaryMapDrawer,
  })),
);

export function BoundaryMap(props: BoundaryMapDrawerProps) {
  return (
    <ErrorBoundary
      fallback={
        <DataState
          className="min-h-80 md:min-h-96"
          title="Boundary map unavailable"
        >
          Open the manual coordinate inputs below to enter the boundary.
        </DataState>
      }
    >
      <Suspense
        fallback={
          <DataState
            className="min-h-80 md:min-h-96"
            title="Loading the boundary map…"
            pending
          />
        }
      >
        <BoundaryMapDrawer {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
