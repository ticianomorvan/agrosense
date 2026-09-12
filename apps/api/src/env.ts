import type { AgentBindings } from "./agent/config";
import type { createUserClient } from "./lib/supabase";

import type { SatelliteBindings } from "./satellite/provider";

export type ApiEnv = {
  Bindings: AgentBindings & SatelliteBindings;
  Variables: { userId: string; supabase: ReturnType<typeof createUserClient> };
};
