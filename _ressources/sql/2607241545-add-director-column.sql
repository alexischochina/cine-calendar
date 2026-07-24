-- Persistance du réalisateur en BDD (plan 2607241545 — refonte Timeline)
-- À exécuter une seule fois dans le SQL editor Supabase.
--
-- Ajoute à la table `calendar` :
--   - director : réalisateur(s) du film (résolu via TMDB credits, joint si plusieurs, nullable)
--
-- Alimente le sous-titre des lignes de la timeline (réalisateur si connu, sinon libellé).

alter table calendar
  add column if not exists director text;
