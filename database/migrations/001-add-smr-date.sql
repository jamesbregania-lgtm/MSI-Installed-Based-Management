-- SMR Date moves out of `description` into its own field.
--
-- `description` had been relabelled "SMR Date" in the UI while still holding
-- free-text service notes: of 820 stored values only 167 were dates, the rest
-- were notes like "Under Monitoring" or multi-line report summaries. Turning
-- that box into a date input would have blanked and then erased all of them,
-- so the date gets its own home and `description` goes back to being Notes.
--
-- Stored as text in ISO yyyy-mm-dd. The legacy values were a mix of mm/dd/yyyy
-- and dd/mm/yyyy with no marker saying which, which is exactly why they were
-- not all machine-readable; ISO removes the ambiguity for everything new.
--
-- Run this BEFORE deploying the application change. Both columns are nullable
-- with a default, so existing rows are unaffected and the running app keeps
-- working until the new code goes out.

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS smr_date text DEFAULT '',
  ADD COLUMN IF NOT EXISTS initial_smr_date text DEFAULT '';
