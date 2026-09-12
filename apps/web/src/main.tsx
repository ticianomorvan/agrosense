import { healthResponseSchema } from "@agrosense/contracts";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const [status, setStatus] = useState("Connecting to the API…");

  useEffect(() => {
    const controller = new AbortController();
    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Health request failed");
        healthResponseSchema.parse(await response.json());
        setStatus("API connected");
      } catch {
        if (!controller.signal.aborted)
          setStatus("API unavailable. Refresh to retry.");
      }
    }
    void checkHealth();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">AgroSense / Workspace</p>
      <h1>A foundation for what grows next.</h1>
      <p>Your AgroSense workspace is ready for its first feature.</p>
      <p className="status" role="status">
        {status}
      </p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
