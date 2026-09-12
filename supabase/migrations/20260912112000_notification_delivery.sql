BEGIN;

-- Minimal receipts, not complete webhook bodies or message content. Retaining
-- uncorrelated receipts closes the callback-before-send-response race.
CREATE TABLE public.notification_receipts (
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[1-9][0-9]{0,29}$'),
  message_id text NOT NULL CHECK (length(message_id) BETWEEN 1 AND 1024),
  status text NOT NULL CHECK (status IN ('sent','delivered','read','failed')),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  recipient text CHECK (recipient ~ '^[1-9][0-9]{6,14}$'),
  notification_id uuid,
  attempt_token uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone_number_id, message_id, status),
  CHECK ((notification_id IS NULL) = (attempt_token IS NULL))
);
ALTER TABLE public.notification_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_receipts TO service_role;

CREATE FUNCTION public.notification_delivery_rank(p_status text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_status WHEN 'accepted' THEN 1 WHEN 'sent' THEN 2
    WHEN 'failed' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 ELSE 0 END;
$$;

CREATE FUNCTION public.apply_notification_receipts(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n public.notification_outbox%ROWTYPE; receipt public.notification_receipts%ROWTYPE;
BEGIN
  SELECT * INTO n FROM public.notification_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR n.send_started_at IS NULL THEN RETURN false; END IF;
  SELECT r.* INTO receipt FROM public.notification_receipts r
    WHERE r.phone_number_id = n.phone_number_id
      AND (r.recipient IS NULL OR r.recipient = n.recipient)
      AND (n.provider_message_id IS NULL OR r.message_id = n.provider_message_id)
      AND ((r.notification_id = n.id AND r.attempt_token = n.lease_token)
        OR (r.notification_id IS NULL AND r.message_id = n.provider_message_id))
    ORDER BY public.notification_delivery_rank(r.status) DESC, r.occurred_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.notification_outbox SET
    provider_message_id = receipt.message_id,
    status = CASE WHEN public.notification_delivery_rank(receipt.status) > public.notification_delivery_rank(n.status)
      THEN receipt.status ELSE n.status END,
    last_error_code = CASE WHEN receipt.status = 'failed' AND public.notification_delivery_rank(n.status) < 4
      THEN 'DELIVERY_FAILED' WHEN receipt.status IN ('sent','delivered','read') THEN NULL ELSE n.last_error_code END,
    lease_until = NULL, updated_at = clock_timestamp()
    WHERE id = n.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.record_notification_receipt(
  p_phone_number_id text, p_message_id text, p_status text, p_occurred_at timestamptz,
  p_recipient text, p_notification_id uuid, p_token uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_id uuid;
BEGIN
  INSERT INTO public.notification_receipts(phone_number_id, message_id, status,
    occurred_at, recipient, notification_id, attempt_token)
    VALUES (p_phone_number_id, p_message_id, p_status, p_occurred_at, p_recipient, p_notification_id, p_token)
    ON CONFLICT (phone_number_id, message_id, status) DO NOTHING;
  SELECT id INTO target_id FROM public.notification_outbox n
    WHERE n.phone_number_id = p_phone_number_id AND n.send_started_at IS NOT NULL
      AND (p_recipient IS NULL OR p_recipient = n.recipient)
      AND ((p_notification_id = n.id AND p_token = n.lease_token)
        OR (p_notification_id IS NULL AND n.provider_message_id = p_message_id));
  IF target_id IS NULL THEN RETURN false; END IF;
  RETURN public.apply_notification_receipts(target_id);
END;
$$;

CREATE FUNCTION public.complete_notification_send(
  p_id uuid, p_token uuid, p_outcome text, p_message_id text, p_error_code text,
  p_now timestamptz DEFAULT now()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n public.notification_outbox%ROWTYPE;
BEGIN
  IF p_now IS NULL OR NOT isfinite(p_now) OR p_outcome IS NULL
    OR p_outcome NOT IN ('accepted','retry','failed','unknown')
    OR (p_outcome = 'accepted' AND (p_message_id IS NULL OR length(p_message_id) NOT BETWEEN 1 AND 1024))
    OR (p_outcome <> 'accepted' AND p_message_id IS NOT NULL)
    OR (p_outcome = 'retry' AND p_error_code IS DISTINCT FROM 'KAPSO_RATE_LIMITED')
    OR (p_outcome = 'unknown' AND p_error_code IS DISTINCT FROM 'SEND_OUTCOME_UNKNOWN')
    OR (p_outcome = 'failed' AND p_error_code IS DISTINCT FROM 'KAPSO_REJECTED')
    THEN RAISE EXCEPTION 'INVALID_SEND_OUTCOME'; END IF;
  SELECT * INTO n FROM public.notification_outbox WHERE id = p_id AND lease_token = p_token FOR UPDATE;
  IF NOT FOUND OR n.send_started_at IS NULL OR n.status NOT IN
    ('sending','unknown','accepted','sent','delivered','read','failed') THEN RETURN false; END IF;
  IF n.provider_message_id IS NOT NULL AND p_message_id IS NOT NULL AND n.provider_message_id <> p_message_id
    THEN RETURN false; END IF;
  UPDATE public.notification_outbox SET
    provider_message_id = coalesce(n.provider_message_id, p_message_id),
    -- A confirmed 429 did not accept a message. Permit fresh evidence to update
    -- this pending intent without resetting its attempt count or retry delay.
    send_started_at = CASE WHEN n.status IN ('sending','unknown')
      AND p_outcome = 'retry' AND n.attempts < 5 THEN NULL ELSE n.send_started_at END,
    status = CASE WHEN n.status NOT IN ('sending','unknown') THEN n.status
      WHEN p_outcome = 'retry' AND n.attempts < 5 THEN 'pending'
      WHEN p_outcome = 'retry' THEN 'failed' ELSE p_outcome END,
    next_attempt_at = CASE WHEN p_outcome = 'retry'
      THEN p_now + make_interval(secs => least(900, 30 * power(2, n.attempts - 1)) + floor(random() * 10))
      ELSE n.next_attempt_at END,
    last_error_code = CASE WHEN n.status NOT IN ('sending','unknown') THEN n.last_error_code
      WHEN p_outcome = 'retry' AND n.attempts >= 5 THEN 'RETRY_EXHAUSTED' ELSE p_error_code END,
    lease_until = NULL, updated_at = p_now WHERE id = p_id;
  PERFORM public.apply_notification_receipts(p_id);
  RETURN true;
END;
$$;

-- No recipient, token, payload or credentials are returned to API callers.
CREATE FUNCTION public.get_farm_notification_status(p_farm_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.farms WHERE id = p_farm_id) THEN
    jsonb_build_object('farmId', p_farm_id, 'notifications', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'plotId', n.plot_id,
        'kind', n.kind, 'status', n.status, 'attempts', n.attempts,
        'lastErrorCode', n.last_error_code, 'createdAt', n.created_at, 'updatedAt', n.updated_at)
        ORDER BY n.created_at DESC, n.id)
      FROM (SELECT id, plot_id, kind, status, attempts, last_error_code, created_at, updated_at
        FROM public.notification_outbox WHERE farm_id = p_farm_id
        ORDER BY created_at DESC, id LIMIT 100) n
    ), '[]'::jsonb)) ELSE NULL END;
$$;

REVOKE ALL ON FUNCTION public.notification_delivery_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_notification_receipts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_notification_receipt(text,text,text,timestamptz,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_notification_send(uuid,uuid,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_farm_notification_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_notification_receipt(text,text,text,timestamptz,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_send(uuid,uuid,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_farm_notification_status(uuid) TO authenticated, service_role;

COMMIT;
