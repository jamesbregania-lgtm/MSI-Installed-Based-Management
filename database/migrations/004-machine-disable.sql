-- Lets an admin disable a unit: it stays on file (serial, history, reports) but
-- no longer counts as installed or in use.
--
-- `disabled_at` is the whole flag: NULL = in service, a timestamp = disabled
-- since then. `disabled_by` records who did it. Nothing else about the row
-- changes, so enabling a unit again restores it exactly as it was.
--
-- Run this BEFORE deploying the application change (Supabase SQL editor — the
-- app has no DDL access). Both columns are nullable, so existing rows are
-- unaffected and the running app keeps working until the new code goes out.
-- Until it is run, the Disable button reports "setup needed" instead of failing.

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by text;
