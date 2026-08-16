// Seconde passe : qualifier les séances déjà chargées en séances événement.
//
// L'endpoint film porte les horaires mais **aucun champ d'événement** ; seul l'endpoint salle les a
// (cf. `server/utils/allocine.js`). On garde donc le premier pour les horaires et on interroge le
// second pour les seules salles qui jouent des films de la liste — ~25 un jour ordinaire contre ~53
// pour tout Paris. Rapprochement sur `internalId`, jamais sur l'heure (une salle peut programmer deux
// séances à la même minute dans deux de ses salles).
//
// Le résultat est **greffé dans le cache L1 des séances** : tout l'aval lit `showtime.events` sans
// savoir que cette passe existe.
//
// ⚠️ Couverture partielle assumée — l'endpoint salle est creux. La passe est bâtie pour ne jamais se
// tromper dans l'autre sens : on ne se prononce que sur les séances réellement rendues (`seen`). Un
// événement manqué est un badge en moins, un faux badge envoie à une séance qui n'existe pas.

const REFRESH_CONCURRENCY = 4;

// Même borne que la route (`MAX_CODES`) : au-delà elle répond 400 et on retomberait sur un
// rafraîchissement unitaire par salle — le chemin coûteux que la lecture groupée existe pour éviter.
const CACHE_BATCH = 50;

export function useTheaterEvents() {
    const { payloads } = useShowtimes();

    // Table absente : on ne réessaie pas à chaque journée affichée. La vue reste juste sans nous,
    // il lui manque seulement les marqueurs.
    const disabled = useState('theaterEventsDisabled', () => false);

    const cacheKey = (allocineId, date) => `${allocineId}:${date}`;

    // Salles à interroger : celles qui apparaissent dans les payloads du jour, pour les films donnés.
    // C'est tout l'intérêt de la passe ciblée — on ne demande jamais une salle qui ne joue rien de la
    // liste.
    const theaterCodes = (list, date) => {
        const codes = new Set();
        for (const movie of list) {
            if (!movie.allocine_id) continue;
            const payload = payloads.value[cacheKey(movie.allocine_id, date)];
            for (const theater of payload?.theaters ?? []) {
                if (theater.code) codes.add(theater.code);
            }
        }
        return [...codes];
    };

    // Greffe les libellés sur les séances du jour (cf. `graftEvents`, qui porte la règle). Un seul
    // réassign de `payloads` en fin de course : il est lu par tous les `computed` en aval.
    const graft = (list, date, found) => {
        if (!found.seen.size) return;
        const next = {};

        for (const movie of list) {
            if (!movie.allocine_id) continue;

            const key = cacheKey(movie.allocine_id, date);
            const payload = payloads.value[key];
            if (!payload) continue;

            next[key] = graftEvents(payload, found);
        }

        if (Object.keys(next).length) payloads.value = { ...payloads.value, ...next };
    };

    // `list` : les films dont les séances viennent d'être chargées. `date` : la journée concernée.
    // Renvoie le nombre de séances sur lesquelles on a pu se prononcer, pour la mise au point — et non
    // le nombre de salles interrogées, qui ne dit rien du creux de l'endpoint.
    const loadEvents = async (list, date) => {
        if (disabled.value || !list.length) return 0;

        const codes = theaterCodes(list, date);
        if (!codes.length) return 0;

        const toRefresh = [];
        // `seen` : séances réellement rendues par l'endpoint salle — la seule preuve qu'on puisse se
        // prononcer sur elles. Distinct de « séances événement » : une séance vue sans libellé est une
        // information (« celle-là, ce n'est pas un événement »), une séance non vue n'en est pas une.
        // `previews` : celles qui sont des avant-premières, qui décident de l'éligibilité carte UGC.
        const found = { events: {}, seen: new Set(), previews: new Set() };

        const absorb = (theater) => {
            Object.assign(found.events, theater?.events ?? {});
            for (const id of theater?.seen ?? []) found.seen.add(id);
            for (const id of theater?.previews ?? []) found.previews.add(id);
        };

        const batches = [];
        for (let i = 0; i < codes.length; i += CACHE_BATCH) batches.push(codes.slice(i, i + CACHE_BATCH));

        // Les paquets partent ensemble : ils ne font que lire le cache, et il y en a au plus deux.
        await Promise.all(batches.map(async (batch) => {
            try {
                const { theaters, missing, unavailable } = await $fetch('/api/allocine/events', {
                    query: { codes: batch.join(','), date },
                });

                // Migration pas jouée : inutile d'enchaîner ~25 rafraîchissements qui échoueront tous
                // à l'écriture. On se tait pour le reste de la visite.
                if (unavailable) {
                    disabled.value = true;
                    return;
                }

                for (const theater of Object.values(theaters ?? {})) absorb(theater);
                toRefresh.push(...(missing ?? []));
            } catch (e) {
                // Cache illisible : ce paquet part au rafraîchissement plutôt que d'abandonner.
                console.error('Lecture groupée des événements échouée', e);
                toRefresh.push(...batch);
            }
        }));

        if (disabled.value) return 0;

        if (toRefresh.length) {
            await promisePool(toRefresh.map(code => async () => {
                try {
                    const theater = await $fetch('/api/allocine/events-refresh', { query: { code, date } });
                    // ⚠️ La route ne throw pas quand Allociné est injoignable : elle répond 200 avec
                    // `{ error: true }`. Sans ce test, une panne réseau serait indistinguable d'une
                    // salle qui n'a rien à dire — et `seen` vide, la conséquence resterait la même,
                    // mais autant ne pas compter sur cet heureux hasard.
                    if (theater?.error) return;
                    absorb(theater);
                } catch (e) {
                    console.error('Événements indisponibles pour la salle', code, e);
                }
            }), REFRESH_CONCURRENCY);
        }

        graft(list, date, found);
        return found.seen.size;
    };

    return { loadEvents };
}
