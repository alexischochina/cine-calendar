// Avant-premières des films **pas encore sortis**.
//
// Le trou que ce fichier bouche. Une avant-première a lieu, par définition, *avant* la sortie : le film
// n'est donc pas « en salle », `useInTheatersSync` ne le regarde même pas (il filtre sur
// `release_date <= aujourd'hui`), et le rail ne le contient pas. Constaté sur *Fjord* le 14/08/2026 :
// sortie le 19/08, avant-premières les 17 et 18 — invisibles de bout en bout, alors que c'est
// exactement la séance qu'on ne veut pas manquer, puisqu'elle ne se rattrape pas.
//
// Comment on la trouve sans balayer sept journées par film. Allociné livre `nextDate` quand un film
// n'a **aucune** séance à la date demandée — ce qui est le cas normal d'un film à venir. Une seule
// requête sur aujourd'hui rend donc « la première date où ce film joue à Paris ». Si elle tombe dans
// l'horizon **et avant la sortie**, c'est une avant-première : on ne charge que cette journée-là.
//
// ⚠️ Le verdict « avant-première » se déduit ici des **dates**, pas des drapeaux d'Allociné — une
// séance antérieure à la sortie en est une, c'est une tautologie. C'est précieux : ça rend la rubrique
// insensible au creux de l'endpoint par salle (cf. `useTheaterEvents`), qui rate justement beaucoup de
// journées. La passe salle reste appelée derrière, pour récupérer le libellé quand elle l'a — mais son
// silence ne fait plus disparaître l'information.

// Au-delà, une sortie n'a pas encore de séances en vente et `nextDate` ne rend rien d'exploitable.
// Trois semaines couvrent largement les avant-premières, qui se tiennent presque toujours dans les
// jours précédant la sortie.
const RELEASE_LOOKAHEAD_DAYS = 21;

// Nombre de journées sondées à partir de la première séance repérée. Un film a souvent plusieurs
// avant-premières — *Fjord* en avait les 16, 17 et 18/08 pour une sortie le 19 (constaté le
// 14/08/2026) — et ne garder que la première laisse un trou net : passé le 16, l'entrée s'élague et la
// rubrique redevient vide jusqu'au mercredi suivant, alors que deux avant-premières restaient à venir.
//
// ⚠️ On **énumère** les journées, on ne suit pas `nextDate` de proche en proche. Piège vérifié :
// Allociné ne livre `nextDate` que sur une journée **vide** — dès qu'on atterrit sur un jour qui a des
// séances, il vaut `null` et la piste s'arrête. Le sondage est de toute façon court et borné : les
// avant-premières se tiennent dans les jours qui précèdent immédiatement la sortie, et la boucle
// s'arrête d'elle-même à la veille de celle-ci.
const MAX_PREVIEW_DAYS = 3;

// `YYYY-MM-DD` + n jours. Midi et non minuit : décaler à partir de midi traverse les changements
// d'heure sans jamais retomber sur la veille — même précaution que `isoDay`.
const addDays = (date, n) => {
    const [y, m, d] = date.split('-').map(Number);
    const shifted = new Date(y, m - 1, d, 12, 0, 0, 0);
    shifted.setDate(shifted.getDate() + n);
    return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
};

// Les autres états sont des décisions de l'utilisateur (« vu », « téléchargeable ») : on n'a pas à
// proposer d'aller voir en avant-première un film qu'il a rangé ailleurs.
const CHECKABLE_STATES = ['unseen', 'inTheaters'];

