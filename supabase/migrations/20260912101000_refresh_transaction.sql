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
DECLARE f public.farms%ROWTYPE; item jsonb; event_row public.events%ROWTYPE; next_version integer;
BEGIN
  SELECT * INTO f FROM public.farms WHERE id = p_farm_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF f.data_version <> p_expected_data_version OR f.last_attempt_at <> p_attempt_at
    THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) LOOP
    INSERT INTO public.events (
      farm_id, source_code, source_event_key, kind, title, starts_at, ends_at,
      issued_at, retrieved_at, source_url, status, evidence, is_demo
    ) VALUES (
      p_farm_id, item->>'sourceCode', item->>'sourceEventKey', item->>'kind',
      item->>'title', (item->>'startsAt')::timestamptz, (item->>'endsAt')::timestamptz,
      nullif(item->>'issuedAt','')::timestamptz, (item->>'retrievedAt')::timestamptz,
      nullif(item->>'sourceUrl',''), item->>'status', item->'evidence', (item->>'isDemo')::boolean
    ) ON CONFLICT (farm_id, source_code, source_event_key) DO UPDATE SET
      kind = excluded.kind, title = excluded.title, starts_at = excluded.starts_at,
      ends_at = excluded.ends_at, issued_at = excluded.issued_at,
      retrieved_at = excluded.retrieved_at, source_url = excluded.source_url,
      status = excluded.status, evidence = excluded.evidence, is_demo = excluded.is_demo
    RETURNING * INTO event_row;
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce((item->'alerts'), '[]'::jsonb)) LOOP
      INSERT INTO public.plot_alerts (
        farm_id, plot_id, event_id, assessment_state, risk_level, reason,
        recommended_actions, input_snapshot, rule_version, generated_at,
        valid_until, generation_method
      ) VALUES (
        p_farm_id, (item->>'plotId')::uuid, event_row.id, item->>'assessmentState',
        nullif(item->>'riskLevel',''), item->>'reason', item->'recommendedActions',
        item->'inputSnapshot', item->>'ruleVersion', (item->>'generatedAt')::timestamptz,
        (item->>'validUntil')::timestamptz, item->>'generationMethod'
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

COMMIT;
