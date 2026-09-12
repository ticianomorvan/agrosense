import type { Farm } from "@agrosense/contracts";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { DataState } from "../components/data-state";
import { Button } from "../components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select";
import { FieldOverview } from "../features/fields/FieldOverview";
import { createLiveSource } from "../features/fields/queries";
import { FarmSetup } from "../features/onboarding/FarmSetup";
import { PlotSetup } from "../features/onboarding/PlotSetup";
import {
  createOnboardingSource,
  farmsOptions,
} from "../features/onboarding/queries";

export function WorkspacePage({ session }: { session: Session }) {
  const id = useId();
  const queryClient = useQueryClient();
  const accessToken = session.access_token;
  const ownerId = session.user.id;
  const onboarding = useMemo(
    () => createOnboardingSource(ownerId, async () => accessToken),
    [accessToken, ownerId],
  );
  const farmsQuery = useQuery(farmsOptions(onboarding));
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [addingFarm, setAddingFarm] = useState(false);
  const [plotFarm, setPlotFarm] = useState<Farm | null>(null);

  useEffect(() => {
    const farms = farmsQuery.data?.farms;
    if (!farms?.length) {
      setSelectedFarmId(null);
      return;
    }
    if (!selectedFarmId || !farms.some(({ id }) => id === selectedFarmId))
      setSelectedFarmId(farms[0]?.id ?? null);
  }, [farmsQuery.data, selectedFarmId]);

  if (farmsQuery.isPending)
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
  if (!farmsQuery.data)
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6"
      >
        <h1>Your field workspace</h1>
        <DataState
          title="Farm list unavailable"
          retry={() => void farmsQuery.refetch()}
          pending={farmsQuery.isFetching}
        >
          {farmsQuery.error?.message ?? "Please try again."}
        </DataState>
      </main>
    );

  const farms = farmsQuery.data.farms;
  if (addingFarm || farms.length === 0)
    return (
      <FarmSetup
        createFarm={onboarding.createFarm}
        onCancel={farms.length ? () => setAddingFarm(false) : undefined}
        onCreated={(farm) => {
          queryClient.setQueryData(farmsOptions(onboarding).queryKey, {
            farms: [
              ...farms,
              {
                id: farm.id,
                name: farm.name,
                province: farm.province,
                locality: farm.locality,
                dataMode: farm.dataMode,
              },
            ],
          });
          setSelectedFarmId(farm.id);
          setAddingFarm(false);
          setPlotFarm(farm);
        }}
      />
    );

  if (plotFarm)
    return (
      <PlotSetup
        farm={plotFarm}
        createPlot={(request) => onboarding.createPlot(plotFarm.id, request)}
        onCancel={() => setPlotFarm(null)}
        onCreated={() => {
          void queryClient.invalidateQueries({
            queryKey: ["dashboard", onboarding.scope, plotFarm.id],
          });
          setSelectedFarmId(plotFarm.id);
          setPlotFarm(null);
        }}
      />
    );

  const selectedFarm =
    farms.find(({ id }) => id === selectedFarmId) ?? farms[0];
  if (!selectedFarm) return null;
  const liveSource = createLiveSource(
    ownerId,
    selectedFarm.id,
    async () => accessToken,
  );
  const toolbar = (
    <div className="flex w-full flex-wrap items-end gap-3 lg:w-auto lg:justify-end">
      <label
        className="grid min-w-52 flex-1 gap-2 font-semibold lg:flex-none"
        htmlFor={`${id}-farm`}
      >
        Farm
        <NativeSelect
          id={`${id}-farm`}
          className="w-full"
          value={selectedFarm.id}
          onChange={(event) => setSelectedFarmId(event.target.value)}
        >
          {farms.map((farm) => (
            <NativeSelectOption value={farm.id} key={farm.id}>
              {farm.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <Button variant="outline" onClick={() => setAddingFarm(true)}>
        Add farm
      </Button>
    </div>
  );
  return (
    <FieldOverview
      key={`${onboarding.scope}:${selectedFarm.id}`}
      source={liveSource}
      toolbar={toolbar}
      onAddPlot={setPlotFarm}
    />
  );
}
