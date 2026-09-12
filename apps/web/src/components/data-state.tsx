import type { ReactNode } from "react";
import { Button } from "./ui/button";

export function DataState({
  title,
  children,
  retry,
  pending = false,
}: {
  title: string;
  children?: ReactNode;
  retry?: () => void;
  pending?: boolean;
}) {
  return (
    <div className="data-state" aria-busy={pending || undefined}>
      <p className="data-state__title" role="status">
        {title}
      </p>
      {children != null && <div>{children}</div>}
      {retry && (
        <Button
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={retry}
          disabled={pending}
          aria-busy={pending || undefined}
        >
          Retry
        </Button>
      )}
    </div>
  );
}
