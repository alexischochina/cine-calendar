-- Liens Letterboxd des réalisateurs (plan 2608161000 — réal cliquable dans la timeline)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute `letterboxd_directors` : jsonb, tableau [{ name, url }], un objet par réalisateur.
--
-- Une colonne plutôt qu'un slug dérivé du nom parce que le lien ne se devine pas — voir
-- shared/utils/letterboxdFilm.js. Mesuré sur les 428 réalisateurs de la base : ~4 % de liens morts,
-- plus une part non mesurable de liens vivants menant à la mauvaise personne.
--
-- Nullable : les lignes non renseignées retombent sur le slug deviné (app/utils/movieHelpers.js).
-- Régularisation des lignes existantes : node scripts/backfill-letterboxd.mjs

alter table calendar
  add column if not exists letterboxd_directors jsonb;
