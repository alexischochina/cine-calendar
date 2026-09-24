// Les listes des autres comptes. Mode d'emploi : `_ressources/README-listes-partagees.md`.
//
// ⚠️⚠️ **CE COMPOSABLE NE FAIT QUE LIRE.** Les policies d'écriture de `calendar` restent cloisonnées :
// un `update` sur la ligne d'un autre ne lève pas, il touche **zéro ligne**. Tout rattrapage écrit ici
// (filet des métadonnées manquantes, promotion « en salle », revérif TMDB, notes Letterboxd)
// réessaierait à chaque visite, indéfiniment, en croyant réussir. Le seul geste qui écrit est
// `useMovieCalendar.addFromSharedList` — sur ma ligne, pas sur la sienne.
//
// Structure calquée sur `useProfile` / `useCinemas` : même besoin, donc mêmes pièges.

export function useSharedLists() {
    const client = useSupabaseClient();
    const user = useSupabaseUser();
    const { movies } = useMovieCalendar();

    // `null` = pas encore chargé, `[]` = personne ne partage. La page ne rend 404 sur un slug inconnu
    // qu'une fois le chargement fait, d'où la distinction.
    const sharedProfiles = useState('sharedProfiles', () => null);

    // Les listes lues **en entier**, à l'ouverture d'un onglet seulement. Mémoïsées par `user_id`.
    const sharedRows = useState('sharedListRows', () => ({}));

    // Les seuls `movie_id`, pour le compteur de l'onglet. ⚠️ Un état distinct, et c'est tout
    // l'intérêt : le badge a besoin de toute la liste dès le démarrage, mais d'une seule colonne.
    const sharedIds = useState('sharedListIds', () => ({}));

    // La bascule « Seulement ceux que je n'ai pas ». ⚠️ Indexée par `user_id` : globale, elle restait
    // cochée en passant d'une liste à l'autre — un réglage invisible qui vide une liste se lit comme
    // un bug.
    const onlyMissingBy = useState('sharedOnlyMissing', () => ({}));

    const onlyMissingFor = (userId) => !!onlyMissingBy.value[userId];
    const toggleOnlyMissing = (userId) => {
        onlyMissingBy.value = { ...onlyMissingBy.value, [userId]: !onlyMissingBy.value[userId] };
    };

    // Le regroupement de la liste affichée, posé par la page et lu par le layout pour le rail des
    // années. ⚠️ Deux calculs, ce serait un rail qui annonce des années que la vue ne montre pas.
    const sharedGrouped = useState('sharedGrouped', () => null);

    // La notice « ajouté à ta liste » : posée ici, rendue et expirée par le layout, comme
    // `catchupNotice`.
    const sharedNotice = useState('sharedNotice', () => null);

    // ⚠️ Les gardes vivent sur les requêtes **en vol**, pas sur leur résultat : la valeur n'est
    // affectée qu'après l'`await`, donc deux appelants partis sur le même tick liraient deux fois. Le
    // rail et la page se montent justement ensemble. Sur `nuxtApp` — une promesse ne se sérialise pas
    // dans le payload SSR, et une variable de module serait partagée entre visiteurs.
    const nuxtApp = useNuxtApp();
    const PROFILES_INFLIGHT = '$sharedProfilesInflight';
    const ROWS_INFLIGHT = '$sharedListInflight';
    const IDS_INFLIGHT = '$sharedListIdsInflight';

    const decorate = (profile) => ({
        ...profile,
        slug: listSlug(profile.display_name),
        initial: listInitial(profile.display_name),
    });

    const fetchProfiles = async () => {
        const userId = userIdOf(user.value);
        if (!userId) {
            sharedProfiles.value = [];
            return;
        }

        // `.neq` : ma ligne remonte forcément, et je n'ai pas à m'offrir un onglet vers ma timeline.
        const { data, error } = await client
            .from('profiles')
            .select('user_id, display_name, city')
            .not('display_name', 'is', null)
            .neq('user_id', userId)
            .order('display_name');

        if (error) {
            // ⚠️ Dégradation silencieuse et voulue : sans la migration, la colonne n'existe pas et
            // l'application doit tourner comme avant. C'est ce qui permet de déployer le code avant
            // de jouer le SQL.
            if (isMissingSchema(error)) {
                console.warn('[listes] Colonne `profiles.display_name` absente — joue _ressources/sql/2609231743-add-shared-lists.sql pour activer les listes partagées.');
            } else {
                console.error('Profils partagés illisibles:', error.message);
            }
            sharedProfiles.value = [];
            return;
        }

        const profiles = (data ?? []).map(decorate);

        // ⚠️ Deux noms peuvent produire le même slug sans que la base les refuse (son index porte sur
        // `lower`, `listSlug` retire aussi accents et ponctuation). On garde le premier et on le dit :
        // le symptôme sinon serait « un onglet ouvre la liste de l'autre », sans piste.
        const bySlug = new Map();
        for (const profile of profiles) {
            if (bySlug.has(profile.slug)) {
                console.warn(
                    '[listes] Deux comptes produisent le slug « %s » (« %s » et « %s ») — seul le premier est joignable. Renomme l\'un des deux.',
                    profile.slug, bySlug.get(profile.slug).display_name, profile.display_name,
                );
                continue;
            }
            bySlug.set(profile.slug, profile);
        }

        sharedProfiles.value = [...bySlug.values()];
    };

    const loadSharedProfiles = () => {
        if (sharedProfiles.value) return Promise.resolve();
        nuxtApp[PROFILES_INFLIGHT] ??= fetchProfiles().finally(() => { nuxtApp[PROFILES_INFLIGHT] = null; });
        return nuxtApp[PROFILES_INFLIGHT];
    };

    const profileBySlug = (slug) => (sharedProfiles.value ?? []).find(p => p.slug === slug) ?? null;

    const fetchRows = async (userId) => {
        // ⚠️ Colonnes énumérées, jamais `select('*')` : sa liste porte des données qui ne me regardent
        // pas et que rien n'affiche ici (`catchup*`, `in_theaters_checked_at`, `events`, `allocine_id`).
        const { data, error } = await client
            .from('calendar')
            .select('id, movie_id, media, state, title, poster_path, release_date, manual_release_date, director, genres, countries, tmdb_vote, letterboxd_rating, letterboxd_directors')
            .eq('user_id', userId);

        if (error) {
            console.error('Liste partagée illisible:', error.message);
            return [];
        }

        // Même mise en forme que `getMovies` : `release_date` porte la date **effective**, celle qui
        // range. Pas de `_tmdbReleaseDate` — il ne sert qu'à retirer un override, geste impossible ici.
        return (data ?? []).map(row => ({
            ...row,
            release_date: effectiveReleaseDate(row),
        }));
    };

    // Les identifiants seuls : cette lecture part au démarrage pour **tous** les comptes partagés,
    // celle des lignes complètes seulement à l'ouverture d'une liste. Les fusionner rendrait la
    // première aussi chère que la seconde.
    const fetchIds = async (userId) => {
        const { data, error } = await client
            .from('calendar')
            .select('movie_id')
            .eq('user_id', userId);

        if (error) {
            console.error('Compteur de liste partagée illisible:', error.message);
            return [];
        }

        return data ?? [];
    };

    const loadSharedIds = (userId) => {
        if (!userId || sharedIds.value[userId]) return Promise.resolve();
        nuxtApp[IDS_INFLIGHT] ??= {};
        nuxtApp[IDS_INFLIGHT][userId] ??= fetchIds(userId)
            .then((rows) => { sharedIds.value = { ...sharedIds.value, [userId]: rows }; })
            .finally(() => { delete nuxtApp[IDS_INFLIGHT][userId]; });

        return nuxtApp[IDS_INFLIGHT][userId];
    };

    const loadSharedList = (userId) => {
        if (!userId) return Promise.resolve([]);
        if (sharedRows.value[userId]) return Promise.resolve(sharedRows.value[userId]);

        nuxtApp[ROWS_INFLIGHT] ??= {};
        nuxtApp[ROWS_INFLIGHT][userId] ??= fetchRows(userId)
            .then((rows) => {
                sharedRows.value = { ...sharedRows.value, [userId]: rows };
                return rows;
            })
            .finally(() => { delete nuxtApp[ROWS_INFLIGHT][userId]; });

        return nuxtApp[ROWS_INFLIGHT][userId];
    };

    // Précharge de quoi afficher les compteurs. Les échecs ne remontent pas : un compteur absent est
    // un moindre mal, il se remplira à l'ouverture de l'onglet.
    const warmSharedLists = async () => {
        await loadSharedProfiles();
        await Promise.all((sharedProfiles.value ?? []).map(p =>
            loadSharedIds(p.user_id).catch(() => {})
        ));
    };

    const rowsOf = (userId) => sharedRows.value[userId] ?? [];

    // Ce qu'il a et que je n'ai pas. `null` tant qu'on ne peut pas répondre : le rail masque alors le
    // compteur au lieu d'afficher un « 0 » faux.
    //
    // ⚠️ Deux conditions : ses identifiants **et** ma liste. `movies` n'est rempli qu'au `onMounted`
    // du layout, donc en arrivant directement sur `/2026/listes/david` le compteur annoncerait
    // brièvement « tu n'as aucun de ses films ».
    const missingCountFor = (userId) => {
        if (!movies.value.length) return null;
        const source = sharedRows.value[userId] ?? sharedIds.value[userId];
        return source ? missingFrom(source, movies.value).length : null;
    };

    return {
        sharedProfiles,
        sharedGrouped,
        sharedNotice,
        onlyMissingFor,
        toggleOnlyMissing,
        loadSharedProfiles,
        warmSharedLists,
        loadSharedList,
        profileBySlug,
        rowsOf,
        missingCountFor,
    };
}
