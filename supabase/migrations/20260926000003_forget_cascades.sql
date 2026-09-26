-- "Delete my online data" removes a player's challenges too, not just their daily results.
alter table public.challenges
  drop constraint challenges_player_id_fkey,
  add constraint challenges_player_id_fkey foreign key (player_id) references public.players (id) on delete cascade;
