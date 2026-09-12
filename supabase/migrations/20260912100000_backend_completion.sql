BEGIN;

ALTER TABLE public.farms
  ADD COLUMN custom_rules jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(custom_rules) = 'array' AND jsonb_array_length(custom_rules) <= 10);

COMMIT;
