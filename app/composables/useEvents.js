// Vue « Événements » : tous les films de la liste qui ont une séance particulière devant eux.
//
// Deux moitiés bien séparées :
//   - la **lecture** est purement dérivée de `movies` (colonne `events`), donc immédiate et sans
//     réseau. La page s'affiche avec ce qu'on sait déjà, comme la timeline ;
//   - le **relevé** complète ce qu'on sait, journée par journée, en tâche de fond.
//
// Pourquoi un relevé complet ici et nulle part ailleurs. Les deux balayages hebdomadaires ne regardent
// qu'une journée chacun : `useInTheatersSync` aujourd'hui, `useUpcomingEvents` les jours d'avant-première
// d'un film à venir. Un film déjà à l'affiche qui a un ciné-club samedi n'est donc repéré que si on
// ouvre le samedi dans la vue Séances. Cette page-ci a précisément pour objet de ne rien manquer sur la
// semaine : c'est le seul endroit où balayer les 7 journées se justifie.
//
// ⚠️ Ce que ça coûte, à froid : 7 journées × (~12 films + ~25 salles). C'est l'équivalent exact de
// cliquer les sept jours de la vue Séances, et le cache L2 le rend gratuit ensuite (même règle de
// fraîcheur). Le relevé est **séquentiel** et la page se remplit au fur et à mesure — un jour rendu est
// un jour affiché — plutôt que de tout retenir derrière un écran de chargement.

export function useEvents() {
    const { movies, eventBounds } = useMovieCalendar();
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

    // Films à événement, triés par imminence. Un film y figure qu'il soit à l'affiche ou pas — une
    // avant-première a lieu *avant* la sortie, c'est le cas que la page doit surtout montrer.
    const films = computed(() => {
        const bounds = eventBounds();
        return movies.value
            .filter(m => hasUpcomingEvent(m, bounds))
            .map(m => ({
                movie: m,
                days: groupEventsByDay(movieEvents(m, bounds)),
            }))
            .sort((a, b) =>
                String(a.days[0]?.date).localeCompare(String(b.days[0]?.date))
                || String(a.movie.title).localeCompare(String(b.movie.title)));
    });

    const nbEvents = computed(() =>
        films.value.reduce((n, f) => n + f.days.length, 0)
    );

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
            const list = movies.value.filter(m => m.state === 'inTheaters');
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
