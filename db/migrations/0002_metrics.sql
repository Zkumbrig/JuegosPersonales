-- Royale Club · medición de producto (sesiones de mesa, resultados y regreso de jugadores)
-- ---------- sesiones de mesa ----------
create table if not exists room_sessions (
  id             uuid primary key default gen_random_uuid(),
  room_code      text not null,
  started_at     timestamptz not null default now(),
  last_activity  timestamptz not null default now(),
  ended_at       timestamptz,
  max_players    smallint not null default 0 check (max_players >= 0),
  rounds         integer not null default 0 check (rounds >= 0),
  games          jsonb not null default '{}'::jsonb          -- { "ludo": 2, "never": 5 }: rondas por juego
);
create index if not exists room_sessions_started_idx on room_sessions (started_at desc);

alter table game_results add column if not exists session_id uuid references room_sessions (id) on delete set null;
create index if not exists game_results_session_idx on game_results (session_id);

-- ---------- regresos: una fila por perfil y día en que jugó ----------
create table if not exists profile_visits (
  profile_id  uuid not null references profiles (id) on delete cascade,
  day         date not null,
  primary key (profile_id, day)
);
create index if not exists profile_visits_day_idx on profile_visits (day);

alter table room_sessions  enable row level security;
alter table profile_visits enable row level security;

-- ---------- vistas de análisis (security_invoker: respetan RLS, la API pública no las ve) ----------
-- Cohortes semanales: de quienes llegaron esa semana, cuántos volvieron a jugar en los 7 y 30 días siguientes.
create or replace view retention_weekly with (security_invoker = true) as
select date_trunc('week', p.first_seen)::date                                   as cohort,
       count(*)                                                                  as size,
       count(*) filter (where exists (select 1 from profile_visits v where v.profile_id = p.id
                          and v.day > p.first_seen::date and v.day <= p.first_seen::date + 7))  as back_7d,
       count(*) filter (where exists (select 1 from profile_visits v where v.profile_id = p.id
                          and v.day > p.first_seen::date and v.day <= p.first_seen::date + 30)) as back_30d
  from profiles p
 where p.deleted_at is null
 group by 1
 order by 1 desc;

-- Uso por juego en los últimos 30 días: rondas, mesas distintas y jugadores medios.
create or replace view usage_by_game with (security_invoker = true) as
select g.game,
       count(*)                                    as rounds,
       count(distinct g.session_id)                as sessions,
       round(avg(pc.n)::numeric, 1)                as avg_players
  from game_results g
  left join lateral (select count(*) as n from game_result_players x where x.result_id = g.id and not x.is_bot) pc on true
 where g.played_at > now() - interval '30 days'
 group by g.game
 order by rounds desc;
