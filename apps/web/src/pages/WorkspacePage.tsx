import type { Session } from "@supabase/supabase-js";
import { DataState } from "../components/data-state";

export function WorkspacePage({ session }: { session: Session }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6"
    >
      <h1>Your field workspace</h1>
      <DataState title="Loading your farms…" pending>
        Preparing the workspace for {session.user.email ?? "your account"}.
      </DataState>
    </main>
  );
}
