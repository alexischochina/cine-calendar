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

// Trois issues et pas deux : `null` = « on ne sait pas ». Le confondre avec « plus à l'affiche »
// retirerait un film du rail sur un simple hoquet réseau, et il n'y reviendrait qu'une semaine plus
// tard — la panne d'un jour se paierait sept.
const playingWithin = (payload, horizon) => {
    if (!payload || payload.error) return null;

    // ⚠️ Les salles reportées (`unconfirmedSince`, cf. `carryOverMissing`) ne comptent pas : elles
    // témoignent du passé, pas de l'affiche. Les prendre pour argent comptant maintiendrait un film
    // « en salle » 48 h de plus après sa déprogrammation — exactement le défaut collant qu'on a
    // corrigé. Elles restent visibles dans la vue, marquées ; elles ne décident de rien.
    if (payload.theaters?.some(t => !t.unconfirmedSince)) return true;
    // Aucune séance aujourd'hui **et** horaires servis depuis une entrée périmée : c'est le cas où
    // le vide n'est pas une information.
    if (payload.stale) return null;

    // Allociné livre `nextDate` quand il n'y a rien ce jour-là : un film qui ne joue que le week-end
    // (ou qui ressort mercredi) est bien en salle cette semaine.
    const next = String(payload.nextDate ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) return next <= horizon;
    return false;
};

export function useInTheatersSync() {
    const client = useSupabaseClient();
    const { movies, sortMovies } = useMovieCalendar();
    const { resolveAllocineIds, loadShowtimes, payloadFor, forget } = useShowtimes();

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
            const { error: pruneError } = await client.from('showtimes_cache').delete().lt('date', todayStr);
            if (pruneError) console.error('[en salle] Ménage du cache de séances échoué:', pruneError.message);

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

    return { syncing, syncInTheaters };
}
