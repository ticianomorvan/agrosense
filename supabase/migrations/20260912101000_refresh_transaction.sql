BEGIN;

CREATE FUNCTION public.admit_farm_refresh(p_farm_id uuid, p_attempt_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE f public.farms%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.farms WHERE id = p_farm_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF f.last_attempt_at IS NOT NULL
     AND f.last_attempt_at > p_attempt_at - interval '60 seconds' THEN
    RAISE EXCEPTION 'RATE_LIMITED:%', extract(epoch FROM (interval '60 seconds' - (p_attempt_at - f.last_attempt_at)))::integer;
  END IF;
  UPDATE public.farms SET last_attempt_at = p_attempt_at WHERE id = p_farm_id;
  RETURN jsonb_build_object('dataVersion', f.data_version, 'dataMode', f.data_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.admit_farm_refresh(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admit_farm_refresh(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admit_farm_refresh(uuid, timestamptz) TO service_role;

CREATE FUNCTION public.publish_farm_refresh(
  p_farm_id uuid,
  p_expected_data_version integer,
  p_attempt_at timestamptz,
  p_published_at timestamptz,
  p_forecast jsonb,
  p_events jsonb,
  p_alerts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE f public.farms%ROWTYPE; event_item jsonb; alert_item jsonb; event_row public.events%ROWTYPE; next_version integer;
BEGIN
  SELECT * INTO f FROM public.farms WHERE id = p_farm_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF f.data_version <> p_expected_data_version OR f.last_attempt_at <> p_attempt_at
    THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
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
        alert_item->'inputSnapshot', alert_item->>'ruleVersion', (alert_item->>'generatedAt')::timestamptz,
        (alert_item->>'validUntil')::timestamptz, alert_item->>'generationMethod'
      ) ON CONFLICT (plot_id, event_id) DO UPDATE SET
        assessment_state = excluded.assessment_state, risk_level = excluded.risk_level,
        reason = excluded.reason, recommended_actions = excluded.recommended_actions,
        input_snapshot = excluded.input_snapshot, rule_version = excluded.rule_version,
        generated_at = excluded.generated_at, valid_until = excluded.valid_until,
        generation_method = excluded.generation_method;
    END LOOP;
  END LOOP;
  next_version := f.data_version + 1;
  UPDATE public.farms SET forecast_summary = p_forecast, last_attempt_at = p_published_at,
    last_success_at = p_published_at, last_error_code = null, data_version = next_version
    WHERE id = p_farm_id;
  RETURN jsonb_build_object('dataVersion', next_version);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM IN ('VERSION_CONFLICT', 'NOT_FOUND') THEN RAISE; END IF;
  UPDATE public.farms SET last_attempt_at = p_published_at, last_error_code = 'PUBLISH_FAILED'
    WHERE id = p_farm_id AND data_version = p_expected_data_version
      AND last_attempt_at = p_attempt_at;
  RETURN jsonb_build_object('errorCode', 'PUBLISH_FAILED');
END;
$$;
REVOKE ALL ON FUNCTION public.publish_farm_refresh(uuid, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_farm_refresh(uuid, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_farm_refresh(uuid, integer, timestamptz, timestamptz, jsonb, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.fail_farm_refresh(
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
  WHERE id = p_farm_id AND owner_id = auth.uid()
    AND data_version = p_expected_data_version AND last_attempt_at = p_attempt_at;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_farm_refresh(uuid, integer, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_farm_refresh(uuid, integer, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_farm_refresh(uuid, integer, timestamptz, timestamptz, text) TO service_role;

CREATE FUNCTION public.import_demo_seed(p_owner_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE farm_id uuid; plot_item jsonb; plot_id uuid; cycle_item jsonb;
  event_id uuid; alert_item jsonb; event_item jsonb;
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
  event_item := p_payload->'event';
  INSERT INTO public.events (
    farm_id, source_code, source_event_key, kind, title, starts_at, ends_at,
    retrieved_at, evidence, is_demo
  ) VALUES (
    farm_id, 'demo', event_item->>'sourceEventKey', event_item->>'kind',
    event_item->>'title', (event_item->>'startsAt')::timestamptz,
    (event_item->>'endsAt')::timestamptz, (event_item->>'retrievedAt')::timestamptz,
    event_item->'evidence', true
  ) RETURNING id INTO event_id;
  FOR alert_item IN SELECT * FROM jsonb_array_elements(p_payload->'alerts') LOOP
    INSERT INTO public.plot_alerts (
      farm_id, plot_id, event_id, assessment_state, risk_level, reason,
      recommended_actions, input_snapshot, rule_version, generated_at,
      valid_until, generation_method
    ) VALUES (
      farm_id, (alert_item->>'plotId')::uuid, event_id,
      alert_item->>'assessmentState', nullif(alert_item->>'riskLevel',''),
      alert_item->>'reason', alert_item->'recommendedActions',
      alert_item->'inputSnapshot', alert_item->>'ruleVersion',
      (alert_item->>'generatedAt')::timestamptz,
      (alert_item->>'validUntil')::timestamptz, alert_item->>'generationMethod'
    );
  END LOOP;
  RETURN jsonb_build_object('farmId', farm_id, 'eventId', event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.import_demo_seed(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_demo_seed(uuid, jsonb) TO service_role;

COMMIT;
