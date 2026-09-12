-- AgroSense initial schema. Requires Supabase Auth and standard API roles.
-- Domain rules and JSON validation boundary: docs/domain-model.md.
BEGIN;

CREATE TABLE public.farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  province text NOT NULL CHECK (length(btrim(province)) BETWEEN 1 AND 100),
  locality text CHECK (locality IS NULL OR length(btrim(locality)) BETWEEN 1 AND 100),
  timezone text NOT NULL DEFAULT 'America/Argentina/Cordoba'
    CHECK (timezone = 'America/Argentina/Cordoba'),
  data_mode text NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo', 'live')),
  boundary_geojson jsonb NOT NULL CHECK (
    jsonb_typeof(boundary_geojson) = 'object'
    AND boundary_geojson @> '{"type":"Polygon"}'::jsonb
    AND jsonb_typeof(boundary_geojson->'coordinates') IS NOT DISTINCT FROM 'array'),
  declared_area_ha numeric(12,2) NOT NULL
    CHECK (declared_area_ha > 0 AND declared_area_ha <= 1000000),
  data_version integer NOT NULL DEFAULT 1 CHECK (data_version > 0),
  forecast_summary jsonb CHECK (forecast_summary IS NULL OR (
    jsonb_typeof(forecast_summary) = 'object'
    AND forecast_summary @> '{"schemaVersion":1}'::jsonb)),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text CHECK (last_error_code IN (
    'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'INVALID_PROVIDER_DATA',
    'PAYLOAD_LIMIT_EXCEEDED', 'PUBLISH_FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((forecast_summary IS NULL) = (last_success_at IS NULL)),
  CHECK (last_success_at IS NULL OR (last_attempt_at IS NOT NULL AND last_success_at <= last_attempt_at))
);

CREATE TABLE public.plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  boundary_geojson jsonb NOT NULL CHECK (
    jsonb_typeof(boundary_geojson) = 'object'
    AND boundary_geojson @> '{"type":"Polygon"}'::jsonb
    AND jsonb_typeof(boundary_geojson->'coordinates') IS NOT DISTINCT FROM 'array'),
  sample_point_geojson jsonb NOT NULL CHECK (
    jsonb_typeof(sample_point_geojson) = 'object'
    AND sample_point_geojson @> '{"type":"Point"}'::jsonb
    AND jsonb_typeof(sample_point_geojson->'coordinates') IS NOT DISTINCT FROM 'array'),
  declared_area_ha numeric(12,2) NOT NULL
    CHECK (declared_area_ha > 0 AND declared_area_ha <= 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, name),
  UNIQUE (id, farm_id)
);

