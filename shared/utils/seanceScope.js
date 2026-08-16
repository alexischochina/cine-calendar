// Périmètre de la vue Séances — **une seule définition**, app et serveur.
//
// Ici et pas en double parce que le préchauffage planifié (`server/api/cron/warm.js`) doit préchauffer
// ce que la vue demandera : une copie aurait divergé au premier changement de périmètre, sans erreur
// ni log — juste des films que le visiteur repaie.
//
// ⚠️ Ces deux règles sont **nues** : sans la garde de fraîcheur du relevé d'événements
// (`events_checked_at`), que `hasUpcomingEvent` ajoute côté app. C'est voulu — cette garde ne fait
// jamais qu'exclure, donc le cron préchauffe un sur-ensemble de ce que la vue montre, ce qui est le
// bon sens de l'erreur. L'inclusion est vérifiée par `scripts/test-seances-rules.mjs`.

// ⚠️ `state !== 'seen'` et non `state === 'inTheaters'` : une avant-première a lieu **avant** la
// sortie, filtrer sur l'état les manquerait toutes (cf. `useUpcomingEvents`).
export const hasDatedEventFrom = (movie, today) =>
    movie?.state !== 'seen'
    && (movie?.events ?? []).some(e => e?.date && e.date >= today && e.labels?.length);

// Les deux rubriques du rail réunies : ce qui est en salle, plus ce qui a un événement devant lui.
export const isSeanceFilm = (movie, today) =>
    movie?.state === 'inTheaters' || hasDatedEventFrom(movie, today);
