-- État « en salle » piloté par Allociné (suite du plan 2608121539 — page « Séances »)
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- Jusqu'ici `state = 'inTheaters'` était posé par une règle de date (film cinéma sorti dans
-- l'année en cours) et ne retombait jamais : un film de janvier restait « en salle » en décembre,
-- dans le rail comme dans la vue Séances, sans la moindre séance. Le flag dépend désormais de la
-- seule question qui vaille — *ce film a-t-il une séance à Paris dans les 7 jours qui viennent ?* —
-- tranchée par `app/composables/useInTheatersSync.js`.
--
--   - in_theaters_checked_at : horodatage du dernier contrôle abouti. Sert de gate : on ne
--                              recontrôle qu'une fois par semaine ciné (toute valeur antérieure au
--                              dernier mercredi 00 h est périmée, comme pour `showtimes_cache`).
--                              Sert aussi de garde anti-va-et-vient : tant qu'une ligne n'a jamais
--                              été contrôlée, la règle de date d'origine la promeut encore ; une
--                              fois contrôlée, seul Allociné décide.

alter table calendar
  add column if not exists in_theaters_checked_at timestamptz;
