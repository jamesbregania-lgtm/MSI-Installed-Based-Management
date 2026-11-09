-- Schedule notifications: a technician taps "Turn on notifications" on My
-- Schedule and their phone's browser hands the site a push subscription (an
-- endpoint URL plus two keys). One row per phone; a technician with two
-- phones has two rows.
--
-- `endpoint` is unique: if another technician logs in on the same phone and
-- turns notifications on, the row moves to them rather than notifying both.
-- Rows are removed automatically when the push service reports the phone has
-- unsubscribed (HTTP 404/410).
--
-- Run this BEFORE deploying the application change (Supabase SQL editor — the
-- app has no DDL access). Until it is run, the "Turn on notifications" button
-- reports that setup is needed and schedules save without notifying anyone.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           bigserial PRIMARY KEY,
  username     text        NOT NULL,
  endpoint     text        NOT NULL UNIQUE,
  p256dh       text        NOT NULL,
  auth         text        NOT NULL,
  user_agent   text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_username_idx
  ON push_subscriptions (username);

-- Same posture as scripts/enable-rls.sql: the server's service-role key
-- bypasses RLS; nothing else should read this table.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
