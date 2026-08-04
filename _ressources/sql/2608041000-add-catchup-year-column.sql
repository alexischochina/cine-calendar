-- Colonne « année à rattraper » (plan 2608031000 — suite : films sans date de sortie FR)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute à la table `calendar` :
--   - catchup_year : année cible de la liste « à rattraper » pour un film SANS date de sortie
--                    résolue (ex. Riceboy Sleeps : aucune date FR chez TMDB). Sert de repli quand
--                    `release_date` est null — l'année d'affichage dérive alors de cette colonne au
--                    lieu de `yearOf(release_date)`. Ignoré (sans effet) pour les films datés, dont
--                    l'année reste celle de leur date de sortie.
--
-- Nullable : renseigné seulement à l'ajout d'un film catchup non daté depuis une vue Stats.

alter table calendar
  add column if not exists catchup_year integer;
