import {
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from "react";

export function Button({
  variant = "secondary",
  pending = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`button button--${variant} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
export type Tone = "ok" | "warning" | "critical" | "info" | "unknown";
export function StatusLabel({
  tone = "unknown",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span className={`status-label status-label--${tone}`}>{children}</span>
  );
}
export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <div className="select-field">
      <label htmlFor={id}>{label}</label>
      <select {...props} id={id}>
        {children}
      </select>
    </div>
  );
}
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
        <Button onClick={retry} pending={pending}>
          Retry
        </Button>
      )}
    </div>
  );
}
