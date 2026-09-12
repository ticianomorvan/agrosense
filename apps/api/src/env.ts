import type { AgentBindings } from "./agent/config";
import type { AutomationBindings } from "./automation/notification";
import type { createUserClient } from "./lib/supabase";

import type { SatelliteBindings } from "./satellite/provider";

export type ApiEnv = {
  Bindings: AgentBindings & SatelliteBindings & AutomationBindings;
  Variables: { userId: string; supabase: ReturnType<typeof createUserClient> };
};
