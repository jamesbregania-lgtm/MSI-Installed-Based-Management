-- Units and models an admin adds from the "Units & Models" tab.
--
-- The built-in catalog (with the CIJ parts/expiry lists) stays in code; rows
-- here are merged on top of it, so a new model no longer needs a code change
-- and a deploy. A row with model NULL registers a unit that has no models yet.
--
-- model_key is the duplicate-check key: model uppercased with spaces and
-- hyphens removed, so "9750 G", "9750G" and "9750-g" are one model. It is
-- unique across ALL units: CIJ 9450 existing means TTO 9450 is refused. The
-- app checks this against the built-in catalog too; this index only backstops
-- two admins adding the same model at the same moment.
--
-- Run this in the Supabase SQL editor BEFORE deploying the application change.
-- Until it exists the app keeps working on the built-in catalog alone and the
-- tab shows a notice instead of the add form.

create table if not exists public.unit_models (
  id          bigserial primary key,
  unit        text not null,
  unit_key    text not null,
  model       text,
  model_key   text,
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

create unique index if not exists unit_models_model_key_uniq
  on public.unit_models (model_key) where model_key is not null;

create unique index if not exists unit_models_unit_only_uniq
  on public.unit_models (unit_key) where model_key is null;

-- Same posture as scripts/enable-rls.sql: only the server (service role) reads it.
alter table public.unit_models enable row level security;
