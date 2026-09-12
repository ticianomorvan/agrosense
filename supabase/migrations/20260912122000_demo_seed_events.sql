-- Upgrade existing installations to the multi-event demo seed payload.
-- Keep the previously applied trusted-publication migration unchanged.
BEGIN;

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
