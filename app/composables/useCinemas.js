// Le référentiel des salles : lecture, favoris, et le signalement des salles absentes d'Allociné.
//
// Alimenté à la marge par `/api/allocine/refresh`, qui y fait entrer toute salle croisée dans une
// réponse (`on conflict do nothing` : une ligne connue n'est jamais réécrite). Le gros du contenu
// vient des scripts — seed carte UGC, géocodage, temps de trajet.
//
// ⚠️ **Les favoris ne sont plus une colonne de `cinemas`.** Ils vivent dans `cinema_favorites`,
// par utilisateur (`2609221214`). La raison est simple : `cinemas` est un référentiel **partagé**,
// donc une étoile posée par un compte remontait les mêmes salles en tête de la vue de tous les
// autres — sans erreur, sans signal, juste un tri qui bouge tout seul chez le voisin.
//
// Ce que la vue consomme ne change pas pour autant : chaque salle porte toujours un booléen
// `favorite`, simplement calculé à la lecture plutôt que lu en colonne. C'est ce qui permet à
// `seancesGrouping`, `SideNav` et `SeanceGroup` de rester inchangés.

// Salles que le dernier contrôle a trouvées absentes d'Allociné : on se tait si le contrôle n'a pas
// tourné depuis une semaine. Mieux vaut ne rien dire qu'un avertissement périmé sur une salle qui a
// peut-être reparlé depuis.
const SILENCE_NOTICE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function useCinemas() {
    const client = useSupabaseClient();
    const user = useSupabaseUser();

    // Référentiel, chargé une fois par visite : il ne bouge qu'au rythme du seed carte et des scripts.
    const cinemas = useState('seancesCinemas', () => null);

    // ⚠️ La garde vit sur la requête **en vol**, pas sur son résultat : `cinemas.value` n'est
    // affecté qu'après l'`await`, donc deux appelants partis sur le même tick liraient la table en
    // double. Le rail gauche et la page Séances se montent justement ensemble.
    //
    // Sur `nuxtApp` et non un `useState` (une promesse ne se sérialise pas dans le payload SSR) ni
    // une variable de module (partagée entre requêtes SSR concurrentes, donc entre visiteurs).
    const nuxtApp = useNuxtApp();
    const INFLIGHT = '$seancesCinemasInflight';

    // Les codes épinglés par **l'utilisateur courant**. RLS ne rend que ses lignes, le `select` n'a
    // donc pas besoin de filtre — c'est la policy qui tranche (`2609221214`).
    //
    // Dégrade en ensemble vide plutôt qu'en échec : la table peut manquer si la migration n'a pas
    // été jouée, et une vue sans étoiles reste une vue juste, là qu'un écran blanc ne l'est pas.
    const fetchFavorites = async () => {
        if (!user.value) return new Set();

        const { data, error: dbError } = await client.from('cinema_favorites').select('code');

        if (dbError) {
            if (isMissingSchema(dbError)) {
                console.warn('[seances] Table `cinema_favorites` absente — joue _ressources/sql/2609221214-per-user-cinema-favorites.sql pour activer les cinémas favoris.');
            } else {
                console.error('Favoris illisibles:', dbError.message);
            }
            return new Set();
        }

        return new Set((data ?? []).map(row => row.code));
    };

    const fetchCinemas = async () => {
        // `lat` / `lng` servent l'itinéraire (cf. `utils/maps.js`) : une salle géocodée s'ouvre sur
        // ses coordonnées exactes plutôt que sur une adresse Allociné approximative.
        const COLUMNS = 'code, name, arrondissement, accepts_ugc, transit_minutes, lat, lng';
        const SILENCE = 'allocine_silent_since, allocine_checked_at';

        // Les deux lectures sont indépendantes : les lancer en parallèle évite d'ajouter un
        // aller-retour au montage de la vue.
        const [favorites, referential] = await Promise.all([
            fetchFavorites(),
            client.from('cinemas').select(`${COLUMNS}, ${SILENCE}`),
        ]);

        let { data, error: dbError } = referential;

        // Repli si une colonne récente n'existe pas encore en base : le code peut être déployé avant
        // que la migration soit jouée, et sans ce filet **tout** le référentiel devient illisible —
        // donc plus d'`accepts_ugc`, donc une page vide alors que le pré-filtre carte est actif par
        // défaut. Une salle sans favori ni signalement vaut mieux qu'un écran blanc.
        if (isMissingSchema(dbError)) {
            console.warn('[seances] Colonnes de silence absentes — joue _ressources/sql/2608131800-add-cinema-silence.sql pour signaler les salles absentes d\'Allociné.');
            ({ data, error: dbError } = await client.from('cinemas').select(COLUMNS));
        }

        if (dbError) {
            console.error('Référentiel cinemas illisible:', dbError.message);
            cinemas.value = {};
            return;
        }

        // `favorite` est reconstitué ici, et c'est le seul endroit où la jointure se fait. Le reste
        // de la vue continue de lire `cinema.favorite` sans savoir d'où il vient.
        cinemas.value = Object.fromEntries(
            (data ?? []).map(c => [c.code, { ...c, favorite: favorites.has(c.code) }]),
        );
    };

    const loadCinemas = () => {
        if (cinemas.value) return Promise.resolve();
        nuxtApp[INFLIGHT] ??= fetchCinemas().finally(() => { nuxtApp[INFLIGHT] = null; });
        return nuxtApp[INFLIGHT];
    };

    // Relit le référentiel malgré le cache de session. Il bouge rarement, mais pas jamais : une
    // étoile posée sur un autre appareil, une salle nouvellement géocodée, ou surtout un signalement
    // d'absence écrit par `check-seances.mjs` pendant que la page est ouverte — sans relecture,
    // l'avertissement n'apparaîtrait qu'au prochain rechargement complet.
    const refreshCinemas = async () => {
        // Garde vidée d'abord : sinon un rafraîchissement demandé pendant un chargement se
        // contenterait d'attendre celui-ci et ne relirait rien.
        nuxtApp[INFLIGHT] = null;
        cinemas.value = null;
        await loadCinemas();
    };

    // Épingle / désépingle une salle. Bascule optimiste : le tri se réordonne immédiatement, et on
    // revient en arrière si l'écriture échoue — sur un simple clic d'étoile, attendre l'aller-retour
    // réseau pour voir la carte bouger serait pénible.
    //
    // ⚠️ Une **insertion** ou une **suppression** de ligne, plus une bascule de booléen : un favori
    // existe ou n'existe pas, il n'a pas d'état. C'est pour ça que `cinema_favorites` n'a pas de
    // policy `update` — un droit qu'aucun code n'exerce est un droit qu'on ne donne pas.
    const toggleFavorite = async (code) => {
        const current = cinemas.value?.[code];
        if (!current) return;

        // Sans session, l'écriture partirait pour être refusée par RLS. Autant ne pas bouger l'état
        // local : une étoile qui s'allume puis s'éteint toute seule est pire que rien.
        if (!user.value) return;

        const next = !current.favorite;
        cinemas.value = { ...cinemas.value, [code]: { ...current, favorite: next } };

        const { error: dbError } = next
            ? await client.from('cinema_favorites').insert({ user_id: user.value.id, code })
            : await client.from('cinema_favorites').delete().eq('code', code);

        if (dbError) {
            console.error('Bascule favori échouée pour', code, dbError.message);
            cinemas.value = { ...cinemas.value, [code]: { ...current } };
        }
    };

    // Salles que le dernier contrôle a trouvées **absentes d'Allociné** (cf. `check-seances.mjs`).
    // Leurs séances existent peut-être — elles ne sont simplement pas dans la source. Une salle qui
    // manque ne fait aucun bruit dans la vue : sans ce signalement, l'absence se lit comme « ce
    // cinéma ne joue rien », ce qui est faux et détruit la confiance dans tout le reste.
    const silentCinemas = computed(() => {
        const fresh = Date.now() - SILENCE_NOTICE_MAX_AGE;
        return Object.values(cinemas.value ?? {})
            .filter(c => c.allocine_silent_since
                && c.accepts_ugc
                && Date.parse(c.allocine_checked_at) > fresh)
            .map(c => ({ name: c.name, since: c.allocine_silent_since }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    });

    return { cinemas, loadCinemas, refreshCinemas, toggleFavorite, silentCinemas };
}
