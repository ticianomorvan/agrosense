-- Align persisted alert/event fields with the deterministic agronomic engine.
BEGIN;

ALTER TABLE public.events
  DROP CONSTRAINT events_kind_check,
  ADD CONSTRAINT events_kind_check
    CHECK (kind IN ('frost', 'severe-storm', 'hail', 'extreme-heat'));

ALTER TABLE public.plot_alerts
  ADD COLUMN recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (
      jsonb_typeof(recommended_actions) = 'array'
      AND jsonb_array_length(recommended_actions) <= 20
    );

UPDATE public.plot_alerts
SET recommended_actions = CASE
  WHEN recommendation IS NULL THEN '[]'::jsonb
  ELSE jsonb_build_array(recommendation)
END;

ALTER TABLE public.plot_alerts
  DROP CONSTRAINT plot_alerts_risk_level_check,
  ADD CONSTRAINT plot_alerts_risk_level_check
    CHECK (risk_level IN ('low', 'moderate', 'high', 'critical') OR risk_level IS NULL),
  DROP CONSTRAINT plot_alerts_assessment_state_check,
  ADD CONSTRAINT plot_alerts_assessment_state_check
    CHECK (
      (assessment_state = 'evaluated' AND risk_level IS NOT NULL)
      OR (assessment_state <> 'evaluated' AND risk_level IS NULL)
    ),
  DROP COLUMN recommendation;

COMMIT;
