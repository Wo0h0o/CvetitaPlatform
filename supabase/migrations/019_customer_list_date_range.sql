-- Migration 019 — date range filter on customer list
-- Adds p_from + p_to (TIMESTAMPTZ) to customer_list_filtered and
-- customer_list_count. Filters on c.last_order_at, so the call center
-- can target customers active within a window.
--
-- DROP first because the function signature is changing.

DROP FUNCTION IF EXISTS public.customer_list_filtered(TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT);
DROP FUNCTION IF EXISTS public.customer_list_count(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.customer_list_filtered(
  p_schema  TEXT,
  p_search  TEXT  DEFAULT NULL,
  p_filter  TEXT  DEFAULT 'all',
  p_sort    TEXT  DEFAULT 'last_order_at',
  p_order   TEXT  DEFAULT 'desc',
  p_limit   INT   DEFAULT 50,
  p_offset  INT   DEFAULT 0,
  p_from    TIMESTAMPTZ DEFAULT NULL,
  p_to      TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  phone_e164         TEXT,
  phone_raw          TEXT,
  email              TEXT,
  first_name         TEXT,
  last_name          TEXT,
  total_orders       INT,
  total_spent        NUMERIC,
  first_order_at     TIMESTAMPTZ,
  last_order_at      TIMESTAMPTZ,
  default_city       TEXT,
  do_not_call        BOOLEAN,
  notes              TEXT,
  preferred_call_hour TEXT,
  last_call_at       TIMESTAMPTZ,
  last_call_outcome  TEXT,
  last_call_agent    UUID,
  call_count         INT,
  next_followup_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sort_col TEXT;
  v_dir TEXT;
  v_filter_clause TEXT;
  v_search_clause TEXT;
  v_date_clause TEXT;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  v_sort_col := CASE p_sort
    WHEN 'total_spent'    THEN 'c.total_spent'
    WHEN 'total_orders'   THEN 'c.total_orders'
    WHEN 'first_name'     THEN 'c.first_name'
    WHEN 'last_call_at'   THEN 'last_call_at'
    WHEN 'first_order_at' THEN 'c.first_order_at'
    ELSE 'c.last_order_at'
  END;
  v_dir := CASE LOWER(COALESCE(p_order, 'desc')) WHEN 'asc' THEN 'ASC NULLS LAST' ELSE 'DESC NULLS LAST' END;

  v_filter_clause := CASE p_filter
    WHEN 'never_called'   THEN 'AND last_call_at IS NULL'
    WHEN 'do_not_call'    THEN 'AND c.do_not_call = TRUE'
    WHEN 'needs_followup' THEN 'AND next_followup_at IS NOT NULL AND next_followup_at <= now()'
    WHEN 'has_followup'   THEN 'AND next_followup_at IS NOT NULL'
    ELSE ''
  END;

  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_search_clause := format(
      'AND (c.phone_e164 ILIKE %L OR c.email ILIKE %L OR c.first_name ILIKE %L OR c.last_name ILIKE %L)',
      '%' || p_search || '%', '%' || p_search || '%', '%' || p_search || '%', '%' || p_search || '%'
    );
  ELSE
    v_search_clause := '';
  END IF;

  -- Date range filter on last_order_at. NULL bounds = open-ended.
  v_date_clause := '';
  IF p_from IS NOT NULL THEN
    v_date_clause := v_date_clause || format(' AND c.last_order_at >= %L', p_from);
  END IF;
  IF p_to IS NOT NULL THEN
    v_date_clause := v_date_clause || format(' AND c.last_order_at <= %L', p_to);
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH last_call AS (
      SELECT DISTINCT ON (customer_phone_e164)
        customer_phone_e164,
        created_at  AS last_call_at,
        outcome     AS last_call_outcome,
        agent_user_id AS last_call_agent
      FROM %I.call_log
      WHERE kind = 'call'
      ORDER BY customer_phone_e164, created_at DESC
    ),
    counts AS (
      SELECT customer_phone_e164, COUNT(*)::INT AS call_count
      FROM %I.call_log WHERE kind = 'call' GROUP BY customer_phone_e164
    ),
    next_followup AS (
      SELECT customer_phone_e164, MIN(follow_up_at) AS next_followup_at
      FROM %I.call_log WHERE follow_up_at IS NOT NULL GROUP BY customer_phone_e164
    )
    SELECT
      c.phone_e164, c.phone_raw, c.email, c.first_name, c.last_name,
      c.total_orders, c.total_spent, c.first_order_at, c.last_order_at,
      c.default_city, c.do_not_call, c.notes, c.preferred_call_hour,
      lc.last_call_at, lc.last_call_outcome, lc.last_call_agent,
      COALESCE(cnt.call_count, 0) AS call_count,
      nf.next_followup_at
    FROM %I.customers c
    LEFT JOIN last_call    lc  ON lc.customer_phone_e164  = c.phone_e164
    LEFT JOIN counts       cnt ON cnt.customer_phone_e164 = c.phone_e164
    LEFT JOIN next_followup nf ON nf.customer_phone_e164  = c.phone_e164
    WHERE 1=1 %s %s %s
    ORDER BY %s %s, c.phone_e164 ASC
    LIMIT %s OFFSET %s
  $f$,
    p_schema, p_schema, p_schema, p_schema,
    v_filter_clause, v_search_clause, v_date_clause,
    v_sort_col, v_dir,
    p_limit, p_offset
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_list_filtered(TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_list_filtered(TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.customer_list_count(
  p_schema  TEXT,
  p_search  TEXT  DEFAULT NULL,
  p_filter  TEXT  DEFAULT 'all',
  p_from    TIMESTAMPTZ DEFAULT NULL,
  p_to      TIMESTAMPTZ DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_filter_clause TEXT;
  v_search_clause TEXT;
  v_date_clause TEXT;
  v_count INT;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  v_filter_clause := CASE p_filter
    WHEN 'never_called'   THEN 'AND last_call_at IS NULL'
    WHEN 'do_not_call'    THEN 'AND c.do_not_call = TRUE'
    WHEN 'needs_followup' THEN 'AND next_followup_at IS NOT NULL AND next_followup_at <= now()'
    WHEN 'has_followup'   THEN 'AND next_followup_at IS NOT NULL'
    ELSE ''
  END;

  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_search_clause := format(
      'AND (c.phone_e164 ILIKE %L OR c.email ILIKE %L OR c.first_name ILIKE %L OR c.last_name ILIKE %L)',
      '%' || p_search || '%', '%' || p_search || '%', '%' || p_search || '%', '%' || p_search || '%'
    );
  ELSE
    v_search_clause := '';
  END IF;

  v_date_clause := '';
  IF p_from IS NOT NULL THEN
    v_date_clause := v_date_clause || format(' AND c.last_order_at >= %L', p_from);
  END IF;
  IF p_to IS NOT NULL THEN
    v_date_clause := v_date_clause || format(' AND c.last_order_at <= %L', p_to);
  END IF;

  EXECUTE format($f$
    WITH last_call AS (
      SELECT DISTINCT ON (customer_phone_e164) customer_phone_e164, created_at AS last_call_at
      FROM %I.call_log WHERE kind = 'call' ORDER BY customer_phone_e164, created_at DESC
    ),
    next_followup AS (
      SELECT customer_phone_e164, MIN(follow_up_at) AS next_followup_at
      FROM %I.call_log WHERE follow_up_at IS NOT NULL GROUP BY customer_phone_e164
    )
    SELECT COUNT(*)
    FROM %I.customers c
    LEFT JOIN last_call    lc ON lc.customer_phone_e164  = c.phone_e164
    LEFT JOIN next_followup nf ON nf.customer_phone_e164 = c.phone_e164
    WHERE 1=1 %s %s %s
  $f$, p_schema, p_schema, p_schema, v_filter_clause, v_search_clause, v_date_clause)
  INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_list_count(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_list_count(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