CREATE TABLE public.crop_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id uuid NOT NULL REFERENCES public.plots(id) ON DELETE RESTRICT,
  crop_code text NOT NULL CHECK (crop_code IN ('maize', 'soybean')),
  season_label text NOT NULL CHECK (season_label ~ '^[0-9]{4}/[0-9]{2}$'),
  sown_on date,
  stage_code text,
  stage_as_of date,
  ended_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((stage_code IS NULL) = (stage_as_of IS NULL)),
  CHECK (stage_code IS NULL OR
    (crop_code = 'maize' AND stage_code IN ('V3', 'V6', 'VT', 'R1')) OR
    (crop_code = 'soybean' AND stage_code IN ('V2', 'R1', 'R4', 'R6'))),
  CHECK (sown_on IS NULL OR stage_as_of IS NULL OR stage_as_of >= sown_on),
  CHECK (ended_on IS NULL OR sown_on IS NULL OR ended_on > sown_on),
  CHECK (ended_on IS NULL OR stage_as_of IS NULL OR stage_as_of < ended_on)
);
CREATE UNIQUE INDEX crop_cycles_one_open ON public.crop_cycles(plot_id) WHERE ended_on IS NULL;
CREATE INDEX crop_cycles_plot ON public.crop_cycles(plot_id);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE RESTRICT,
  source_code text NOT NULL CHECK (source_code IN ('demo', 'open_meteo')),
  source_event_key text NOT NULL CHECK (length(source_event_key) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'frost' CHECK (kind = 'frost'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  issued_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  source_url text CHECK (source_url IS NULL OR (length(source_url) <= 2048 AND source_url LIKE 'https://%')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  evidence jsonb NOT NULL CHECK (
    jsonb_typeof(evidence) = 'object' AND evidence @> '{"schemaVersion":1}'::jsonb),
  is_demo boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_demo = (source_code = 'demo')),
  CHECK (issued_at IS NULL OR issued_at <= retrieved_at),
  UNIQUE (farm_id, source_code, source_event_key),
  UNIQUE (id, farm_id)
);
CREATE INDEX events_farm_time ON public.events(farm_id, starts_at, id);

CREATE TABLE public.plot_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE RESTRICT,
  plot_id uuid NOT NULL,
  event_id uuid NOT NULL,
  assessment_state text NOT NULL CHECK (assessment_state IN (
    'evaluated', 'insufficient_data', 'no_applicable_rule')),
  risk_level text CHECK (risk_level IN ('low', 'moderate', 'high')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  recommendation text CHECK (recommendation IS NULL OR length(btrim(recommendation)) BETWEEN 1 AND 1000),
  input_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(input_snapshot) = 'object' AND input_snapshot @> '{"schemaVersion":1}'::jsonb),
  rule_version text NOT NULL CHECK (length(btrim(rule_version)) BETWEEN 1 AND 100),
  generated_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until > generated_at),
  generation_method text NOT NULL DEFAULT 'template' CHECK (generation_method IN ('template', 'llm')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plot_id, farm_id) REFERENCES public.plots(id, farm_id) ON DELETE RESTRICT,
  FOREIGN KEY (event_id, farm_id) REFERENCES public.events(id, farm_id) ON DELETE CASCADE,
  UNIQUE (plot_id, event_id),
  CHECK ((assessment_state = 'evaluated' AND risk_level IS NOT NULL AND recommendation IS NOT NULL)
    OR (assessment_state <> 'evaluated' AND risk_level IS NULL AND recommendation IS NULL))
);
CREATE INDEX plot_alerts_farm ON public.plot_alerts(farm_id);
CREATE INDEX plot_alerts_event ON public.plot_alerts(event_id);
CREATE INDEX farms_owner ON public.farms(owner_id);

-- Timestamp maintenance only: application mutations MUST also increment
-- farms.data_version in the same transaction, as specified in docs/domain-model.md.
CREATE FUNCTION public.set_mvp_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_mvp_updated_at() FROM PUBLIC;
CREATE TRIGGER farms_updated BEFORE UPDATE ON public.farms FOR EACH ROW EXECUTE FUNCTION public.set_mvp_updated_at();
CREATE TRIGGER plots_updated BEFORE UPDATE ON public.plots FOR EACH ROW EXECUTE FUNCTION public.set_mvp_updated_at();
CREATE TRIGGER cycles_updated BEFORE UPDATE ON public.crop_cycles FOR EACH ROW EXECUTE FUNCTION public.set_mvp_updated_at();
CREATE TRIGGER events_updated BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_mvp_updated_at();
CREATE TRIGGER alerts_updated BEFORE UPDATE ON public.plot_alerts FOR EACH ROW EXECUTE FUNCTION public.set_mvp_updated_at();

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plot_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY farms_owner_read ON public.farms FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
CREATE POLICY plots_owner_read ON public.plots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_id AND f.owner_id = (SELECT auth.uid())));
CREATE POLICY cycles_owner_read ON public.crop_cycles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plots p JOIN public.farms f ON f.id = p.farm_id
    WHERE p.id = plot_id AND f.owner_id = (SELECT auth.uid())));
CREATE POLICY events_owner_read ON public.events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_id AND f.owner_id = (SELECT auth.uid())));
CREATE POLICY alerts_owner_read ON public.plot_alerts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_id AND f.owner_id = (SELECT auth.uid())));

-- No direct browser writes; narrow mutation RPCs are a separate implementation.
REVOKE ALL ON public.farms, public.plots, public.crop_cycles, public.events, public.plot_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.farms, public.plots, public.crop_cycles, public.events, public.plot_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farms, public.plots, public.crop_cycles, public.events, public.plot_alerts TO service_role;
COMMIT;