export function useUpcomingEvents() {
    const { movies } = useMovieCalendar();
    // ⚠️ `livePayloadFor` : tout ce qui sort d'ici part dans `calendar.events`. Un `nextDate` relu
    // depuis l'instantané écrirait une avant-première qui n'existe plus.
    const { resolveAllocineIds, loadShowtimes, livePayloadFor, forget } = useShowtimes();
    const { loadEvents } = useTheaterEvents();
    const { syncEvents } = useSeanceEvents();

    const syncing = useState('upcomingEventsSyncing', () => false);

    // Gate hebdomadaire porté par `events_checked_at`, que `syncEvents({ stamp: true })` réécrit à
    // chaque passage — y compris quand il n'a rien trouvé. Sans cette trace, le balayage repartirait à
    // chaque chargement de l'app pour tous les films à venir.
    const needsCheck = (movie) => {
        const at = Date.parse(movie.events_checked_at ?? '');
        return !Number.isFinite(at) || at < lastWednesday();
    };

    // `force` : ignorer le gate hebdomadaire. Réservé au geste explicite de l'utilisateur (bouton
    // « Actualiser » de la vue Événements) — sans lui, ce bouton relèverait les journées de la semaine
    // sans jamais revérifier les films à venir, donc sans pouvoir découvrir une avant-première annoncée
    // depuis. Jamais déclenché par un chargement automatique.
    const syncUpcomingEvents = async ({ force = false } = {}) => {
        if (syncing.value) return;

        const today = isoDay(0);
        const horizon = isoDay(SEANCES_HORIZON_DAYS - 1);
        const releaseMax = isoDay(RELEASE_LOOKAHEAD_DAYS);

        const candidates = movies.value.filter(m =>
            m.media === 'cinema'
            && CHECKABLE_STATES.includes(m.state)
            && m.release_date
            // Strictement à venir : les films sortis sont l'affaire de `useInTheatersSync`.
            && m.release_date > today
            && m.release_date <= releaseMax
            && (force || needsCheck(m))
        );
        if (!candidates.length) return;

        syncing.value = true;
        try {
            await resolveAllocineIds(candidates);

            // `resolveAllocineIds` réassigne `movies.value` : on relit les lignes à jour plutôt que les
            // copies capturées au-dessus, sans quoi un identifiant tout juste résolu serait ignoré
            // jusqu'à la semaine prochaine.
            const byId = new Map(movies.value.map(m => [m.id, m]));
            const checkable = candidates.map(m => byId.get(m.id)).filter(m => m?.allocine_id);
            if (!checkable.length) return;

            // Une requête par film : la journée d'aujourd'hui, dont on ne veut que le `nextDate`.
            await loadShowtimes(checkable, today);

            // Films dont la première séance parisienne tombe dans l'horizon **et** avant leur sortie.
            const withPreviews = checkable.filter((movie) => {
                const next = String(livePayloadFor(movie, today)?.nextDate ?? '').slice(0, 10);
                return isPreviewDate(next, movie, horizon);
            });

            // Les films à venir sans avant-première sortent du cache mémoire : ce sont le gros du lot,
            // et plus rien ne les lira de la visite. Le L2 les garde — c'est là qu'ils sont utiles.
            const found = new Set(withPreviews.map(m => m.id));
            forget(
                checkable.filter(m => !found.has(m.id)).map(m => m.allocine_id),
                today,
            );

            // Toutes les journées d'avant-première de chaque film. Le résultat est regroupé **par
            // date** : deux films peuvent partager la même, et `loadEvents` interroge des salles pour
            // une journée donnée — les grouper évite de demander deux fois les mêmes salles.
            const byDate = new Map();
            for (const movie of withPreviews) {
                for (const date of await previewDays(movie, today, horizon)) {
                    if (!byDate.has(date)) byDate.set(date, []);
                    byDate.get(date).push(movie);
                }
            }

            for (const [date, films] of byDate) {
                // La passe salle pour le libellé exact quand elle l'a. Son silence ne coûte rien : le
                // repli plus bas nomme l'événement à partir des dates.
                await loadEvents(films, date);
                await syncEvents(films, [date]);
            }

            // Repli : une séance antérieure à la sortie **est** une avant-première, même si la passe
            // salle n'a rien vu ce jour-là. Sans lui, la rubrique dépendrait du creux de l'endpoint par
            // salle et resterait vide la plupart du temps — alors que la date, elle, est certaine.
            await stampDerivedPreviews(byDate, today);

            // Et pour tout le reste : on horodate quand même, c'est le gate de la semaine prochaine.
            const untouched = checkable.filter(m => !found.has(m.id));
            if (untouched.length) await syncEvents(untouched, [today], { stamp: true });
        } finally {
            syncing.value = false;
        }
    };

    // Une date antérieure à la sortie et dans l'horizon : c'est une avant-première, par définition.
    const isPreviewDate = (date, movie, horizon) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= horizon && date < movie.release_date;

    // Journées d'avant-première d'un film : de la première séance repérée (`nextDate` d'aujourd'hui)
    // jusqu'à la veille de sa sortie, bornées par l'horizon et par `MAX_PREVIEW_DAYS`.
    const previewDays = async (movie, today, horizon) => {
        const first = String(livePayloadFor(movie, today)?.nextDate ?? '').slice(0, 10);
        if (!isPreviewDate(first, movie, horizon)) return [];

        const days = [];
        for (let i = 0; i < MAX_PREVIEW_DAYS; i++) {
            const date = addDays(first, i);
            // Sortie atteinte (ou horizon dépassé) : au-delà ce ne sont plus des avant-premières, ce
            // sont les séances normales du film — l'affaire de `useInTheatersSync` la semaine suivante.
            if (!isPreviewDate(date, movie, horizon)) break;

            await loadShowtimes([movie], date);
            // Salles intra-muros ce jour-là : `nextDate` est calculé sur Paris **et sa couronne** (cf.
            // `PARIS_LOCALIZATION`), il peut donc désigner un jour où le film ne joue qu'en banlieue.
            // Et les journées suivantes, elles, sont de simples suppositions — la plupart seront vides.
            if (livePayloadFor(movie, date)?.theaters?.length) days.push(date);
        }
        return days;
    };

    // Écrit « Avant-première » pour les films dont la journée repérée n'a rendu aucun libellé. On
    // n'invente pas un événement : on nomme celui que la date démontre.
    const stampDerivedPreviews = async (byDate, today) => {
        const bounds = { freshSince: lastWednesday(), today };
        // Accumulé puis écrit en une fois, comme partout ailleurs dans le projet : une requête par film
        // dans une boucle était le seul endroit à ne pas grouper.
        const patches = new Map();

        for (const [date, films] of byDate) {
            // ⚠️ Relu **à chaque tour** et non capturé avant la boucle : les entrées s'accumulent d'une
            // journée à l'autre, et travailler sur un état d'avant l'écriture précédente ferait perdre
            // celle-ci. Le film n'aurait gardé que sa dernière journée d'avant-première.
            const byId = new Map(movies.value.map(m => [m.id, { ...m, ...(patches.get(m.id) ?? {}) }]));

            for (const film of films) {
                const movie = byId.get(film.id);
                if (!movie || movieEvents(movie, bounds).some(e => e.date === date)) continue;

                const payload = livePayloadFor(movie, date);
                // Aucune salle intra-muros ce jour-là : `nextDate` désignait la couronne. Rien à annoncer.
                const theaters = (payload?.theaters ?? []).filter(t => t.name);
                if (!theaters.length) continue;

                patches.set(movie.id, {
                    events: mergeEventEntries(
                        movieEvents(movie, bounds),
                        theaters.map(t => ({
                            date,
                            cinema: t.name,
                            labels: ['Avant-première'],
                            bookings: bookingsOf(t.showtimes ?? []),
                        })),
                        { dates: [date], today },
                    ),
                    events_checked_at: new Date().toISOString(),
                });
            }
        }

        if (patches.size) await writeEntries(patches);
    };

    const client = useSupabaseClient();

    // Regroupées par lot d'entrées identiques : plusieurs films partagent souvent la même journée et
    // la même salle, donc le même lot. Une requête par lot au lieu d'une par film.
    const writeEntries = async (patches) => {
        const byPayload = new Map();
        for (const [id, patch] of patches) {
            const key = entriesKey(patch.events);
            if (!byPayload.has(key)) byPayload.set(key, { patch, ids: [] });
            byPayload.get(key).ids.push(id);
        }

        const applied = new Map();
        for (const { patch, ids } of byPayload.values()) {
            const { error } = await client.from('calendar').update(patch).in('id', ids);
            if (error) {
                if (!isMissingSchema(error)) {
                    console.error('[événements] Avant-première non écrite:', error.message);
                }
                continue;
            }
            for (const id of ids) applied.set(id, patch);
        }

        if (!applied.size) return;
        movies.value = movies.value.map(m => {
            const patch = applied.get(m.id);
            return patch ? { ...m, ...patch } : m;
        });
    };

    return { syncing, syncUpcomingEvents };
}
