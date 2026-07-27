-- Persistance des genres et pays en BDD (plan 2607271048 — page Statistiques par année)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute à la table `calendar` :
--   - genres    : noms FR des genres TMDB (déjà localisés par language=fr-FR), ex. {Drame, Comédie}
--   - countries : codes ISO 3166-1 des pays de production, ex. {FR, US}
--
-- Alimentent la vue Statistiques (top 5 genres, top 5 pays). Nullable pour les
-- lignes pré-backfill ; régularisées par scripts/backfill-movies.mjs.

alter table calendar
  add column if not exists genres text[],
  add column if not exists countries text[];
