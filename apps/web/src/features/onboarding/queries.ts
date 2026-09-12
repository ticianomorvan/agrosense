import {
  type CreateFarmRequest,
  type CreatePlotRequest,
  createFarmResponseSchema,
  createPlotResponseSchema,
  type FarmListResponse,
  farmListResponseSchema,
} from "@agrosense/contracts";
import { queryOptions } from "@tanstack/react-query";
import { getJson, postJson } from "../../lib/api";

export type OnboardingSource = {
  scope: string;
  loadFarms: (signal: AbortSignal) => Promise<FarmListResponse>;
  createFarm: (request: CreateFarmRequest) => ReturnType<typeof createFarm>;
  createPlot: (
    farmId: string,
    request: CreatePlotRequest,
  ) => ReturnType<typeof createPlot>;
};

export function createOnboardingSource(
  userId: string,
  getAccessToken: () => Promise<string>,
): OnboardingSource {
  const options = async () => ({ accessToken: await getAccessToken() });
  return {
    scope: `user:${userId}`,
    loadFarms: async (signal) =>
      getJson("/api/farms", farmListResponseSchema, {
        ...(await options()),
        signal,
      }),
    createFarm: async (request) => createFarm(request, await options()),
    createPlot: async (farmId, request) =>
      createPlot(farmId, request, await options()),
  };
}

export function farmsOptions(source: OnboardingSource) {
  return queryOptions({
    queryKey: ["farms", source.scope],
    queryFn: ({ signal }) => source.loadFarms(signal),
  });
}

function createFarm(
  request: CreateFarmRequest,
  options: { accessToken: string },
) {
  return postJson("/api/farms", request, createFarmResponseSchema, options);
}

function createPlot(
  farmId: string,
  request: CreatePlotRequest,
  options: { accessToken: string },
) {
  return postJson(
    `/api/farms/${encodeURIComponent(farmId)}/plots`,
    request,
    createPlotResponseSchema,
    options,
  );
}
