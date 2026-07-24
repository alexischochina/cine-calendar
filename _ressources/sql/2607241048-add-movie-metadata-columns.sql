-- Persistance des métadonnées films en BDD (plan 2607241048)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute à la table `calendar` :
--   - title        : titre du film (résolu à l'ajout via TMDB)
--   - release_date : date FR théâtrale résolue (nullable si pas de date FR)
--   - poster_path  : chemin TMDB relatif du poster (ex. /abc123.jpg), servi via image.tmdb.org
--
-- `manual_release_date`, `media`, `state` existent déjà et ne sont pas touchées.

alter table calendar
  add column if not exists title text,
  add column if not exists release_date date,
  add column if not exists poster_path text;
