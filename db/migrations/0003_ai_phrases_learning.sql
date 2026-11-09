-- Royale Club · las frases generadas por IA se guardan y se miden (para que la IA aprenda de cómo funcionan en las mesas)
-- Solo conteos por frase: nunca nombres ni identificadores de personas.

alter table ai_phrases add column if not exists source    text    not null default 'gemini';            -- gemini, ollama, manual…
alter table ai_phrases add column if not exists shown     integer not null default 0 check (shown >= 0);     -- veces que salió en una mesa
alter table ai_phrases add column if not exists answered  integer not null default 0 check (answered >= 0);  -- personas que respondieron en esas rondas
alter table ai_phrases add column if not exists hits      integer not null default 0 check (hits >= 0);      -- Yo nunca: dijeron «yo sí»; ¿Quién…?: votos del más votado; Preferirías: tamaño de la minoría
alter table ai_phrases add column if not exists accepted  integer not null default 0 check (accepted >= 0);  -- Verdad o reto: se cumplió / se respondió
alter table ai_phrases add column if not exists declined  integer not null default 0 check (declined >= 0);  -- Verdad o reto: se rechazó (pasó y bebió)
alter table ai_phrases add column if not exists skipped   integer not null default 0 check (skipped >= 0);   -- el anfitrión la saltó

-- Rotación: se cargan primero las que menos han salido.
create index if not exists ai_phrases_rotate_idx on ai_phrases (kind, level, shown) where status = 'approved';
