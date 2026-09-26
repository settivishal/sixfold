-- Server-only helpers: callable by the Edge Function (service role), never by clients.
-- Each is a single statement, so concurrent submissions can't race each other.

-- Find or create the player for a key hash.
create function public.ensure_player(p_key_hash text)
returns table (id uuid, name text)
language sql security definer set search_path = ''
as $$
  insert into public.players (key_hash) values (p_key_hash)
  on conflict (key_hash) do update set key_hash = excluded.key_hash
  returning players.id, players.name;
$$;

-- Record a daily time, keeping only the player's best.
create function public.submit_daily(p_day int, p_player uuid, p_ms int, p_moves int)
returns table (best int, improved boolean)
language sql security definer set search_path = ''
as $$
  with up as (
    insert into public.daily_results as r (day, player_id, ms, moves)
    values (p_day, p_player, p_ms, p_moves)
    on conflict (day, player_id) do update
      set ms = excluded.ms, moves = excluded.moves, updated_at = now()
      where excluded.ms < r.ms
    returning r.ms
  )
  select coalesce((select ms from up), (select ms from public.daily_results where day = p_day and player_id = p_player)),
         exists (select 1 from up);
$$;

-- Sliding-window rate limit: records the hit and says whether it is allowed.
create function public.rate_hit(p_player uuid, p_kind text, p_max int, p_window interval)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.rate_events
      where player_id = p_player and kind = p_kind and at > now() - p_window) >= p_max then
    return false;
  end if;
  insert into public.rate_events (player_id, kind) values (p_player, p_kind);
  delete from public.rate_events where player_id = p_player and kind = p_kind and at < now() - p_window;
  return true;
end;
$$;

revoke all on function public.ensure_player(text), public.submit_daily(int, uuid, int, int),
  public.rate_hit(uuid, text, int, interval) from public, anon, authenticated;
grant execute on function public.ensure_player(text), public.submit_daily(int, uuid, int, int),
  public.rate_hit(uuid, text, int, interval) to service_role;
