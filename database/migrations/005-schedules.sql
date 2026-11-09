-- Admin > Scheduling: an admin assigns a technician to a client site on a date
-- (and optional time) with work instructions. The technician sees their own
-- schedules on the User Account page.
--
-- The technician and client are stored by key (username / client id) AND by
-- name, so a schedule still reads correctly after an account or client is
-- renamed, deactivated or removed. `location` is copied from the client when
-- the schedule is made but can be edited — one client can have several sites.
--
-- `schedule_date` is a plain date and `schedule_time` a plain time (no time
-- zone): "Nov 3, 9:00 AM" means 9 AM at the site, whoever is looking at it.
--
-- `status`: 'scheduled' (default), 'done' or 'cancelled'.
--
-- Run this BEFORE deploying the application change (Supabase SQL editor — the
-- app has no DDL access). Until it is run, Admin > Scheduling shows a
-- "setup needed" notice and technicians simply see no schedules.

CREATE TABLE IF NOT EXISTS schedules (
  id                  bigserial PRIMARY KEY,
  technician_username text        NOT NULL,
  technician_name     text        NOT NULL DEFAULT '',
  client_id           text        NOT NULL,
  client_name         text        NOT NULL DEFAULT '',
  location            text        NOT NULL DEFAULT '',
  schedule_date       date        NOT NULL,
  schedule_time       time,
  description         text        NOT NULL DEFAULT '',
  status              text        NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'done', 'cancelled')),
  created_by          text        NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedules_technician_date_idx
  ON schedules (technician_username, schedule_date);
CREATE INDEX IF NOT EXISTS schedules_date_idx
  ON schedules (schedule_date);

-- Same posture as scripts/enable-rls.sql: the server's service-role key
-- bypasses RLS; nothing else should read this table.
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
