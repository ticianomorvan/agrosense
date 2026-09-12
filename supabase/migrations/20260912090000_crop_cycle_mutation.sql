BEGIN;

CREATE FUNCTION public.update_crop_cycle(
  p_farm_id uuid,
  p_plot_id uuid,
  p_expected_data_version integer,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  farm_row public.farms%ROWTYPE;
  plot_exists boolean;
  cycle_row public.crop_cycles%ROWTYPE;
  next_crop_code text;
  next_sown_on date;
  next_stage_code text;
  next_stage_as_of date;
  next_version integer;
  key_name text;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID:Request body must be an object';
  END IF;
  FOR key_name IN SELECT jsonb_object_keys(p_patch) LOOP
    IF key_name NOT IN ('expectedDataVersion', 'cropCode', 'sownOn', 'stageCode', 'stageAsOf') THEN
      RAISE EXCEPTION 'INVALID:Unknown crop-cycle field';
    END IF;
  END LOOP;
  IF NOT (p_patch ? 'cropCode' OR p_patch ? 'sownOn' OR p_patch ? 'stageCode' OR p_patch ? 'stageAsOf') THEN
    RAISE EXCEPTION 'INVALID:At least one crop-cycle field is required';
  END IF;
  IF (p_patch ? 'stageCode') <> (p_patch ? 'stageAsOf') THEN
    RAISE EXCEPTION 'INVALID:stageCode and stageAsOf must be supplied together';
  END IF;

  SELECT f.* INTO farm_row
  FROM public.farms AS f
  WHERE f.id = p_farm_id AND f.owner_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF farm_row.data_version <> p_expected_data_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.plots AS p
    WHERE p.id = p_plot_id AND p.farm_id = p_farm_id
  ) INTO plot_exists;
  IF NOT plot_exists THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT c.* INTO cycle_row
  FROM public.crop_cycles AS c
  WHERE c.plot_id = p_plot_id AND c.ended_on IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  next_crop_code := CASE WHEN p_patch ? 'cropCode'
    THEN p_patch->>'cropCode' ELSE cycle_row.crop_code END;
  next_sown_on := CASE WHEN p_patch ? 'sownOn'
    THEN NULLIF(p_patch->>'sownOn', '')::date ELSE cycle_row.sown_on END;
  next_stage_code := CASE WHEN p_patch ? 'stageCode'
    THEN p_patch->>'stageCode' ELSE cycle_row.stage_code END;
  next_stage_as_of := CASE WHEN p_patch ? 'stageAsOf'
    THEN NULLIF(p_patch->>'stageAsOf', '')::date ELSE cycle_row.stage_as_of END;

  IF next_crop_code NOT IN ('maize', 'soybean') THEN
    RAISE EXCEPTION 'INVALID:cropCode is invalid';
  END IF;
  IF p_patch ? 'cropCode' AND next_crop_code <> cycle_row.crop_code
     AND NOT (p_patch ? 'stageCode' AND p_patch ? 'stageAsOf') THEN
    RAISE EXCEPTION 'INVALID:Changing cropCode requires stageCode and stageAsOf';
  END IF;
  IF (next_stage_code IS NULL) <> (next_stage_as_of IS NULL) THEN
    RAISE EXCEPTION 'INVALID:stageCode and stageAsOf must be both null or present';
  END IF;
  IF next_stage_code IS NOT NULL AND NOT (
    (next_crop_code = 'maize' AND next_stage_code IN ('V3', 'V6', 'VT', 'R1')) OR
    (next_crop_code = 'soybean' AND next_stage_code IN ('V2', 'R1', 'R4', 'R6'))
  ) THEN
    RAISE EXCEPTION 'INVALID:stageCode is incompatible with cropCode';
  END IF;
  IF next_sown_on > (now() AT TIME ZONE 'America/Argentina/Cordoba')::date
     OR next_stage_as_of > (now() AT TIME ZONE 'America/Argentina/Cordoba')::date THEN
    RAISE EXCEPTION 'INVALID:Dates cannot be in the future';
  END IF;
  IF next_sown_on IS NOT NULL AND next_stage_as_of IS NOT NULL
     AND next_stage_as_of < next_sown_on THEN
    RAISE EXCEPTION 'INVALID:stageAsOf cannot precede sownOn';
  END IF;

  UPDATE public.crop_cycles
  SET crop_code = next_crop_code,
      sown_on = next_sown_on,
      stage_code = next_stage_code,
      stage_as_of = next_stage_as_of
  WHERE id = cycle_row.id;

  next_version := farm_row.data_version + 1;
  UPDATE public.farms SET data_version = next_version WHERE id = p_farm_id;

  SELECT c.* INTO cycle_row FROM public.crop_cycles AS c WHERE c.id = cycle_row.id;
  RETURN jsonb_build_object(
    'farmId', p_farm_id,
    'dataVersion', next_version,
    'cropCycle', jsonb_build_object(
      'id', cycle_row.id,
      'plotId', cycle_row.plot_id,
      'cropCode', cycle_row.crop_code,
      'seasonLabel', cycle_row.season_label,
      'sownOn', cycle_row.sown_on,
      'stageCode', cycle_row.stage_code,
      'stageAsOf', cycle_row.stage_as_of,
      'endedOn', cycle_row.ended_on,
      'updatedAt', to_char(cycle_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_crop_cycle(uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_crop_cycle(uuid, uuid, integer, jsonb) TO authenticated;
COMMIT;
