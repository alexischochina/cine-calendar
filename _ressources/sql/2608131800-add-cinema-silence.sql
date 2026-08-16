-- Salles absentes d'Allociné (suite du plan 2608121539 — page « Séances »)
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- Le 13/08/2026, UGC Ciné Cité Les Halles a disparu d'Allociné : interrogée par film comme par
-- salle, sur les 7 jours, la réponse était « 0 film », pendant qu'ugc.fr affichait 7 séances par
-- jour et que les autres UGC répondaient normalement. La vue n'avait aucun moyen de le dire — une
-- salle qui manque ne fait pas de bruit, contrairement à une salle dont les horaires seraient faux.
--
-- On ne peut pas inventer ces séances (cf. README, « Quand la lacune est chez Allociné »). Ce qu'on
-- peut, c'est **le dire**. `scripts/check-seances.mjs` pose ces deux colonnes, la vue les affiche.
--
--   - allocine_silent_since : premier jour où la salle a été trouvée muette ; NULL dès qu'elle
--                             reparle. Une date et non un booléen : « absente depuis le 13/08 »
--                             informe, « absente » inquiète sans rien dire.
--   - allocine_checked_at   : date du dernier contrôle, pour que la vue se taise plutôt que
--                             d'afficher un avertissement périmé si le script n'a pas tourné.

alter table cinemas
  add column if not exists allocine_silent_since date,
  add column if not exists allocine_checked_at   timestamptz;
