-- Keep provider publication behind the validated Worker/service-role boundary.
BEGIN;

DROP FUNCTION public.admit_farm_refresh(uuid, timestamptz);
DROP FUNCTION public.publish_farm_refresh(uuid, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb);
DROP FUNCTION public.fail_farm_refresh(uuid, integer, timestamptz, timestamptz, text);

CREATE FUNCTION public.admit_farm_refresh(p_owner_id uuid, p_farm_id uuid, p_attempt_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE f public.farms%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.farms WHERE id = p_farm_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_attempt_at IS NULL OR NOT isfinite(p_attempt_at) THEN RAISE EXCEPTION 'INVALID_PROVIDER_DATA'; END IF;
  IF f.last_attempt_at IS NOT NULL
     AND f.last_attempt_at > p_attempt_at - interval '60 seconds' THEN
    RAISE EXCEPTION 'RATE_LIMITED:%', ceil(extract(epoch FROM (interval '60 seconds' - (p_attempt_at - f.last_attempt_at))))::integer;
  END IF;
  UPDATE public.farms SET last_attempt_at = p_attempt_at WHERE id = p_farm_id;
  RETURN jsonb_build_object('dataVersion', f.data_version, 'dataMode', f.data_mode, 'customRules', f.custom_rules);
END;
$$;
REVOKE ALL ON FUNCTION public.admit_farm_refresh(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_farm_refresh(uuid, uuid, timestamptz) TO service_role;

CREATE FUNCTION public.publish_farm_refresh(
  p_owner_id uuid,
  p_farm_id uuid,
  p_expected_data_version integer,
  p_attempt_at timestamptz,
  p_published_at timestamptz,
  p_forecast jsonb,
  p_events jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE f public.farms%ROWTYPE; event_item jsonb; alert_item jsonb; event_row public.events%ROWTYPE; next_version integer;
BEGIN
  SELECT * INTO f FROM public.farms WHERE id = p_farm_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_expected_data_version IS NULL OR p_attempt_at IS NULL OR f.last_attempt_at IS NULL
     OR f.data_version IS DISTINCT FROM p_expected_data_version OR f.last_attempt_at IS DISTINCT FROM p_attempt_at
    THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF p_published_at IS NULL OR NOT isfinite(p_published_at) OR p_published_at < p_attempt_at
     OR jsonb_typeof(p_forecast) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_forecast->'plots') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_PROVIDER_DATA';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(f.forecast_summary->'plots') old_plot
    JOIN jsonb_array_elements(p_forecast->'plots') new_plot ON old_plot->>'plotId' = new_plot->>'plotId'
    WHERE (new_plot->'source'->>'issuedAt')::timestamptz < (old_plot->'source'->>'issuedAt')::timestamptz
  ) THEN RAISE EXCEPTION 'STALE_PROVIDER_DATA'; END IF;
  FOR event_item IN SELECT * FROM jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) LOOP
    INSERT INTO public.events (
      farm_id, source_code, source_event_key, kind, title, starts_at, ends_at,
      issued_at, retrieved_at, source_url, status, evidence, is_demo
    ) VALUES (
      p_farm_id, event_item->>'sourceCode', event_item->>'sourceEventKey', event_item->>'kind',
      event_item->>'title', (event_item->>'startsAt')::timestamptz, (event_item->>'endsAt')::timestamptz,
      nullif(event_item->>'issuedAt','')::timestamptz, (event_item->>'retrievedAt')::timestamptz,
      nullif(event_item->>'sourceUrl',''), event_item->>'status', event_item->'evidence', (event_item->>'isDemo')::boolean
    ) ON CONFLICT (farm_id, source_code, source_event_key) DO UPDATE SET
      kind = excluded.kind, title = excluded.title, starts_at = excluded.starts_at,
      ends_at = excluded.ends_at, issued_at = excluded.issued_at,
      retrieved_at = excluded.retrieved_at, source_url = excluded.source_url,
      status = excluded.status, evidence = excluded.evidence, is_demo = excluded.is_demo
    RETURNING * INTO event_row;
    FOR alert_item IN SELECT * FROM jsonb_array_elements(coalesce((event_item->'alerts'), '[]'::jsonb)) LOOP
      INSERT INTO public.plot_alerts (
        farm_id, plot_id, event_id, assessment_state, risk_level, reason,
        recommended_actions, input_snapshot, rule_version, generated_at,
        valid_until, generation_method
      ) VALUES (
        p_farm_id, (alert_item->>'plotId')::uuid, event_row.id, alert_item->>'assessmentState',
        nullif(alert_item->>'riskLevel',''), alert_item->>'reason', alert_item->'recommendedActions',
        jsonb_set(alert_item->'inputSnapshot', '{event,id}', to_jsonb(event_row.id)), alert_item->>'ruleVersion', (alert_item->>'generatedAt')::timestamptz,
        (alert_item->>'validUntil')::timestamptz, alert_item->>'generationMethod'
      ) ON CONFLICT (plot_id, event_id) DO UPDATE SET
        assessment_state = excluded.assessment_state, risk_level = excluded.risk_level,
        reason = excluded.reason, recommended_actions = excluded.recommended_actions,
        input_snapshot = excluded.input_snapshot, rule_version = excluded.rule_version,
        generated_at = excluded.generated_at, valid_until = excluded.valid_until,
        generation_method = excluded.generation_method;
    END LOOP;
  END LOOP;
  DELETE FROM public.events WHERE farm_id = p_farm_id AND ends_at <= p_published_at - interval '7 days';
  IF (SELECT count(*) FROM public.events WHERE farm_id = p_farm_id) > 50 THEN
    RAISE EXCEPTION 'PAYLOAD_LIMIT_EXCEEDED';
  END IF;
  next_version := f.data_version + 1;
  UPDATE public.farms SET forecast_summary = p_forecast, last_attempt_at = p_published_at,
    last_success_at = p_published_at, last_error_code = null, data_version = next_version
    WHERE id = p_farm_id;
  RETURN jsonb_build_object('dataVersion', next_version);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM IN ('VERSION_CONFLICT', 'NOT_FOUND', 'STALE_PROVIDER_DATA') THEN RAISE; END IF;
  UPDATE public.farms SET last_attempt_at = p_published_at, last_error_code = CASE WHEN SQLERRM IN ('INVALID_PROVIDER_DATA', 'PAYLOAD_LIMIT_EXCEEDED') THEN SQLERRM ELSE 'PUBLISH_FAILED' END
    WHERE id = p_farm_id AND owner_id = p_owner_id AND data_version = p_expected_data_version
      AND last_attempt_at = p_attempt_at;
  RETURN jsonb_build_object('errorCode', CASE WHEN SQLERRM IN ('INVALID_PROVIDER_DATA', 'PAYLOAD_LIMIT_EXCEEDED') THEN SQLERRM ELSE 'PUBLISH_FAILED' END);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.fail_farm_refresh(
  p_owner_id uuid,
  p_farm_id uuid,
  p_expected_data_version integer,
  p_attempt_at timestamptz,
  p_completed_at timestamptz,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.farms
  SET last_attempt_at = p_completed_at, last_error_code = p_error_code
  WHERE id = p_farm_id AND owner_id = p_owner_id
    AND data_version = p_expected_data_version AND last_attempt_at = p_attempt_at;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_farm_refresh(uuid, uuid, integer, timestamptz, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.import_demo_seed(p_owner_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE farm_id uuid; plot_item jsonb; plot_id uuid; cycle_item jsonb;
  event_id uuid; event_ids uuid[] := '{}'; alert_item jsonb; event_item jsonb; cycle_row public.crop_cycles%ROWTYPE;
BEGIN
  INSERT INTO public.farms (
    owner_id, name, province, locality, boundary_geojson, declared_area_ha,
    data_mode, custom_rules
  ) VALUES (
    p_owner_id, p_payload->'farm'->>'name', p_payload->'farm'->>'province',
    nullif(p_payload->'farm'->>'locality',''), p_payload->'farm'->'boundary',
    (p_payload->'farm'->>'declaredAreaHa')::numeric, 'demo', '[]'::jsonb
  ) RETURNING id INTO farm_id;
  FOR plot_item IN SELECT * FROM jsonb_array_elements(p_payload->'plots') LOOP
    INSERT INTO public.plots (
      id, farm_id, name, boundary_geojson, sample_point_geojson, declared_area_ha
    ) VALUES (
      (plot_item->>'id')::uuid, farm_id, plot_item->>'name', plot_item->'boundary', plot_item->'samplePoint',
      (plot_item->>'declaredAreaHa')::numeric
    ) RETURNING id INTO plot_id;
    cycle_item := plot_item->'cropCycle';
    INSERT INTO public.crop_cycles (
      plot_id, crop_code, season_label, sown_on, stage_code, stage_as_of
    ) VALUES (
      plot_id, cycle_item->>'cropCode', cycle_item->>'seasonLabel',
      nullif(cycle_item->>'sownOn','')::date, nullif(cycle_item->>'stageCode',''),
      nullif(cycle_item->>'stageAsOf','')::date
    );
  END LOOP;
  FOR event_item IN SELECT * FROM jsonb_array_elements(p_payload->'events') LOOP
    INSERT INTO public.events (
      farm_id, source_code, source_event_key, kind, title, starts_at, ends_at,
      retrieved_at, evidence, is_demo
    ) VALUES (
      farm_id, 'demo', event_item->>'sourceEventKey', event_item->>'kind',
      event_item->>'title', (event_item->>'startsAt')::timestamptz,
      (event_item->>'endsAt')::timestamptz, (event_item->>'retrievedAt')::timestamptz,
      event_item->'evidence', true
    ) RETURNING id INTO event_id;
    event_ids := array_append(event_ids, event_id);
    FOR alert_item IN SELECT * FROM jsonb_array_elements(event_item->'alerts') LOOP
      SELECT c.* INTO STRICT cycle_row FROM public.crop_cycles c
        WHERE c.plot_id = (alert_item->>'plotId')::uuid AND ended_on IS NULL;
      INSERT INTO public.plot_alerts (
        farm_id, plot_id, event_id, assessment_state, risk_level, reason,
        recommended_actions, input_snapshot, rule_version, generated_at,
        valid_until, generation_method
      ) VALUES (
        farm_id, (alert_item->>'plotId')::uuid, event_id,
        alert_item->>'assessmentState', nullif(alert_item->>'riskLevel',''),
        alert_item->>'reason', alert_item->'recommendedActions',
        jsonb_set(jsonb_set(alert_item->'inputSnapshot', '{event,id}', to_jsonb(event_id)), '{cropCycle}',
          jsonb_build_object(
            'id', cycle_row.id, 'plotId', cycle_row.plot_id, 'cropCode', cycle_row.crop_code,
            'seasonLabel', cycle_row.season_label, 'sownOn', cycle_row.sown_on,
            'stageCode', cycle_row.stage_code, 'stageAsOf', cycle_row.stage_as_of,
            'endedOn', cycle_row.ended_on,
            'updatedAt', to_char(cycle_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          )), alert_item->>'ruleVersion',
        (alert_item->>'generatedAt')::timestamptz,
        (alert_item->>'validUntil')::timestamptz, alert_item->>'generationMethod'
      );
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('farmId', farm_id, 'eventIds', to_jsonb(event_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.import_demo_seed(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_demo_seed(uuid, jsonb) TO service_role;

COMMIT;
