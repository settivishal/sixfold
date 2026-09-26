-- Sixfold back end: guest players, daily leaderboard, challenge links, rate limiting.
-- Clients never touch these tables directly: RLS is on with no policies. Writes go through the
-- `api` Edge Function (service role) after it verifies the solve; reads go through the
-- SECURITY DEFINER functions below, which expose only public columns.

create table public.players (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  name text check (name is null or (char_length(name) between 1 and 24 and name !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now()
);

create table public.daily_results (
  day int not null check (day > 0),
  player_id uuid not null references public.players (id) on delete cascade,
  ms int not null check (ms between 1000 and 3600000),
  moves int not null check (moves between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, player_id)
);
create index daily_results_day_ms on public.daily_results (day, ms);

create table public.challenges (
  id text primary key check (id ~ '^[A-Za-z0-9]{8}$'),
  player_id uuid references public.players (id) on delete set null,
  puzzle smallint not null check (puzzle in (2, 3, 4)),
  scramble text not null check (char_length(scramble) <= 1000),
  start text not null check (char_length(start) <= 96),
  moves jsonb not null check (jsonb_typeof(moves) = 'array'),
  ms int not null check (ms between 1000 and 3600000),
  created_at timestamptz not null default now()
);
create index challenges_player on public.challenges (player_id);

create table public.rate_events (
  player_id uuid not null references public.players (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup on public.rate_events (player_id, kind, at desc);

alter table public.players enable row level security;
alter table public.daily_results enable row level security;
alter table public.challenges enable row level security;
alter table public.rate_events enable row level security;

-- Top of the daily board: public columns only.
create function public.daily_leaderboard(p_day int, p_limit int default 20)
returns table (rank bigint, name text, ms int, moves int, player_id uuid)
language sql stable security definer set search_path = ''
as $$
  select rank() over (order by r.ms), coalesce(p.name, 'Anonymous cuber'), r.ms, r.moves, r.player_id
  from public.daily_results r join public.players p on p.id = r.player_id
  where r.day = p_day
  order by r.ms, r.updated_at
  limit least(greatest(p_limit, 1), 100);
$$;

-- One player's standing, even when they are outside the top N.
create function public.daily_rank(p_day int, p_player uuid)
returns table (rank bigint, total bigint, ms int)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) + 1 from public.daily_results o where o.day = p_day and o.ms < r.ms),
    (select count(*) from public.daily_results o where o.day = p_day),
    r.ms
  from public.daily_results r
  where r.day = p_day and r.player_id = p_player;
$$;

-- A challenge's replay data (never the owner's key).
create function public.get_challenge(p_id text)
returns table (id text, puzzle smallint, scramble text, start text, moves jsonb, ms int, name text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.puzzle, c.scramble, c.start, c.moves, c.ms, coalesce(p.name, 'A friend'), c.created_at
  from public.challenges c left join public.players p on p.id = c.player_id
  where c.id = p_id;
$$;

revoke all on function public.daily_leaderboard(int, int), public.daily_rank(int, uuid), public.get_challenge(text) from public;
grant execute on function public.daily_leaderboard(int, int), public.daily_rank(int, uuid), public.get_challenge(text) to anon, authenticated;
