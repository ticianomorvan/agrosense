import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, DataState } from "./components/ui";
import { FieldOverview } from "./features/fields/FieldOverview";
import {
  createDemoSource,
  type FarmDataSource,
} from "./features/fields/queries";
import { createQueryClient } from "./lib/query-client";
import "./styles.css";

const queryClient = createQueryClient();
function App() {
  const [source, setSource] = useState<FarmDataSource>();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState(false);
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
              Your farm has not been connected in this frontend build. Explore
              the demo to preview field selection and satellite controls.
            </DataState>
            <Button
              variant="primary"
              pending={loadingDemo}
              onClick={async () => {
                setLoadingDemo(true);
                setDemoError(false);
                try {
                  setSource(await createDemoSource());
                } catch {
                  setDemoError(true);
                } finally {
                  setLoadingDemo(false);
                }
              }}
            >
              {loadingDemo ? "Opening demo…" : "Explore demo farm"}
            </Button>
            {demoError && (
              <p role="alert">
                The demo could not be loaded. Try opening it again.
              </p>
            )}
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
