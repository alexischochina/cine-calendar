-- Temps de trajet en transports en commun jusqu'aux salles (plan 2608121539 — suite)
-- À exécuter une seule fois dans le SQL editor Supabase, après `2608121539-add-allocine-showtimes.sql`.
--
-- Ajoute à la table `cinemas` :
--   - transit_minutes    : trajet porte-à-porte depuis le domicile, en minutes, calculé par
--                          `scripts/transit-times.mjs` via l'API PRIM (Île-de-France Mobilités).
--   - transit_checked_at : date du calcul, pour rafraîchir après un changement de réseau.
--
-- Pourquoi une colonne et pas un appel à la volée : le domicile est fixe, donc le trajet vers une
-- salle donnée est une **constante**. On le calcule une fois (~46 requêtes) et on le lit ensuite en
-- base — zéro appel sortant au chargement de la page.
--
-- Nullable : une salle non géocodée, ou ajoutée depuis le dernier passage du script, n'a pas de
-- temps de trajet. L'UI retombe alors sur la distance à vol d'oiseau, et n'affiche rien si les deux
-- manquent — jamais de valeur inventée.

alter table cinemas
  add column if not exists transit_minutes smallint,
  add column if not exists transit_checked_at timestamptz;
