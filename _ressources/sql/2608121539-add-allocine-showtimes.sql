-- Séances parisiennes (plan 2608121539 — page « Séances »)
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent (`if not exists` partout,
-- policies recréées via `drop … if exists`).
--
-- Trois parties :
--   1. `calendar`        : identifiant Allociné du film + horodatage de la dernière résolution
--   2. `cinemas`         : référentiel des salles (pivot de la feature — carte UGC, géocodage)
--   3. `showtimes_cache` : cache durable des séances, par (film, date)
--
-- Le cache vit en base et non dans le cache mémoire Nitro : sur Vercel ce dernier meurt au cold
-- start, chaque réveil retaperait Allociné pour rien. Une table le rend durable, partagé entre
-- instances, et inspectable.

-- 1. Colonnes sur `calendar` --------------------------------------------------------------------
--
--   - allocine_id         : identifiant du film chez Allociné, résolu par titre depuis
--                           /film/aucinema/. `bigint` et non `integer` : les ids récents dépassent
--                           l'int32 (ex. 1000037046). Nullable — un film peut ne pas être
--                           (encore) à l'affiche, donc introuvable dans l'index.
--   - allocine_checked_at : horodatage de la dernière *tentative* de résolution, pour ne pas
--                           s'acharner à chaque chargement sur un film introuvable.

alter table calendar
  add column if not exists allocine_id bigint,
  add column if not exists allocine_checked_at timestamptz;

-- 2. Référentiel des salles ---------------------------------------------------------------------
--
-- Peuplée automatiquement par /api/allocine/showtimes (toute salle vue dans une réponse et absente
-- de la table y est insérée), puis complétée par :
--   - le seed `2608121539-seed-cinemas-ugc.sql` pour `accepts_ugc` (liste curée à la main :
--     Allociné porte l'info mais a déjà été pris en défaut dessus) ;
--   - `scripts/geocode-cinemas.mjs` pour lat / lng / arrondissement via la Base Adresse Nationale.
--
-- `code` en `text` et non en entier : les codes salle Allociné sont alphanumériques (C0097, W3140).

create table if not exists cinemas (
  code          text primary key,
  name          text not null,
  address       text,
  zip           text,
  arrondissement smallint,
  circuit       text,
  accepts_ugc   boolean not null default false,
  lat           double precision,
  lng           double precision,
  geocode_score real,
  geocoded_at   timestamptz,
  updated_at    timestamptz default now()
);

-- 3. Cache durable des séances ------------------------------------------------------------------
--
-- `payload` = réponse déjà normalisée par server/utils/allocine.js (salles 75xxx + séances
-- aplaties), pas le JSON brut d'Allociné : le format du cache est celui que consomme le front.
-- Clé primaire composite (allocine_id, date) → l'écriture est un upsert idempotent, un film/jour
-- n'est jamais dupliqué. Index sur `fetched_at` pour le ménage des vieilles entrées.

create table if not exists showtimes_cache (
  allocine_id bigint      not null,
  date        date        not null,
  payload     jsonb       not null,
  fetched_at  timestamptz not null default now(),
  primary key (allocine_id, date)
);

create index if not exists showtimes_cache_fetched_at_idx on showtimes_cache (fetched_at);

-- 4. RLS ----------------------------------------------------------------------------------------
--
-- Cohérent avec `calendar` : app mono-utilisateur, lecture et écriture réservées aux utilisateurs
-- authentifiés. Les deux tables ne portent aucune donnée personnelle (référentiel public de salles
-- et horaires publics), mais on ne les laisse pas ouvertes en écriture pour autant.

alter table cinemas enable row level security;
alter table showtimes_cache enable row level security;

drop policy if exists "cinemas: accès authentifié" on cinemas;
create policy "cinemas: accès authentifié" on cinemas
  for all to authenticated using (true) with check (true);

drop policy if exists "showtimes_cache: accès authentifié" on showtimes_cache;
create policy "showtimes_cache: accès authentifié" on showtimes_cache
  for all to authenticated using (true) with check (true);
