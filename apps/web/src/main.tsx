import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DataState } from "./components/ui";
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
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <header className="site-header">
        <span className="wordmark">AgroSense</span>
        <span>Field workspace</span>
      </header>
      <div id="workspace-content" tabIndex={-1}>
        {source ? (
          <FieldOverview
            key={`${source.scope}:${source.farmId}`}
            source={source}
          />
        ) : (
          <main className="workspace">
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
