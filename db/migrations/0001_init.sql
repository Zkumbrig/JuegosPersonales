-- Royale Club · esquema inicial (Supabase / Postgres)
--
-- Principios:
--  * La identidad de las cuentas la lleva Supabase Auth (auth.users). Aquí NO hay tablas de contraseñas ni sesiones.
--  * Hoy se juega con un identificador anónimo por dispositivo (pid). Un perfil puede existir solo con pid y, el día que
--    la persona cree cuenta, se enlaza con user_id sin perder su historial.
--  * Todas las tablas tienen RLS activado SIN políticas: la API pública de Supabase (clave anon) no puede leer ni escribir.
--    Solo el servidor (conexión directa con DATABASE_URL, rol privilegiado) accede. Si algún día el cliente necesita leer
--    algo, se añade una política concreta por tabla; nunca se desactiva RLS.
--  * Fechas en UTC (timestamptz). Lo que contiene datos personales lleva deleted_at (borrado suave).

-- ---------- utilidades ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- perfiles ----------
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  pid           text unique,                                   -- identificador anónimo del dispositivo (rc_pid)
  user_id       uuid unique references auth.users (id) on delete set null,
  display_name  text not null check (char_length(display_name) between 1 and 16),
  first_seen    timestamptz not null default now(),
  nights        integer not null default 0 check (nights >= 0),
  rounds        integer not null default 0 check (rounds >= 0),
  drinks        integer not null default 0 check (drinks >= 0),
  best_reflex   integer check (best_reflex > 0),
  big_win       integer not null default 0 check (big_win >= 0),
  big_win_game  text not null default '',
  bluffs        integer not null default 0 check (bluffs >= 0),
  rebuys        integer not null default 0 check (rebuys >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint profiles_has_identity check (pid is not null or user_id is not null)
);
drop trigger if exists profiles_updated on profiles;
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();
create index if not exists profiles_last_idx on profiles (updated_at desc) where deleted_at is null;

create table if not exists achievements_unlocked (
  profile_id   uuid not null references profiles (id) on delete cascade,
  achievement  text not null,
  unlocked_at  timestamptz not null default now(),
  primary key (profile_id, achievement)
);

-- ---------- resultados de partidas (histórico y marcadores) ----------
create table if not exists game_results (
  id          uuid primary key default gen_random_uuid(),
  game        text not null,                                   -- ludo, freepoker, blackjack, party…
  room_code   text,
  board       smallint,                                        -- Ludo: 4, 6 u 8
  played_at   timestamptz not null default now(),
  duration_s  integer check (duration_s >= 0)
);
create index if not exists game_results_game_idx on game_results (game, played_at desc);

create table if not exists game_result_players (
  result_id   uuid not null references game_results (id) on delete cascade,
  profile_id  uuid references profiles (id) on delete set null, -- null: bot o perfil borrado
  name        text not null,
  is_bot      boolean not null default false,
  rank        smallint check (rank >= 1),
  score       integer,
  primary key (result_id, name)
);
create index if not exists game_result_players_profile_idx on game_result_players (profile_id);

-- ---------- reseñas privadas ----------
create table if not exists reviews (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  pid         text not null,
  profile_id  uuid references profiles (id) on delete set null,
  name        text not null,
  game        text not null,
  rating      smallint not null check (rating between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 400),
  room_code   text,
  theme       text
);
create index if not exists reviews_game_idx on reviews (game, created_at desc);
create index if not exists reviews_pid_idx on reviews (pid, game, created_at desc);

-- ---------- frases generadas con IA (para no perderlas al reiniciar y poder moderarlas) ----------
create table if not exists ai_phrases (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('never', 'likely', 'would', 'truth', 'dare')),
  level       smallint not null check (level between 1 and 3),
  text        text not null check (char_length(text) between 6 and 200),
  text_b      text check (char_length(text_b) <= 200),         -- "Preferirías": segunda opción
  status      text not null default 'approved' check (status in ('pending', 'approved', 'rejected', 'used')),
  model       text,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
create unique index if not exists ai_phrases_unique on ai_phrases (kind, level, md5(lower(text || coalesce(text_b, ''))));
create index if not exists ai_phrases_pick_idx on ai_phrases (kind, level) where status = 'approved';

-- ---------- cumplimiento y trazabilidad ----------
create table if not exists consents (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references profiles (id) on delete cascade,
  kind        text not null check (kind in ('age_18', 'terms', 'privacy', 'marketing')),
  version     text not null,                                   -- versión del texto aceptado
  accepted_at timestamptz not null default now(),
  ip_hash     text                                             -- hash, nunca la IP en claro
);
create index if not exists consents_profile_idx on consents (profile_id, kind);

create table if not exists audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,                                    -- 'system', 'admin' o id de perfil
  action     text not null,
  target     text,
  meta       jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

-- ---------- RLS: activado en todo, sin políticas (solo el servidor accede) ----------
alter table profiles              enable row level security;
alter table achievements_unlocked enable row level security;
alter table game_results          enable row level security;
alter table game_result_players   enable row level security;
alter table reviews               enable row level security;
alter table ai_phrases            enable row level security;
alter table consents              enable row level security;
alter table audit_log             enable row level security;
