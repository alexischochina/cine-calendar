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

// Sorti dans la semaine ciné en cours, et pas encore basculé « en salle ». Ces films-là tombaient entre
// les deux balayages : `useUpcomingEvents` s'arrête à la sortie, et le relevé de la vue Événements ne
// prenait que les `inTheaters` — or l'état ne bascule qu'au contrôle hebdomadaire, sur la seule journée
// d'aujourd'hui. Un film sorti mercredi qui rate cette bascule traversait la semaine sans que ses six
// autres journées soient regardées.
//
// ⚠️ Borné des deux côtés : avant `weekStart` c'est l'affaire du contrôle hebdomadaire, après `today`
// celle de `useUpcomingEvents`, qui sait le faire en une requête par film là où le balayage en coûte
// sept. Et `unseen` strictement, là où la règle du dessus prend tout sauf `seen` : les autres états
// sont des choix de l'utilisateur, on ne lui propose pas une salle pour un film qu'il a rangé ailleurs.
//
// ⚠️ Pas de gate par film, à la différence des deux autres balayages : c'est ce qui permet de voir
// apparaître une séance annoncée en cours de semaine, et un film qui a raté sa bascule n'a plus que ce
// lot pour le regarder. Le coût est borné par la règle — le film en sort au mercredi suivant.
export const isFreshRelease = (movie, weekStart, today) =>
    movie?.media === 'cinema'
    && movie?.state === 'unseen'
    && typeof movie?.release_date === 'string'
    && movie.release_date >= weekStart
    && movie.release_date <= today;
