import type { AgentBindings } from "./agent/config";
import type { createUserClient } from "./lib/supabase";

export type ApiEnv = {
  Bindings: AgentBindings;
  Variables: { userId: string; supabase: ReturnType<typeof createUserClient> };
};
