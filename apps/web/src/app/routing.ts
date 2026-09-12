export type AppRoute = "landing" | "sign-in" | "workspace";

export function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/sign-in") return "sign-in";
  if (pathname === "/app" || pathname.startsWith("/app/")) return "workspace";
  return "landing";
}

export const routePaths = {
  landing: "/",
  "sign-in": "/sign-in",
  workspace: "/app",
} satisfies Record<AppRoute, string>;
