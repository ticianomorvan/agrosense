-- Read the complete dashboard source through one owner-scoped database snapshot.
BEGIN;

CREATE FUNCTION public.get_farm_dashboard_snapshot(p_farm_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'farm', (
      SELECT to_jsonb(f)
      FROM public.farms AS f
      WHERE f.id = p_farm_id
    ),
    'plots', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
      FROM public.plots AS p
      WHERE p.farm_id = p_farm_id
    ), '[]'::jsonb),
    'crop_cycles', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)
      FROM public.crop_cycles AS c
      INNER JOIN public.plots AS p ON p.id = c.plot_id
      WHERE p.farm_id = p_farm_id
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.starts_at, e.id)
      FROM public.events AS e
      WHERE e.farm_id = p_farm_id
    ), '[]'::jsonb),
    'plot_alerts', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
      FROM public.plot_alerts AS a
      WHERE a.farm_id = p_farm_id
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_farm_dashboard_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_farm_dashboard_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_farm_dashboard_snapshot(uuid) TO service_role;

COMMIT;
