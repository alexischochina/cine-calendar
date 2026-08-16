// Vue « Événements » : tous les films de la liste qui ont une séance particulière devant eux.
//
// Deux moitiés bien séparées :
//   - la **lecture** est purement dérivée de `movies` (colonne `events`), donc immédiate et sans
//     réseau. La page s'affiche avec ce qu'on sait déjà, comme la timeline ;
//   - le **relevé** complète ce qu'on sait, journée par journée, en tâche de fond.
//
// Pourquoi un relevé complet ici et nulle part ailleurs : les deux balayages hebdomadaires ne regardent
// qu'une journée chacun, si bien qu'un film à l'affiche qui a un ciné-club samedi n'est repéré que si on
// ouvre le samedi. Cette page a pour objet de ne rien manquer sur la semaine.
//
// ⚠️ Coût à froid : 7 journées × (~12 films + ~25 salles) — l'équivalent de cliquer les sept jours de la
// vue Séances, gratuit ensuite grâce au L2. Relevé **séquentiel**, la page se remplit au fur et à mesure.

export function useEvents() {
    const { movies } = useMovieCalendar();
    const { resolveAllocineIds, loadShowtimes } = useShowtimes();
    const { loadEvents } = useTheaterEvents();
    const { syncEvents } = useSeanceEvents();
    const { syncUpcomingEvents } = useUpcomingEvents();
    const { pruneEmptyHorizon } = useInTheatersSync();

    // Au-delà, on rend la main plutôt que de laisser la page tourner indéfiniment sur un cache froid
    // doublé d'une source lente. Ce qui n'a pas été relevé est **dit** (`scanned` vs `days.length`) :
    // une liste incomplète qui se présente comme complète est le pire des deux mondes.
    const SCAN_BUDGET_MS = 90 * 1000;

    const scanning = useState('eventsScanning', () => false);
    // Avancement du relevé, pour le dire plutôt que de laisser croire à une page vide.
    const scanned = useState('eventsScanned', () => 0);
    // Journée du dernier relevé complet, pour ne pas rebalayer à chaque aller-retour sur l'onglet.
    const scannedOn = useState('eventsScannedOn', () => null);

    const days = computed(() =>
        Array.from({ length: SEANCES_HORIZON_DAYS }, (_, i) => isoDay(i))
    );

    // La moitié **lecture**, sortie dans `useEventFilms` pour que le rail puisse l'utiliser sans
    // monter au passage toute la chaîne de relevé ci-dessus.
    const { films, nbEvents } = useEventFilms();

    // Relevé de la semaine. `force` ignore la mémoire de session (bouton « Actualiser »).
    const scan = async ({ force = false } = {}) => {
        const today = isoDay(0);
        if (scanning.value) return;
        if (!force && scannedOn.value === today) return;

        scanning.value = true;
        scanned.value = 0;
        try {
            // Les films à venir d'abord : c'est le lot le plus rentable (une requête par film pour
            // savoir s'il a une avant-première) et celui que rien d'autre ne couvre.
            await syncUpcomingEvents({ force });

            // ⚠️ Tous les films en salle, et **pas** `cinemaNow` : celui-ci retire précisément les films
            // que la rubrique événement a pris en charge (cf. `useMovieCalendar`). S'en servir ici
            // reviendrait à ne jamais rafraîchir les films dont on sait déjà qu'ils ont un événement —
            // donc à ne jamais voir disparaître un événement déprogrammé, ni apparaître une deuxième
            // date sur un film déjà repéré.
            //
            // Plus les sorties de la semaine encore `unseen` (`isFreshRelease`) : un film qui a raté sa
            // bascule « en salle » n'était relevé par personne. Règle partagée avec le préchauffage.
            const weekStart = lastWednesdayDay();
            const list = movies.value.filter(m =>
                m.state === 'inTheaters' || isFreshRelease(m, weekStart, today));
            if (list.length) {
                await resolveAllocineIds(list);

                const deadline = Date.now() + SCAN_BUDGET_MS;
                for (const date of days.value) {
                    if (Date.now() > deadline) {
                        console.warn(`[événements] Relevé interrompu : ${scanned.value}/${days.value.length} journées en ${SCAN_BUDGET_MS / 1000} s.`);
                        break;
                    }
                    await loadShowtimes(list, date);
                    await loadEvents(list, date);
                    await syncEvents(list, [date]);
                    // Incrémenté après coup : la journée compte quand elle est **relevée**, pas quand
                    // elle est demandée.
                    scanned.value++;
                }
                // Le balayage vient de charger les sept journées : c'est le seul endroit où la preuve
                // « ce film ne joue plus nulle part cette semaine » est complète. On en profite pour
                // retirer ceux qui traînent, sans attendre le mercredi (cf. `pruneEmptyHorizon`).
                // Uniquement si l'horizon a été relevé en entier : `pruneEmptyHorizon` conclut sur des
                // preuves complètes, un balayage interrompu n'en est pas une.
                if (scanned.value === days.value.length) await pruneEmptyHorizon(list, days.value);
            }
            // Le jour n'est mémorisé que si le relevé est allé au bout : sinon la prochaine visite
            // reprendrait là où on a abandonné en croyant avoir fini.
            if (scanned.value === days.value.length || !list.length) scannedOn.value = today;
        } finally {
            scanning.value = false;
        }
    };

    return { films, nbEvents, days, scanning, scanned, scan };
}
