// « En salle » : l'état vient d'Allociné, plus d'une règle de date.
//
// Avant, `applyAutoInTheaters` (useMovieCalendar) flaggeait tout film cinéma sorti dans l'année en
// cours et le flag ne retombait jamais : un film de janvier restait « en salle » en décembre, dans
// le rail « Au ciné en ce moment » comme dans la vue Séances, sans la moindre séance à afficher
// (limite assumée et documentée à l'époque — « `state === 'inTheaters'` est collant »). Le contrôle
// ci-dessous tranche sur la seule question qui vaille : *ce film a-t-il une séance à Paris dans les
// 7 jours qui viennent ?*
//
// Rythme : une fois par semaine ciné, en tâche de fond au chargement de l'app. Le gate est le
// mercredi (renouvellement des grilles) et non « il y a 7 jours », exactement comme la fraîcheur du
// cache de séances — un contrôle du mardi soir n'a plus rien à dire de la grille du mercredi matin.
//
// Coût : la lecture groupée du cache d'abord, un rafraîchissement par film manquant ensuite. Si la
// vue Séances a déjà été ouverte aujourd'hui, le contrôle ne sort pas du tout sur le réseau — et
// inversement, il préchauffe la vue.

// Les autres états sont des décisions de l'utilisateur (« vu », « téléchargeable ») : le contrôle
// n'a pas à les défaire.
const CHECKABLE_STATES = ['unseen', 'inTheaters'];

// Les verdicts (`playingWithin`, `horizonVerdict`) vivent dans `app/utils/inTheaters.js` : ce sont des
// fonctions pures, et leurs erreurs sont silencieuses — elles méritaient d'être testables sans monter
// Nuxt. Auto-importées ici.

export function useInTheatersSync() {
    const client = useSupabaseClient();
    const { movies, sortMovies } = useMovieCalendar();
    const { resolveAllocineIds, loadShowtimes, payloadFor, forget } = useShowtimes();
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

        // Tout film cinéma non vu et déjà sorti, **sans borne d'ancienneté**. Une première version
        // ne reprenait que les sorties de moins de 120 jours ; elle ratait exactement le cas qui
        // justifie ce contrôle — le film de février qu'une salle art et essai reprogramme une
        // semaine en août. Le volume mesuré donne raison à la version large : 91 films dans la
        // liste au 13/08/2026, soit ~13 requêtes par jour, contre 12 films pour la borne à 120 j.
        // Un cache de séances déjà chaud les ramène à zéro. Et l'ouverture est un gain en soi : une
        // ressortie en copie restaurée remonte d'elle-même dans « Au ciné en ce moment ».
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
                const verdict = playingWithin(payloadFor(movie, todayStr), horizon);
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
            // sans que l'utilisateur ait à ouvrir la vue Séances — c'est le badge qui doit l'y envoyer,
            // pas l'inverse.
            //
            // Coût : ~25 salles interrogées, **une fois par semaine ciné**. C'est la seule dépense
            // ajoutée au chargement de l'app, et elle préchauffe la vue Séances pour aujourd'hui.
            // Seuls les films gardés sont concernés : les autres viennent de sortir du L1 juste
            // au-dessus, donc `loadEvents` ne demandera aucune de leurs salles.
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
                    // Allociné à chaque ouverture de l'app.
                    if (error.code === '42703') {
                        disabled.value = true;
                        console.warn('[en salle] Colonne `in_theaters_checked_at` absente — joue _ressources/sql/2608131000-add-in-theaters-check.sql pour activer le contrôle hebdomadaire.');
                        return;
                    }
                    console.error('[en salle] Mise à jour échouée:', error.message);
                    continue;
                }
                for (const id of ids) applied.set(id, patch);
            }

            // Ménage du cache durable, ici parce que c'est le seul endroit qui passe une fois par
            // semaine et pas à chaque chargement. Le contrôle écrit ~91 entrées par passage là où
            // la vue seule en écrivait ~14 : sans ce coup de balai, `showtimes_cache` gagnerait des
            // dizaines de Mo par an pour des journées révolues que plus rien ne lira jamais (la vue
            // ne regarde que J → J+6).
            // Les deux caches de journée sont balayés ici, sur le même critère : ils vieillissent au
            // même rythme et plus rien ne relit une journée révolue. `theater_events_cache` est le plus
            // petit des deux (seules les séances événement y sont stockées, ~0 à 1 par salle) mais il
            // gagne ~25 lignes par jour consulté — autant ne pas laisser deux règles divergentes.
            for (const [table, what] of [['showtimes_cache', 'séances'], ['theater_events_cache', 'événements']]) {
                const { error: pruneError } = await client.from(table).delete().lt('date', todayStr);
                // Table absente (migration pas jouée) : rien à balayer, et `useTheaterEvents` l'a déjà
                // signalé une fois. Inutile de le redire à chaque passage hebdomadaire. ⚠️ Le code peut
                // être `PGRST205` et non `42P01` — PostgREST tranche sur son cache de schéma.
                if (pruneError && !['42P01', 'PGRST205'].includes(pruneError.code)) {
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

    // Retire de l'affiche un film dont **l'horizon entier** est vide, sans attendre le mercredi.
    //
    // Pourquoi ça manquait. Le contrôle ci-dessus ne tourne qu'une fois par semaine ciné : un film qui
    // quitte l'affiche le jeudi reste dans le rail jusqu'au mercredi suivant, avec zéro séance à
    // montrer. Constaté le 14/08/2026 sur *Silent Friend*, *Plus fort que moi* et *The Plague*, tous
    // trois contrôlés — et légitimement gardés — le 12/08 à 23:10, donc après le mercredi.
    //
    // Or la preuve de leur départ était **déjà en cache** : les sept journées chargées, zéro salle
    // intra-muros partout. Cette fonction ne fait que lire ce qu'on a déjà payé. Aucune requête.
    //
    // ⚠️ Elle ne conclut que sur des preuves complètes, et c'est tout l'enjeu — un verdict trop
    // pressé retirerait un film sur un hoquet réseau, et il ne reviendrait qu'une semaine plus tard :
    //   - **toutes** les journées de l'horizon doivent être en cache (une seule manquante → on se tait) ;
    //   - aucune ne doit être en échec (`error`) ni servie depuis du périmé (`stale`) ;
    //   - les salles reportées (`unconfirmedSince`) ne comptent pas — elles témoignent du passé ;
    //   - un `nextDate` **dans** l'horizon suffit à garder le film.
    const pruneEmptyHorizon = async (list, dates) => {
        if (disabled.value || dates.length < SEANCES_HORIZON_DAYS) return;

        const horizon = isoDay(SEANCES_HORIZON_DAYS - 1);
        const current = new Map(movies.value.map(m => [m.id, m]));

        const candidates = list
            .map(({ id }) => current.get(id))
            .filter(m => m?.state === 'inTheaters' && m.allocine_id)
            .map(movie => ({ movie, payloads: dates.map(date => payloadFor(movie, date)) }));

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
            if (error.code === '42703' || error.code === 'PGRST204') { disabled.value = true; return; }
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
