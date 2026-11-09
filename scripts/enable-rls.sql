-- Enable Row Level Security on every public table.
--
-- WHY THIS IS SAFE FOR THIS APP
-- The Node server is the only thing that talks to Postgres, and it connects
-- with the Supabase service-role key (see database/supabase.js). The
-- service_role has the BYPASSRLS attribute, so it ignores RLS entirely.
-- Every query in database/*.store.js behaves identically before and after.
--
-- WHAT IT ACTUALLY FIXES
-- Without RLS, PostgREST exposes these tables to anyone holding the project's
-- anon key -- which is a public value by design. Today nothing ships that key
-- to a browser, but the tables have no gate at all if it ever leaks.
--
-- WHY THERE ARE NO POLICIES BELOW
-- Deliberate. RLS enabled + zero policies = deny every row to every role that
-- does not bypass RLS. That is the correct posture here: nothing except the
-- server should ever read these tables. Add policies only if you later build a
-- feature that queries Supabase directly from the browser with a user JWT.
--
-- IMPACT
-- Catalog-only change (flips pg_class.relrowsecurity). No table rewrite, no
-- index rebuild, no restart, no downtime. Instant regardless of row count.
--
-- ROLLBACK
-- Swap `enable` for `disable` in the statements below and re-run.

begin;

alter table public.accounts        enable row level security;
alter table public.clients         enable row level security;
alter table public.machines        enable row level security;
alter table public.parts_catalog   enable row level security;
alter table public.invites         enable row level security;
alter table public.password_resets enable row level security;

commit;


-- Verification. Run this after the block above.
-- Expect rls_enabled = true and policy_count = 0 for every row.
-- Any table listed here with rls_enabled = false was missed and still needs
-- an `alter table` line added above.

select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.polname) as policy_count
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relrowsecurity, c.relname;
