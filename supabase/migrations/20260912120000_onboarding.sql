-- Owner-scoped setup writes used by the authenticated web onboarding flow.
BEGIN;

CREATE FUNCTION public.create_user_farm(p_owner_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE farm_row public.farms%ROWTYPE;
BEGIN
  INSERT INTO public.farms (
    owner_id, name, province, locality, boundary_geojson, declared_area_ha,
    data_mode, custom_rules
  ) VALUES (
    p_owner_id,
    btrim(p_payload->>'name'),
    btrim(p_payload->>'province'),
    nullif(btrim(p_payload->>'locality'), ''),
    p_payload->'boundary',
    (p_payload->>'declaredAreaHa')::numeric,
    'live',
    '[]'::jsonb
  ) RETURNING * INTO farm_row;

  RETURN jsonb_build_object(
    'id', farm_row.id,
    'name', farm_row.name,
    'province', farm_row.province,
    'locality', farm_row.locality,
    'timezone', farm_row.timezone,
    'dataMode', farm_row.data_mode,
    'boundary', farm_row.boundary_geojson,
    'declaredAreaHa', farm_row.declared_area_ha,
    'dataVersion', farm_row.data_version,
    'customRules', farm_row.custom_rules
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_user_farm(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_farm(uuid, jsonb) TO service_role;

CREATE FUNCTION public.create_farm_plot(
  p_owner_id uuid,
  p_farm_id uuid,
  p_expected_data_version integer,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE farm_row public.farms%ROWTYPE;
  plot_row public.plots%ROWTYPE;
  cycle_row public.crop_cycles%ROWTYPE;
  cycle_payload jsonb;
  next_version integer;
BEGIN
  SELECT * INTO farm_row
  FROM public.farms
  WHERE id = p_farm_id AND owner_id = p_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'P0002' USING MESSAGE = 'Farm not found'; END IF;
  IF farm_row.data_version IS DISTINCT FROM p_expected_data_version THEN
    RAISE SQLSTATE '40001' USING MESSAGE = 'Farm changed during setup';
  END IF;
  IF (SELECT count(*) FROM public.plots WHERE farm_id = p_farm_id) >= 10 THEN
    RAISE SQLSTATE '54000' USING MESSAGE = 'Plot limit reached';
  END IF;

  INSERT INTO public.plots (
    farm_id, name, boundary_geojson, sample_point_geojson, declared_area_ha
  ) VALUES (
    p_farm_id,
    btrim(p_payload->>'name'),
    p_payload->'boundary',
    p_payload->'samplePoint',
    (p_payload->>'declaredAreaHa')::numeric
  ) RETURNING * INTO plot_row;

  cycle_payload := p_payload->'cropCycle';
  INSERT INTO public.crop_cycles (
    plot_id, crop_code, season_label, sown_on, stage_code, stage_as_of
  ) VALUES (
    plot_row.id,
    cycle_payload->>'cropCode',
    cycle_payload->>'seasonLabel',
    nullif(cycle_payload->>'sownOn', '')::date,
    nullif(cycle_payload->>'stageCode', ''),
    nullif(cycle_payload->>'stageAsOf', '')::date
  ) RETURNING * INTO cycle_row;

  UPDATE public.farms
  SET data_version = data_version + 1
  WHERE id = p_farm_id
  RETURNING data_version INTO next_version;

  RETURN jsonb_build_object(
    'farmId', p_farm_id,
    'dataVersion', next_version,
    'plot', jsonb_build_object(
      'id', plot_row.id,
      'name', plot_row.name,
      'boundary', plot_row.boundary_geojson,
      'samplePoint', plot_row.sample_point_geojson,
      'declaredAreaHa', plot_row.declared_area_ha,
      'activeCropCycle', jsonb_build_object(
        'id', cycle_row.id,
        'plotId', cycle_row.plot_id,
        'cropCode', cycle_row.crop_code,
        'seasonLabel', cycle_row.season_label,
        'sownOn', cycle_row.sown_on,
        'stageCode', cycle_row.stage_code,
        'stageAsOf', cycle_row.stage_as_of,
        'endedOn', cycle_row.ended_on,
        'updatedAt', to_char(
          cycle_row.updated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      )
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_farm_plot(uuid, uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_farm_plot(uuid, uuid, integer, jsonb)
  TO service_role;

COMMIT;
