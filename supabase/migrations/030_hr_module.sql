-- Migration 030 — HR Module
-- Adds the 'worker' member role and three org-scoped HR tables:
--   1. hr_profiles        — PII fields used to render leave requests
--                           (full name, EGN, city, address, job title).
--   2. hr_day_events      — deviations from the implicit default workday
--                           (Mon–Fri 08:00–17:30 with a 1h unpaid lunch + 2x15m
--                           breaks → 8 effective hours). One row per absence /
--                           overtime / sick / paid_leave / unpaid_leave block.
--   3. hr_leave_requests  — every paid/unpaid leave application submitted by a
--                           worker. The PDF is regenerated on demand from the
--                           stored snapshot (frozen profile data + dates).
--
-- Worker UX rules:
--   - Default workday is implicit. We DO NOT write a row per worked day.
--     A clean Mon–Fri row in hr_day_events means 8h worked.
--   - Lunch break is implicit and NOT marked in the schedule (per spec).
--   - Approval workflow is intentionally out of scope for v1 — workers
--     download a PDF and hand it to the manager off-platform.
--
-- RLS model:
--   - hr_profiles: a worker can read/update their own row. admin & manager
--     can read/update every row in the org. Service role bypasses for cron /
--     server-side PDF generation.
--   - hr_day_events: worker can CRUD their own; admin/manager CRUD anyone's.
--   - hr_leave_requests: worker can read/insert own; admin/manager can read all.

-- ============================================================
-- 1. Extend member_role enum with 'worker'
-- ============================================================

ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'worker';

-- ============================================================
-- 2. Helper: is the current user manager-or-admin of an org?
-- ============================================================
-- (Mirrors is_org_admin from migration 001 but accepts both roles. We use
-- this in every HR RLS policy so workers stay scoped to their own row.)

