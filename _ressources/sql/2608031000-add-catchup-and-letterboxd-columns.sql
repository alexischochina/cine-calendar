-- Colonnes « À rattraper » + notes Letterboxd (plan 2608031000 — Stats Top 10 & liste à rattraper)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute à la table `calendar` :
--   - catchup             : film personnellement marqué « à rattraper » (slider dédié)
--   - letterboxd_rating   : note Letterboxd (0–5) scrapée via le JSON-LD de la fiche film
--   - letterboxd_rating_at: date du dernier scrape (refresh throttlé, périmé > 7 j)
--   - tmdb_vote           : note TMDB (vote_average, /10) — fallback de tri gratuit
--                           quand la note Letterboxd manque, ramené sur /5 côté front.
--
-- `catchup` non-null par défaut false. Les 3 autres sont nullable pour les lignes
-- pré-backfill ; régularisées par scripts/backfill-letterboxd.mjs et backfill-movies.mjs.

alter table calendar
  add column if not exists catchup boolean not null default false,
  add column if not exists letterboxd_rating numeric,
  add column if not exists letterboxd_rating_at timestamptz,
  add column if not exists tmdb_vote numeric;
