import { cn } from "cn";
import type { ReactNode } from "react";
import { Button } from "./ui/button";

export function DataState({
  title,
  className,
  children,
  retry,
  pending = false,
}: {
  title: string;
  className?: string;
  children?: ReactNode;
  retry?: () => void;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col items-start justify-center gap-4",
        className,
      )}
      aria-busy={pending || undefined}
    >
      <p className="max-w-[60ch] font-semibold" role="status">
        {title}
      </p>
      {children != null && <div className="max-w-[60ch]">{children}</div>}
      {retry && (
        <Button
          variant="outline"
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
