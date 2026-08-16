// « En salle » : l'état vient d'Allociné, plus d'une règle de date. L'ancienne règle flaggeait tout
// film cinéma sorti dans l'année et ne retombait jamais — un film de janvier restait « en salle » en
// décembre, sans une séance à montrer. Le contrôle tranche sur la seule question qui vaille : *ce film
// a-t-il une séance à Paris dans les 7 jours qui viennent ?*
//
// Une fois par semaine ciné, en tâche de fond. Le gate est le mercredi (renouvellement des grilles) et
// non « il y a 7 jours », comme la fraîcheur du cache. Si la vue Séances a déjà été ouverte
// aujourd'hui, le contrôle ne sort pas du tout sur le réseau — et inversement, il la préchauffe.
//
// Les verdicts (`playingWithin`, `horizonVerdict`) sont dans `app/utils/inTheaters.js`, testés.

// Les autres états sont des décisions de l'utilisateur : le contrôle n'a pas à les défaire.
const CHECKABLE_STATES = ['unseen', 'inTheaters'];

export function useInTheatersSync() {
    const client = useSupabaseClient();
    const { movies, sortMovies } = useMovieCalendar();
    // ⚠️ `livePayloadFor` dans tout ce fichier : il retire des films de l'affiche sur la foi de ce
    // qu'il lit, et rien en aval ne sait se méfier d'une lecture d'hier.
    const { resolveAllocineIds, loadShowtimes, livePayloadFor, forget } = useShowtimes();
    const { loadEvents } = useTheaterEvents();
    const { syncEvents } = useSeanceEvents();

    const syncing = useState('inTheatersSyncing', () => false);
    // Migration pas jouée : on ne réessaie pas à chaque navigation.
    const disabled = useState('inTheatersSyncDisabled', () => false);

    const needsCheck = (movie) => {
        const at = movie.in_theaters_checked_at;
        if (!at) return true;
        const ts = Date.parse(at);
        return !Number.isFinite(ts) || ts < lastWednesday();
    };

    const syncInTheaters = async () => {
        if (syncing.value || disabled.value) return;

        const todayStr = isoDay(0);

        // Tout film cinéma non vu et déjà sorti, **sans borne d'ancienneté** : une borne à 120 jours
        // ratait le cas qui justifie ce contrôle — le film de février qu'une salle art et essai
        // reprogramme une semaine en août. Le volume mesuré lui donne raison (~13 requêtes/jour), et un
        // cache déjà chaud les ramène à zéro.
        const candidates = movies.value.filter(m =>
            m.media === 'cinema'
            && CHECKABLE_STATES.includes(m.state)
            && m.release_date && m.release_date <= todayStr
            && needsCheck(m)
        );
        if (!candidates.length) return;

        syncing.value = true;
        try {
            await resolveAllocineIds(candidates);

            // `resolveAllocineIds` réassigne `movies.value` : on relit les lignes à jour plutôt que
            // les copies capturées au-dessus, sans quoi un identifiant tout juste résolu serait
            // ignoré jusqu'à la prochaine semaine.
            const byId = new Map(movies.value.map(m => [m.id, m]));
            const checkable = candidates.map(m => byId.get(m.id)).filter(m => m?.allocine_id);

            // Un film non rapproché d'une fiche Allociné ne dit rien de son affiche : on le laisse
            // tel quel (et sans horodatage) au lieu de le retirer faute de savoir.
            if (!checkable.length) return;

            await loadShowtimes(checkable, todayStr);

            const horizon = isoDay(SEANCES_HORIZON_DAYS - 1);
            const keep = [];
            const drop = [];
            for (const movie of checkable) {
                // ⚠️ Un relevé de la veille ne porte pas `stale` : `playingWithin` trancherait `false`
                // là où il doit rendre `null`, et ce verdict écrit `unseen` sans corroboration.
                const verdict = playingWithin(livePayloadFor(movie, todayStr), horizon);
                if (verdict === true) keep.push(movie.id);
                else if (verdict === false) drop.push(movie.id);
            }

            // Les films hors affiche sortent du cache mémoire : plus rien ne les lira de la visite,
            // et ce sont eux le gros du lot (~80 sur ~91). Ceux qu'on garde restent en L1 — c'est
            // précisément le préchauffage dont la vue Séances profite juste après.
            forget(
                checkable.filter(m => drop.includes(m.id)).map(m => m.allocine_id),
                todayStr,
            );

            // Séances événement du jour, pour que le rail « Au ciné en ce moment » les mette en avant
            // sans avoir à ouvrir la vue Séances. Coût : ~25 salles, **une fois par semaine ciné**,
            // et ça préchauffe la vue pour aujourd'hui.
            //
            // Placé **avant** les écritures d'état, pour ne pas dépendre de leur sortie anticipée
            // (`if (!applied.size) return`) : une semaine sans changement d'affiche est le cas normal,
            // et c'est justement une semaine où un événement peut apparaître.
            const kept = new Set(keep);
            const withEvents = checkable.filter(m => kept.has(m.id));
            await loadEvents(withEvents, todayStr);
            await syncEvents(withEvents, [todayStr]);

            const checkedAt = new Date().toISOString();
            const applied = new Map();

            // Les deux groupes sont écrits même quand l'état ne change pas : c'est l'horodatage qui
            // porte le « déjà contrôlé cette semaine », sans lui le contrôle repartirait à chaque
            // chargement de l'app.
            for (const [ids, state] of [[keep, 'inTheaters'], [drop, 'unseen']]) {
                if (!ids.length) continue;

                const patch = { state, in_theaters_checked_at: checkedAt };
                const { error } = await client.from('calendar').update(patch).in('id', ids);

                if (error) {
                    // Colonne absente : le code peut être déployé avant que la migration soit jouée.
                    // On n'écrit alors **rien du tout** — appliquer les états sans pouvoir horodater
                    // relancerait le contrôle à chaque chargement, donc une salve de requêtes
                    // Allociné à chaque ouverture de l'app. C'est le garde le plus important du
                    // fichier ; le détail des codes PostgREST vit dans `shared/utils/pgErrors.js`.
                    if (isMissingSchema(error)) {
                        disabled.value = true;
                        console.warn('[en salle] Colonne `in_theaters_checked_at` absente — joue _ressources/sql/2608131000-add-in-theaters-check.sql pour activer le contrôle hebdomadaire.');
                        return;
                    }
                    console.error('[en salle] Mise à jour échouée:', error.message);
                    continue;
                }
                for (const id of ids) applied.set(id, patch);
            }

            // Ménage des deux caches de journée, ici parce que c'est le seul endroit qui passe une
            // fois par semaine. Sans lui, `showtimes_cache` gagnerait des dizaines de Mo par an pour
            // des journées révolues que plus rien ne relira (la vue ne regarde que J → J+6).
            for (const [table, what] of [['showtimes_cache', 'séances'], ['theater_events_cache', 'événements']]) {
                const { error: pruneError } = await client.from(table).delete().lt('date', todayStr);
                // Table absente (migration pas jouée) : rien à balayer, et `useTheaterEvents` l'a déjà
                // signalé une fois. Inutile de le redire à chaque passage hebdomadaire.
                if (pruneError && !isMissingSchema(pruneError)) {
                    console.error(`[en salle] Ménage du cache de ${what} échoué:`, pruneError.message);
                }
            }

            if (!applied.size) return;

            // Un seul réassign puis un seul re-tri : la timeline lit les états via `sortedMovies`.
            const next = movies.value.map(m => {
                const patch = applied.get(m.id);
                return patch ? { ...m, ...patch } : m;
            });
            movies.value = next;
            sortMovies(next);
        } finally {
            syncing.value = false;
        }
    };

    // Retire un film dont **l'horizon entier** est vide, sans attendre le mercredi. Ne coûte aucune
    // requête — la preuve est déjà dans le cache. ⚠️ Ne conclut que sur des preuves complètes (cf.
    // `horizonVerdict`) : un verdict trop pressé retirerait un film sur un hoquet réseau.
    const pruneEmptyHorizon = async (list, dates) => {
        if (disabled.value || dates.length < SEANCES_HORIZON_DAYS) return;

        const horizon = isoDay(SEANCES_HORIZON_DAYS - 1);
        const current = new Map(movies.value.map(m => [m.id, m]));

        const candidates = list
            .map(({ id }) => current.get(id))
            .filter(m => m?.state === 'inTheaters' && m.allocine_id)
            .map(movie => ({ movie, payloads: dates.map(date => livePayloadFor(movie, date)) }));

        // ⚠️ Corroboration avant tout retrait : si **aucun** film du lot ne joue nulle part sur sept
        // jours, ce n'est pas l'affiche parisienne qui est vide, c'est notre lecture qui est fausse.
        // Allociné perd parfois un pan de sa grille (cf. UGC Les Halles le 13/08/2026), et le retrait
        // est plus violent qu'une page vide — le film sort du rail jusqu'au mercredi suivant.
        if (!sourceLooksAlive(candidates.map(c => c.payloads))) return;

        const gone = candidates
            .filter(({ payloads }) => horizonVerdict(payloads, horizon) === 'gone')
            .map(({ movie }) => movie.id);

        if (!gone.length) return;

        const patch = { state: 'unseen', in_theaters_checked_at: new Date().toISOString() };
        const { error } = await client.from('calendar').update(patch).in('id', gone);
        if (error) {
            if (isMissingSchema(error)) { disabled.value = true; return; }
            console.error('[en salle] Retrait sur horizon vide échoué:', error.message);
            return;
        }

        console.warn(`[en salle] ${gone.length} film(s) retiré(s) : aucune séance parisienne sur les 7 jours.`);
        const next = movies.value.map(m => (gone.includes(m.id) ? { ...m, ...patch } : m));
        movies.value = next;
        sortMovies(next);
    };

    return { syncing, syncInTheaters, pruneEmptyHorizon };
}
