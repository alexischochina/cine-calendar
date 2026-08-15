// Persistance des séances événement sur la ligne `calendar`, pour la rubrique « Événement à venir ».
//
// Pourquoi persister plutôt que dériver : le rail vit sur la timeline, qui ne lit que Supabase (un
// chargement de page normale ne sort pas sur le réseau). Une rubrique dérivée du cache de la vue
// Séances n'apparaîtrait qu'après un passage par cette vue — jamais au moment où elle sert, puisque
// c'est elle qui doit y envoyer.
//
// Trois appelants, trois rythmes, aucune requête supplémentaire : tous lisent le L1 que leur propre
// chargement vient de remplir (`useInTheatersSync`, `useUpcomingEvents`, `useSeances.load`).

export function useSeanceEvents() {
    const client = useSupabaseClient();
    const { movies } = useMovieCalendar();
    const { payloadFor } = useShowtimes();

    // Migration pas jouée : on ne réessaie pas à chaque chargement de journée.
    const disabled = useState('seanceEventsDisabled', () => false);
    // Source de libellés indisponible (table absente) : même logique, on se tait pour la visite.
    const detailsDisabled = useState('eventDetailsDisabled', () => false);

    // Quelques appels de front : ce sont des allers-retours vers notre propre API, et le pré-filtre a
    // déjà écarté l'immense majorité des salles.
    const DETAIL_CONCURRENCY = 4;

    // ⚠️ Report du libellé déjà connu quand la source n'a pas répondu. Sans lui, une panne d'exploitant
    // **effaçait** un texte obtenu la veille : `mergeEventEntries` remplace les entrées des journées
    // relues, et une entrée revenue sans `detail` écrasait celle qui en avait un. C'est exactement
    // l'appauvrissement silencieux que `graftEvents` s'interdit via `seen` — la même règle vaut ici.
    const carryOverOne = (entry, known) => {
        const previous = known?.get(entryKey(entry));
        return previous?.detail ? { ...entry, detail: previous.detail, url: previous.url ?? null } : entry;
    };

    const carryOver = (entries, known) => entries.map(entry => carryOverOne(entry, known));

    // Texte libre de l'exploitant, quand il existe (cf. `server/api/events/detail.js`).
    //
    // ⚠️ Filtré par `isKnownExhibitorVenue` **avant** l'appel : c'est ce qui rend l'enrichissement quasi
    // gratuit, la grande majorité des salles parisiennes n'ayant aucune source branchée.
    const withDetails = async (entries, title, known) => {
        if (detailsDisabled.value) return carryOver(entries, known);

        // ⚠️ En parallèle borné, pas en série : le pré-filtre borne le *nombre* d'allers-retours vers
        // notre API, pas leur durée cumulée.
        return promisePool(entries.map(entry => async () => {
            if (!isKnownExhibitorVenue(entry.cinema)) return entry;

            try {
                const { detail, url, unavailable } = await $fetch('/api/events/detail', {
                    query: {
                        title,
                        date: entry.date,
                        cinema: entry.cinema,
                        // Clé de jointure d'UGC (cf. `server/utils/ugc.js`). Séparateur `|` : une URL
                        // de billetterie contient déjà des `&` et des `,`.
                        bookings: (entry.bookings ?? []).join('|'),
                    },
                });
                if (unavailable) { detailsDisabled.value = true; return carryOverOne(entry, known); }
                return detail ? { ...entry, detail, url: url ?? null } : carryOverOne(entry, known);
            } catch (e) {
                // Le libellé est un bonus : son absence ne doit jamais coûter l'entrée elle-même.
                console.error('Libellé d\'événement indisponible pour', title, entry.date, e);
                return carryOverOne(entry, known);
            }
        }), DETAIL_CONCURRENCY);
    };

    // `list`  : les films dont on vient de charger des séances.
    // `dates` : les journées à relire dans le cache L1 — celles que l'appelant vient de demander. Ce
    //           sont aussi les seules journées dont on s'autorise à **remplacer** les entrées connues
    //           (cf. `mergeEventEntries`) : ailleurs, on n'a rien vu, donc on ne défait rien.
    // `stamp` : réécrire l'horodatage même quand les entrées n'ont pas bougé. Réservé aux appelants
    //           qui s'en servent de gate hebdomadaire (`useUpcomingEvents`) — sans ça leur balayage
    //           repartirait à chaque chargement de l'app, faute de trace de leur passage.
    const syncEvents = async (list, dates, { stamp = false } = {}) => {
        if (disabled.value || !list.length || !dates.length) return;

        const today = isoDay(0);
        const freshSince = lastWednesday();
        const bounds = { freshSince, today };

        // On relit les lignes depuis `movies.value` et non les copies reçues : les appelants
        // réassignent la liste juste avant (états « en salle », identifiants Allociné résolus), et
        // travailler sur des copies périmées écraserait ces mises à jour.
        const current = new Map(movies.value.map(m => [m.id, m]));

        // Ce que chaque film a à écrire, résolu en parallèle borné. ⚠️ En série, un film attendait la
        // résolution des libellés du précédent — or `withDetails` sort sur le réseau, et la vue
        // Événements balaie sept journées. Plafond de requêtes simultanées vers notre propre API :
        // 3 films × `DETAIL_CONCURRENCY`.
        const MOVIE_CONCURRENCY = 3;

        const resolved = await promisePool(list.map(({ id }) => async () => {
            const movie = current.get(id);
            if (!movie) return null;

            const payloads = dates.map(date => [date, payloadFor(movie, date)]).filter(([, p]) => p);
            // Aucune journée lue pour ce film : on ne sait rien de neuf. Sans `stamp`, on n'écrit rien
            // — ne pas confondre avec « aucun événement », un film non résolu chez Allociné passerait
            // ici à chaque chargement et effacerait ce qu'une visite précédente avait trouvé.
            if (!payloads.length && !stamp) return null;

            const previous = movieEvents(movie, bounds);
            const found = await withDetails(
                payloads.flatMap(([date, payload]) => dayEventEntries(payload, date)),
                movie.title,
                new Map(previous.map(e => [entryKey(e), e])),
            );
            const next = mergeEventEntries(previous, found, {
                dates: payloads.map(([date]) => date),
                today,
            });

            // Rien de neuf : ni écriture, ni horodatage — sauf si l'appelant a besoin de la trace.
            const key = entriesKey(next);
            if (!stamp && key === entriesKey(previous)) return null;

            return { id, key, entries: next };
        }), MOVIE_CONCURRENCY);

        // Regroupées par lot d'entrées identiques : un jour ordinaire, tous les films concernés
        // partagent le même lot (`[]`), donc une seule requête au lieu d'une par film. Le
        // regroupement se fait **après** le pool, pas dedans : une `Map` alimentée depuis plusieurs
        // tâches concurrentes dépendrait de leur ordre d'arrivée, et l'ordre des `ids` d'un lot
        // cesserait d'être reproductible d'une exécution à l'autre.
        const byEntries = new Map();

        for (const entry of resolved) {
            if (!entry) continue;
            if (!byEntries.has(entry.key)) byEntries.set(entry.key, { entries: entry.entries, ids: [] });
            byEntries.get(entry.key).ids.push(entry.id);
        }

        if (!byEntries.size) return;

        const checkedAt = new Date().toISOString();
        const applied = new Map();

        for (const { entries, ids } of byEntries.values()) {
            const patch = { events: entries, events_checked_at: checkedAt };
            const { error } = await client.from('calendar').update(patch).in('id', ids);

            if (error) {
                // Colonnes absentes : le code peut être déployé avant que la migration soit jouée. On
                // se tait pour le reste de la visite plutôt que de retenter à chaque journée affichée
                // — la vue Séances, elle, marque déjà ses séances sans avoir besoin de ces colonnes.
                // Le détail des codes PostgREST vit dans `shared/utils/pgErrors.js`.
                if (isMissingSchema(error)) {
                    disabled.value = true;
                    console.warn('[événements] Colonnes `events` / `events_checked_at` absentes — joue _ressources/sql/2608141200-add-seance-events.sql pour la rubrique « Événement à venir ».');
                    return;
                }
                console.error('[événements] Mise à jour échouée:', error.message);
                continue;
            }
            for (const id of ids) applied.set(id, patch);
        }

        if (!applied.size) return;

        // Un seul réassign : le rail lit `eventSoon` / `cinemaNow`, qui en dérivent.
        movies.value = movies.value.map(m => {
            const patch = applied.get(m.id);
            return patch ? { ...m, ...patch } : m;
        });
    };

    return { syncEvents };
}
