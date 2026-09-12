import { type FormEvent, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { AuthClient } from "./client";

export function SignInPage({
  client,
  configurationError,
  onSignedIn,
}: {
  client: AuthClient | null;
  configurationError?: string;
  onSignedIn: () => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    // Email/password sign-in follows the Supabase v2 Auth API.
    // https://supabase.com/docs/reference/javascript/auth-signinwithpassword
    const { data, error: authError } = await client.auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (authError || !data.session) {
      setError("Email or password not recognized. Please try again.");
      return;
    }
    onSignedIn();
  }
  return (
    <main
      id="main-content"
      className="mx-auto grid w-full max-w-[1600px] place-items-center p-4 py-12 md:p-6 md:py-16"
    >
      <section className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6">
        <div className="space-y-2">
          <p className="text-sm leading-normal font-semibold text-primary">
            AgroSense workspace
          </p>
          <h1>Sign in</h1>
          <p className="text-muted-foreground">
            Use your AgroSense account to open your farms and fields.
          </p>
        </div>
        {configurationError ? (
          <div className="space-y-3" role="alert">
            <h2>Sign in unavailable</h2>
            <p>{configurationError} Reload the page to try again.</p>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit} aria-busy={pending}>
            <label className="grid gap-2 font-semibold" htmlFor={`${id}-email`}>
              Email
              <Input
                id={`${id}-email`}
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={!client || pending}
              />
            </label>
            <label
              className="grid gap-2 font-semibold"
              htmlFor={`${id}-password`}
            >
              Password
              <Input
                id={`${id}-password`}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={!client || pending}
                aria-describedby={error ? `${id}-error` : undefined}
                aria-invalid={!!error || undefined}
              />
            </label>
            {error && (
              <p id={`${id}-error`} role="alert">
                {error}
              </p>
            )}
            <Button
              className="w-full"
              type="submit"
              disabled={!client || pending}
            >
              {pending
                ? "Signing in…"
                : client
                  ? "Sign in"
                  : "Loading sign in…"}
            </Button>
          </form>
        )}
        <p className="text-sm leading-normal text-muted-foreground">
          Need an account? Ask your AgroSense administrator.
        </p>
      </section>
    </main>
  );
}
