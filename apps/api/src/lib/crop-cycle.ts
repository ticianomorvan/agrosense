import {
  type UpdateCropCycleRequest,
  type UpdateCropCycleResponse,
  updateCropCycleResponseSchema,
} from "@agrosense/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type UserClient = SupabaseClient<Database>;

export type CropCycleFailure =
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string };

export class CropCycleError extends Error {
  constructor(public readonly failure: CropCycleFailure) {
    super(failure.kind);
  }
}

export async function updateCropCycle(
  client: UserClient,
  farmId: string,
  plotId: string,
  request: UpdateCropCycleRequest,
): Promise<UpdateCropCycleResponse> {
  const { data, error } = await client.rpc("update_crop_cycle", {
    p_farm_id: farmId,
    p_plot_id: plotId,
    p_expected_data_version: request.expectedDataVersion,
    p_patch: request,
  });
  if (error) {
    switch (error.message) {
      case "NOT_FOUND":
        throw new CropCycleError({ kind: "not_found" });
      case "VERSION_CONFLICT":
        throw new CropCycleError({ kind: "conflict" });
      default:
        if (error.message.startsWith("INVALID:"))
          throw new CropCycleError({
            kind: "invalid",
            message: error.message.slice("INVALID:".length),
          });
        throw error;
    }
  }
  return updateCropCycleResponseSchema.parse(data);
}
