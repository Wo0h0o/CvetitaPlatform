-- Migration 032 — store explicit end_date snapshot on hr_leave_requests
--
-- The leave form already collects both "От" and "До" dates and derives
-- working_days from the range. Storing end_date alongside lets the PDF
-- render an unambiguous "считано от X до Y" sentence — much easier for
-- HR to read than the implicit "X working days starting from Y".
--
-- Nullable so legacy rows (submitted before this column existed) keep
-- working with the old "считано от X" fallback in the PDF generator.

ALTER TABLE public.hr_leave_requests
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- Sanity check: when present, end_date must be on or after start_date.
DO $$ BEGIN
  ALTER TABLE public.hr_leave_requests
    ADD CONSTRAINT hr_leave_requests_end_date_range
    CHECK (end_date IS NULL OR end_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
