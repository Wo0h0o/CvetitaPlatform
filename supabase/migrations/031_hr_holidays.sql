-- Migration 031 — National holidays
--
-- Stores company-wide holidays separately from per-worker hr_day_events.
-- A row in hr_holidays is policy ("the office is closed on 25 Dec"); it
-- applies to every worker automatically without a duplicate row per person.
--
-- Composite PK (organization_id, holiday_date) keeps the model trivially
-- idempotent — re-running the seed for a year does an upsert, not duplicates.

CREATE TABLE IF NOT EXISTS public.hr_holidays (
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  holiday_date     DATE NOT NULL,
  label            TEXT NOT NULL,
  -- TRUE = state-mandated holiday (auto-seeded from BG Labour Code calendar).
  -- FALSE = custom company day (team building, extra rest day, etc.).
  is_official      BOOLEAN NOT NULL DEFAULT TRUE,
  -- TRUE only for the compensation rows added when an official holiday falls
  -- on Sat/Sun. Lets the UI label them distinctively ("Почивен ден за …").
  is_compensation  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_hr_holidays_date
  ON public.hr_holidays (holiday_date);

ALTER TABLE public.hr_holidays ENABLE ROW LEVEL SECURITY;

-- All org members (including workers) need to read the holiday list so
-- their /hr calendar reflects company-wide closures.
CREATE POLICY "hr_holidays: org members read"
  ON public.hr_holidays FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

-- Only admin/manager can change the schedule of office closures.
CREATE POLICY "hr_holidays: manager+admin insert"
  ON public.hr_holidays FOR INSERT
  WITH CHECK (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_holidays: manager+admin update"
  ON public.hr_holidays FOR UPDATE
  USING (public.is_org_manager_or_admin(organization_id));

CREATE POLICY "hr_holidays: manager+admin delete"
  ON public.hr_holidays FOR DELETE
  USING (public.is_org_manager_or_admin(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_holidays TO authenticated;
GRANT ALL ON public.hr_holidays TO service_role;
