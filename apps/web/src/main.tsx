import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DataState } from "./components/data-state";
import { FieldOverview } from "./features/fields/FieldOverview";
import type { FarmDataSource } from "./features/fields/queries";
import { shouldRetry } from "./lib/api";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
function App({ source }: { source?: FarmDataSource }) {
  return (
    <QueryClientProvider client={queryClient}>
      <a
        className="absolute top-2 left-4 z-[1000] min-h-11 -translate-y-[200%] bg-card p-3 focus:translate-y-0"
        href="#workspace-content"
      >
        Skip to workspace
      </a>
      <header className="flex min-h-14 flex-wrap items-center gap-4 border-b bg-card px-4 py-3 md:gap-6 md:px-6 md:py-4 lg:min-h-16">
        <span className="text-xl font-semibold">AgroSense</span>
        <span>Field workspace</span>
      </header>
      <div id="workspace-content" tabIndex={-1}>
        {source ? (
          <FieldOverview
            key={`${source.scope}:${source.farmId}`}
            source={source}
          />
        ) : (
          <main className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6">
            <h1>Your field workspace</h1>
            <DataState title="Farm connection unavailable">
              Field information will appear when your farm is connected.
            </DataState>
          </main>
        )}
      </div>
    </QueryClientProvider>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
