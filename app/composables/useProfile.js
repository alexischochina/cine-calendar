// Le profil de l'utilisateur connecté : sa ville, et si son compte est approuvé.
//
// Deux consommateurs, très différents :
//   - `app/middleware/auth.js` s'en sert pour renvoyer un compte non approuvé sur `/pending` ;
//   - la vue Séances s'en sert pour savoir quoi **afficher** — le filtre carte UGC, le temps de
//     trajet et le regroupement par arrondissement n'ont de sens qu'à Paris.
//
// ⚠️ Ce composable ne garde rien. Ce qu'il rend sert à l'affichage et au confort de navigation ; les
// vraies serrures sont RLS (la donnée) et `server/utils/requireUser.js` (les routes qui sortent sur
// le réseau). Un utilisateur qui forcerait `isApproved` dans sa console ne gagnerait qu'un écran
// vide — c'est exactement ce qu'on veut, et c'est pour ça que la garde ne vit pas ici.
//
// Structure calquée sur `useCinemas`, volontairement, jusqu'aux commentaires : même besoin (une
// lecture par visite, partagée entre le layout et les pages), donc mêmes pièges.

export function useProfile() {
    const client = useSupabaseClient();
    const user = useSupabaseUser();

    const profile = useState('userProfile', () => null);

    // L'échec de lecture vit à part du profil, et non dedans : le profil sert de drapeau « déjà
    // chargé » à `loadProfile`, donc y ranger une erreur la rendrait définitive (cf. `fetchProfile`).
    const unavailable = useState('userProfileUnavailable', () => false);

    // ⚠️ La garde vit sur la requête **en vol**, pas sur son résultat : `profile.value` n'est
    // affecté qu'après l'`await`, donc deux appelants partis sur le même tick liraient la table en
    // double. Le middleware et le montage de la vue Séances se déclenchent justement ensemble.
    //
    // Sur `nuxtApp` et non un `useState` (une promesse ne se sérialise pas dans le payload SSR) ni
    // une variable de module. Ce dernier point n'était qu'une précaution tant qu'il n'y avait qu'un
    // compte ; à deux, une variable de module partagée entre requêtes SSR concurrentes servirait le
    // profil d'un visiteur à un autre.
    const nuxtApp = useNuxtApp();
    const INFLIGHT = '$userProfileInflight';

    const fetchProfile = async () => {
        // Pas de session : rien à lire, et surtout pas de requête à lancer. RLS rendrait zéro ligne,
        // mais l'aller-retour serait payé quand même — sur `/login` et `/register`, qui n'ont aucune
        // raison d'interroger la base.
        if (!user.value) {
            profile.value = null;
            return;
        }

        // Pas de `.eq('user_id', …)` : la policy `profiles: lecture de son profil` ne rend que la
        // ligne de l'appelant, donc `maybeSingle` est exact. Ajouter le filtre suggérerait que c'est
        // lui qui protège, alors que c'est RLS.
        const { data, error } = await client.from('profiles').select('city, approved').maybeSingle();

        if (error) {
            // ⚠️ Repli **fermé** : profil illisible → traité comme non approuvé, comme dans
            // `requireUser`. Une garde d'affichage qui s'ouvre sur une erreur de lecture enverrait
            // l'utilisateur sur une timeline vide sans lui dire pourquoi. Là, il voit `/pending`,
            // qui est au moins un message.
            if (isMissingSchema(error)) {
                console.warn('[auth] Table `profiles` absente — joue _ressources/sql/2609221212-add-profiles.sql.');
            } else {
                console.error('Profil illisible:', error.message);
            }

            // ⚠️ **L'échec n'est pas mis en cache.** `loadProfile` court-circuite sur
            // `profile.value` truthy : y ranger l'état d'erreur épinglerait l'utilisateur sur
            // `/pending` pour toute la visite après un simple hoquet réseau, et seul un geste qu'il
            // doit deviner (« J'ai été validé ») l'en sortirait. On laisse `null` pour que la
            // tentative suivante reparte, et on porte l'échec à part.
            profile.value = null;
            unavailable.value = true;
            return;
        }

        unavailable.value = false;

        // Profil absent = compte créé hors du parcours d'inscription (directement dans le dashboard,
        // par exemple). Non approuvé, pour la même raison que côté serveur : une garde qui s'ouvre
        // sur une donnée manquante n'est pas une garde.
        profile.value = data ?? { city: null, approved: false, missing: true };
    };

    const loadProfile = () => {
        if (profile.value) return Promise.resolve();
        nuxtApp[INFLIGHT] ??= fetchProfile().finally(() => { nuxtApp[INFLIGHT] = null; });
        return nuxtApp[INFLIGHT];
    };

    // Relit malgré le cache de visite. Sert après une approbation : Alexis bascule le drapeau dans
    // le dashboard, et son père n'a plus qu'à recharger `/pending` au lieu de se reconnecter.
    const refreshProfile = async () => {
        // Garde vidée d'abord : sinon un rafraîchissement demandé pendant un chargement se
        // contenterait d'attendre celui-ci et ne relirait rien.
        nuxtApp[INFLIGHT] = null;
        profile.value = null;
        unavailable.value = false;
        await loadProfile();
    };

    // ⚠️⚠️ **Lire la ville avant d'avoir chargé le profil rend Paris, en silence.**
    //
    // C'est le mode d'échec le plus dangereux de ce composable : `cityConfig(undefined)` replie sur
    // la ville par défaut, donc un compte troyen se verrait servir la localisation Allociné, la
    // partition de cache et les libellés parisiens — sans la moindre erreur.
    //
    // Cinq consommateurs lisent `cityInfo` sans jamais appeler `loadProfile` (`useSeances`,
    // `SideNav`, `ViewTabs`, `/seances`, `/evenements`) : ils reposent sur le fait que
    // `middleware/auth.js` a tourné avant eux. C'est vrai aujourd'hui pour toutes les pages
    // concernées, et ce contrat n'était écrit nulle part — donc invérifiable et facile à rompre en
    // ajoutant une page.
    //
    // On ne peut pas charger à la volée ici (un `computed` est synchrone), et lever casserait le
    // rendu. On rend donc le manquement **bruyant** : le repli reste le même, mais il s'annonce au
    // lieu de se taire. Une fois par visite, pas une fois par lecture — sinon le rail et la vue
    // Séances en produiraient des dizaines.
    const warnedMissing = useState('userProfileWarned', () => false);

    const requireLoaded = () => {
        if (import.meta.client && user.value && !profile.value && !unavailable.value && !warnedMissing.value) {
            warnedMissing.value = true;
            console.warn(
                '[auth] Ville lue avant le chargement du profil — repli sur « %s ». '
                + 'La page concernée doit porter le middleware `auth`, ou appeler `loadProfile()`.',
                DEFAULT_CITY,
            );
        }
    };

    // `cityOf` et non `profile.city` brut : la ville voyage jusqu'à des index de configuration
    // (`CITIES[city]`), et une valeur absente y rendrait `undefined`. Le repli sur Paris est celui
    // décrit dans `shared/utils/cities.js`.
    const city = computed(() => { requireLoaded(); return cityOf(profile.value?.city); });
    const cityInfo = computed(() => { requireLoaded(); return cityConfig(profile.value?.city); });
    const isApproved = computed(() => profile.value?.approved === true);

    return { profile, unavailable, city, cityInfo, isApproved, loadProfile, refreshProfile };
}
