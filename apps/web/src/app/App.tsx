import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "../components/ui/button";
import { SignInPage } from "../features/auth/SignInPage";
import { useAuth } from "../features/auth/use-auth";
import { LandingPage } from "../pages/LandingPage";
import { WorkspacePage } from "../pages/WorkspacePage";
import {
  type AppRoute,
  routeFromPath,
  routePaths,
  workspaceNeedsSignIn,
} from "./routing";

export function App() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [route, setRoute] = useState(() => routeFromPath(location.pathname));
  const navigate = useCallback((next: AppRoute, replace = false) => {
    const path = routePaths[next];
    if (location.pathname !== path)
      history[replace ? "replaceState" : "pushState"]({}, "", path);
    setRoute(next);
    requestAnimationFrame(() =>
      document.getElementById("main-content")?.focus(),
    );
  }, []);
  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(location.pathname));
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (workspaceNeedsSignIn(route, auth.status, Boolean(auth.session)))
      navigate("sign-in", true);
  }, [auth, navigate, route]);

  async function signOut() {
    if (auth.status !== "ready") return;
    await auth.client.auth.signOut({ scope: "local" });
    queryClient.clear();
    navigate("landing", true);
  }

  return (
    <>
      <a
        className="absolute top-2 left-4 z-[1000] min-h-11 -translate-y-[200%] bg-card p-3 focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-4 border-b bg-card px-4 py-3 md:px-6 lg:min-h-16">
        <a
          className="text-xl font-semibold no-underline"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("landing");
          }}
        >
          AgroSense
        </a>
        <nav
          className="flex flex-wrap items-center gap-2"
          aria-label="Main navigation"
        >
          {auth.status === "ready" && auth.session ? (
            <>
              <a
                className={buttonVariants({ variant: "ghost" })}
                href="/app"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("workspace");
                }}
              >
                Workspace
              </a>
              <Button variant="outline" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : route !== "sign-in" ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href="/sign-in"
              onClick={(event) => {
                event.preventDefault();
                navigate("sign-in");
              }}
            >
              Sign in
            </a>
          ) : null}
        </nav>
      </header>
      {route === "landing" ? (
        <LandingPage onStart={() => navigate("sign-in")} />
      ) : route === "sign-in" ? (
        <SignInPage
          client={auth.status === "ready" ? auth.client : null}
          configurationError={
            auth.status === "unavailable" ? auth.message : undefined
          }
          onSignedIn={() => navigate("workspace", true)}
        />
      ) : auth.status === "ready" && auth.session ? (
        <WorkspacePage session={auth.session} />
      ) : (
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6"
          aria-busy="true"
        >
          <h1>Opening your workspace…</h1>
        </main>
      )}
    </>
  );
}
