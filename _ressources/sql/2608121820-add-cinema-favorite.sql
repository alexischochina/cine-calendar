-- Cinémas favoris (plan 2608121539 — suite)
-- À exécuter une seule fois dans le SQL editor Supabase, après `2608121539-add-allocine-showtimes.sql`.
--
-- Ajoute à la table `cinemas` :
--   - favorite : salle épinglée par l'utilisateur. Les favoris remontent en tête du regroupement
--                « Par cinéma », et leurs séances remontent en tête de chaque film dans le
--                regroupement « Par film ».
--
-- Pourquoi une colonne et pas du `localStorage` : c'est une préférence durable qui doit suivre
-- l'utilisateur d'un appareil à l'autre, au même titre qu'`accepts_ugc`. Les deux sont de la
-- curation manuelle sur la même table, elles vivent au même endroit.
--
-- `not null default false` : une salle nouvellement découverte n'est pas favorite, et le tri n'a
-- jamais à traiter de `null`.

alter table cinemas
  add column if not exists favorite boolean not null default false;

-- Le tri lit cette colonne sur chaque rendu de la liste ; l'index garde la lecture du référentiel
-- constante quand le nombre de salles grandira.
create index if not exists cinemas_favorite_idx on cinemas (favorite) where favorite;
