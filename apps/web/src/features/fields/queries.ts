import {
  type DashboardResponse,
  dashboardResponseSchema,
  type SatellitePreview,
  type SatelliteRequest,
  satellitePreviewSchema,
} from "@agrosense/contracts";
import { queryOptions } from "@tanstack/react-query";
import { getJson, postJson } from "../../lib/api";

export type FarmDataSource = {
  scope: string;
  farmId: string;
  loadDashboard: (signal: AbortSignal) => Promise<DashboardResponse>;
  loadSatellite?: (
    window: SatelliteRequest,
    signal: AbortSignal,
  ) => Promise<SatellitePreview>;
};
export function dashboardOptions(source: FarmDataSource) {
  return queryOptions({
    queryKey: ["dashboard", source.scope, source.farmId],
    queryFn: ({ signal }) => source.loadDashboard(signal),
  });
}
export function createLiveSource(
  userId: string,
  farmId: string,
  getAccessToken: () => Promise<string>,
): FarmDataSource {
  return {
    scope: `user:${userId}`,
    farmId,
    loadSatellite: async (window, signal) =>
      postJson(
        `/api/farms/${encodeURIComponent(farmId)}/satellite`,
        window,
        satellitePreviewSchema,
        { signal, accessToken: await getAccessToken() },
      ),
    loadDashboard: async (signal) =>
      getJson(
        `/api/farms/${encodeURIComponent(farmId)}/dashboard`,
        dashboardResponseSchema,
        { signal, accessToken: await getAccessToken() },
      ),
  };
}