CREATE OR REPLACE FUNCTION public.is_org_manager_or_admin(org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND role IN ('admin', 'manager')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 3. ENUMs for HR
-- ============================================================

DO $$ BEGIN
  CREATE TYPE hr_day_event_type AS ENUM (
    'absence',       -- left work briefly (e.g. errand)
    'overtime',      -- extra hours
    'sick',          -- болничен — full or partial day
    'paid_leave',    -- платен отпуск — full day
    'unpaid_leave'   -- неплатен отпуск — full day
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_leave_type AS ENUM ('paid', 'unpaid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_leave_status AS ENUM ('submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. hr_profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hr_profiles (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name        TEXT,                  -- "Трите имена по документ за самоличност"
  egn              TEXT,                  -- 10 digits, validated app-side
  city             TEXT,                  -- "Живущ в гр./с."
  address          TEXT,                  -- "Квартал ..., ул. ..., No ..."
  job_title        TEXT,                  -- "На длъжност ..."
  employment_start DATE,                  -- optional, for tenure tracking
  notes            TEXT,                  -- free-form, manager visible
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_profiles_org ON public.hr_profiles (organization_id);

DROP TRIGGER IF EXISTS trg_hr_profiles_updated_at ON public.hr_profiles;
CREATE TRIGGER trg_hr_profiles_updated_at
  BEFORE UPDATE ON public.hr_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.hr_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_profiles: worker reads own"
  ON public.hr_profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "hr_profiles: manager+admin reads org"
  ON public.hr_profiles FOR SELECT
  USING (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_profiles: worker updates own"
  ON public.hr_profiles FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "hr_profiles: manager+admin updates org"
  ON public.hr_profiles FOR UPDATE
  USING (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_profiles: manager+admin inserts org"
  ON public.hr_profiles FOR INSERT
  WITH CHECK (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_profiles: manager+admin deletes org"
  ON public.hr_profiles FOR DELETE
  USING (public.is_org_manager_or_admin(organization_id));

-- ============================================================
-- 5. hr_day_events
-- ============================================================
-- One row per deviation block. Multiple rows per (user_id, day) allowed
-- (e.g. 12:00–14:00 absence + 17:30–19:00 overtime same day).

CREATE TABLE IF NOT EXISTS public.hr_day_events (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_date       DATE NOT NULL,
  event_type       hr_day_event_type NOT NULL,
  -- For full-day events (sick, paid_leave, unpaid_leave) start_time/end_time
  -- are NULL and the entire 8h workday is affected.
  -- For partial events (absence, overtime) both are required.
  start_time       TIME,
  end_time         TIME,
  reason           TEXT,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_day_events_time_pair CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  ),
  CONSTRAINT hr_day_events_full_day_types CHECK (
    -- Full-day-only types must NOT have a time range
    (event_type IN ('sick', 'paid_leave', 'unpaid_leave')
      AND start_time IS NULL AND end_time IS NULL)
    OR event_type IN ('absence', 'overtime')
  )
);

CREATE INDEX IF NOT EXISTS idx_hr_day_events_user_date
  ON public.hr_day_events (user_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_hr_day_events_org_date
  ON public.hr_day_events (organization_id, event_date DESC);

DROP TRIGGER IF EXISTS trg_hr_day_events_updated_at ON public.hr_day_events;
CREATE TRIGGER trg_hr_day_events_updated_at
  BEFORE UPDATE ON public.hr_day_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.hr_day_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_day_events: worker reads own"
  ON public.hr_day_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "hr_day_events: manager+admin reads org"
  ON public.hr_day_events FOR SELECT
  USING (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_day_events: worker inserts own"
  ON public.hr_day_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "hr_day_events: manager+admin inserts org"
  ON public.hr_day_events FOR INSERT
  WITH CHECK (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_day_events: worker updates own"
  ON public.hr_day_events FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "hr_day_events: manager+admin updates org"
  ON public.hr_day_events FOR UPDATE
  USING (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_day_events: worker deletes own"
  ON public.hr_day_events FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "hr_day_events: manager+admin deletes org"
  ON public.hr_day_events FOR DELETE
  USING (public.is_org_manager_or_admin(organization_id));

-- ============================================================
-- 6. hr_leave_requests
-- ============================================================
-- Snapshot of the worker's HR profile at submission time. We freeze the
-- fields (full_name, egn, city, address, job_title) so a later profile
-- edit doesn't change what was already submitted.

CREATE TABLE IF NOT EXISTS public.hr_leave_requests (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type        hr_leave_type NOT NULL,
  start_date        DATE NOT NULL,
  working_days      INTEGER NOT NULL CHECK (working_days > 0 AND working_days <= 365),
  reason            TEXT,
  status            hr_leave_status NOT NULL DEFAULT 'submitted',
  -- Frozen profile snapshot at submission time
  snapshot_full_name  TEXT NOT NULL,
  snapshot_egn        TEXT NOT NULL,
  snapshot_city       TEXT NOT NULL,
  snapshot_address    TEXT NOT NULL,
  snapshot_job_title  TEXT NOT NULL,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_user
  ON public.hr_leave_requests (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_org
  ON public.hr_leave_requests (organization_id, submitted_at DESC);

DROP TRIGGER IF EXISTS trg_hr_leave_requests_updated_at ON public.hr_leave_requests;
CREATE TRIGGER trg_hr_leave_requests_updated_at
  BEFORE UPDATE ON public.hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_leave_requests: worker reads own"
  ON public.hr_leave_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "hr_leave_requests: manager+admin reads org"
  ON public.hr_leave_requests FOR SELECT
  USING (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_leave_requests: worker inserts own"
  ON public.hr_leave_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "hr_leave_requests: worker cancels own"
  ON public.hr_leave_requests FOR UPDATE
  USING (user_id = auth.uid() AND status = 'submitted');

CREATE POLICY "hr_leave_requests: manager+admin updates org"
  ON public.hr_leave_requests FOR UPDATE
  USING (public.is_org_manager_or_admin(organization_id));

-- ============================================================
-- 7. Grants
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_day_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hr_day_events_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.hr_leave_requests TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hr_leave_requests_id_seq TO authenticated;

GRANT ALL ON public.hr_profiles TO service_role;
GRANT ALL ON public.hr_day_events TO service_role;
GRANT ALL ON public.hr_leave_requests TO service_role;
