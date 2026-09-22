// Vue « Séances » : tout l'état et toute la logique métier de la page.
//
// Point de départ : `seanceFilms`, c'est-à-dire **les deux rubriques du rail réunies** — « Événement à
// venir » puis « Au ciné en ce moment ». La vue et le rail montrent donc rigoureusement la même
// affiche. Pour chaque film on résout un identifiant Allociné (une fois, persisté en base), puis on
// charge ses séances parisiennes du jour sélectionné. Les composants ne font que rendre ce qui sort
// d'ici — aucune logique métier dans les `.vue`.
//
// ⚠️ Certains de ces films ne sont **pas** `inTheaters` : une avant-première a lieu avant la sortie. Se
// limiter à `cinemaNow` les rendait introuvables — le clic depuis le rail ouvrait bien `/seances?film=…`
// mais n'y cadrait ni ne chargeait rien.
//
// La résolution, le chargement d'une journée et le cache L1 vivent dans `useShowtimes`, partagé
// avec le contrôle « en salle » — c'est son en-tête qui décrit les deux niveaux de cache.
// Les filtres (film, plage horaire, carte, regroupement) sont purement dérivés : en changer ne
// déclenche jamais de requête.

// Ce fichier ne garde que ce qui a besoin d'état, de réactivité ou du réseau. Trois voisins portent
// le reste, et chacun est lisible seul :
//   `app/utils/seancesGrouping.js`  filtres, tri, regroupements — fonctions pures, testées ;
//   `useSeanceDays`                 la bande de sept jours et son recalage à minuit ;
//   `useCinemas`                    le référentiel des salles, les favoris, les salles muettes.

export function useSeances() {
    const { seanceFilms } = useMovieCalendar();
    // Les capacités de la ville de l'utilisateur : carte UGC, temps de trajet, arrondissements.
    // Ce ne sont pas des réglages mais des faits — à Troyes, aucune salle n'accepte la carte UGC et
    // le `transit_minutes` du référentiel est calculé depuis un domicile parisien.
    const { cityInfo } = useProfile();
    const {
        payloadFor, livePayloadFor, wireSnapshot,
        resolveAllocineIds, loadShowtimes, forgetDay, forgetBefore,
    } = useShowtimes();
    const { loadEvents } = useTheaterEvents();
    const { syncEvents } = useSeanceEvents();
    const { pruneEmptyHorizon } = useInTheatersSync();
    const { days, dayIndex, selectedDay, rollToToday } = useSeanceDays();
    const { cinemas, loadCinemas, refreshCinemas, toggleFavorite, silentCinemas } = useCinemas();

    // --- état de la vue (useState : la page est démontée au passage sur Timeline/Stats) ---
    const group = useState('seancesGroup', () => 'film');       // 'film' | 'cinema'
    // Créneau horaire : 'all' | 'morning' | 'afternoon' | 'evening' | 'custom'. La plage libre est
    // tenue à part (`[depuis, jusqu'à]` en minutes) pour qu'un aller-retour par « Matin » ne la
    // détruise pas — on y revient d'un clic sur « Choisir plage… ».
    const timeSlot = useState('seancesSlot', () => 'all');
    const customRange = useState('seancesCustomRange', () => null);
    const ugcOnly = useState('seancesUgcOnly', () => true);      // pré-filtre carte, actif par défaut

    // ⚠️ **Le filtre est neutralisé là où aucune salle n'accepte la carte.** Il est actif par défaut,
    // et `useCinemas` note déjà ce que ça coûte quand `accepts_ugc` est illisible : « une page vide
    // alors que le pré-filtre carte est actif par défaut ». À Troyes, ce n'est pas une panne mais
    // l'état normal — aucune salle n'a la carte — donc masquer le bouton sans neutraliser l'état
    // aurait donné une vue vide sans même le contrôle permettant de comprendre pourquoi.
    //
    // L'état `ugcOnly` est laissé tel quel plutôt que forcé à `false` : il est partagé entre visites
    // (`useState`), et le remettre à zéro perdrait le choix d'un utilisateur parisien qui changerait
    // de ville. On ne touche qu'à son **effet**.
    const cardFilterApplies = computed(() => cityInfo.value.hasUgcCard);
    const effectiveUgcOnly = computed(() => ugcOnly.value && cardFilterApplies.value);
    const openCard = useState('seancesOpenCard', () => null);

    // Film mis au premier plan par un clic depuis « Au ciné en ce moment » (`/seances?film=<tmdbId>`).
    // C'est l'`id` de la ligne `calendar`, pas l'identifiant TMDB : c'est lui qui sert de clé partout
    // en aval (buckets, entries). La page fait la conversion, elle seule connaît la route.
    const focusFilmId = useState('seancesFocusFilm', () => null);

    // --- données ---
    const loading = useState('seancesLoading', () => false);
    const error = useState('seancesError', () => null);

    const films = computed(() => seanceFilms.value);

    // Film mis au premier plan, ou `null`. Un identifiant qui ne correspond à aucun film en salle
    // (lien vieilli, film retiré de l'affiche depuis) vaut absence de focus : mieux vaut la page
    // entière qu'un écran vide inexplicable.
    const focusFilm = computed(() =>
        focusFilmId.value == null ? null : (films.value.find(m => m.id === focusFilmId.value) ?? null)
    );

    // Périmètre de la page : un seul film quand on arrive du rail « Au ciné en ce moment », tous
    // sinon. Le focus est appliqué **ici**, à la source : compteurs, arrondissements proposés,
    // « prochaine séance le … » et hiddenByCard en découlent tous et restent donc cohérents entre
    // eux, ce qu'un filtre posé plus bas dans la chaîne n'aurait pas garanti.
    const visibleFilms = computed(() => focusFilm.value ? [focusFilm.value] : films.value);

    // Films qu'on n'a pas su rapprocher d'une fiche Allociné : affichés grisés plutôt que
    // silencieusement absents (on ne veut pas laisser croire qu'ils n'ont aucune séance).
    const unresolved = computed(() =>
        visibleFilms.value.filter(m => !m.allocine_id && m.allocine_checked_at)
    );

    // --- chargement ---

    // Fenêtre d'ouverture des ventes : les exploitants mettent en vente à J-3 / J-4 et Allociné intègre
    // par vagues, si bien qu'un cache même récent ment (constaté sur une entrée de 41 minutes). Aucun
    // TTL défendable ne couvre ce cas — d'où une relecture ciblée sur ces seules journées.
    const PUBLICATION_WINDOW = [2, 4];      // J+2 → J+4 (index dans `days`)
    const REVALIDATE_AFTER = 30 * 60 * 1000;

    // Le jour affiché mérite-t-il une seconde lecture en arrière-plan ?
    // ⚠️ `livePayloadFor` : la question porte sur ce qu'on vient de charger. L'horodatage de la veille
    // forcerait une revalidation — une quinzaine de sorties Allociné — à chaque ouverture.
    const needsRevalidation = (date) => {
        const [from, to] = PUBLICATION_WINDOW;
        if (dayIndex.value < from || dayIndex.value > to) return false;

        const stamps = films.value
            .map(m => livePayloadFor(m, date)?.fetchedAt)
            .filter(Boolean)
            .map(Date.parse)
            .filter(Number.isFinite);

        return stamps.length > 0 && Date.now() - Math.min(...stamps) > REVALIDATE_AFTER;
    };

    const load = async ({ force = false } = {}) => {
        // En tête de `load`, seul appelé depuis `onMounted` : lire `localStorage` plus tôt ferait
        // diverger le rendu serveur du premier rendu client. Sans effet aux appels suivants.
        wireSnapshot();

        // Capturée une fois : tout ce qui suit s'étale sur plusieurs allers-retours, et un clic sur
        // un autre jour entre-temps ferait travailler la suite sur une date qui n'est plus celle du
        // chargement en cours.
        const date = selectedDay.value.date;

        loading.value = true;
        error.value = null;
        try {
            await Promise.all([loadCinemas(), resolveAllocineIds(films.value)]);
            const { requested, failures } = await loadShowtimes(films.value, date, { force });
            // Un seul film en échec sur douze ne justifie pas d'effacer la page : on n'annonce
            // l'erreur que si le jour est intégralement perdu.
            if (failures && failures === requested) error.value = 'Impossible de récupérer les séances.';
        } catch (e) {
            // ⚠️ Sans ce `catch`, une exception inattendue laissait `error` à `null` et `loading` à
            // `false` : la page tombait sur l'état « Aucune séance pour ces critères », c'est-à-dire
            // le message qui accuse les filtres. C'est exactement le faux diagnostic que
            // `useShowtimes` se donne du mal à éviter sur les échecs qu'il sait voir.
            console.error('Chargement des séances échoué', e);
            error.value = 'Impossible de récupérer les séances.';
        } finally {
            loading.value = false;
        }

        // --- suite en arrière-plan, en UNE seule chaîne ---------------------------------------
        //
        // ⚠️ Ces deux étapes écrivent le **même** cache L1 : jamais en parallèle. Quand elles l'étaient,
        // la revalidation réassignait les payloads sans les libellés que `graftEvents` venait d'y poser,
        // et `syncEvents` — qui relit le L1 après un aller-retour réseau par film — écrivait alors un
        // `calendar.events` **vidé** pour la journée. C'est l'appauvrissement silencieux que le reste de
        // la vue s'interdit partout (`seen`, `carryOverMissing`, `carryOverOne`) : on revalide d'abord,
        // on qualifie ensuite, sur des payloads qui ne bougeront plus.
        //
        // Rien n'est attendu par l'appelant : la vue s'affiche dès que les horaires sont là. La
        // revalidation existe parce que la grille d'un jour se remplit **pendant** la journée ; pas de
        // boucle possible, la relecture réécrit `fetchedAt` et la condition retombe.
        const revalidated = (!force && needsRevalidation(date))
            ? loadShowtimes(films.value, date, { force: true })
                .catch(e => console.error('Revalidation du jour échouée', e))
            : Promise.resolve();

        // `films.value` et non `visibleFilms` : cadré sur un film, le rail continue de parler de tous.
        // C'est aussi ce qui fait que revenir de `/seances?film=…` ne perd pas les badges des autres.
        revalidated
            .then(() => loadEvents(films.value, date))
            .then(() => syncEvents(films.value, [date]))
            // Et, gratuitement : si la navigation a fini par charger les sept journées, un film dont
            // l'horizon entier est vide sort de l'affiche sans attendre le mercredi. Ne fait rien tant
            // que la preuve est incomplète — c'est une lecture du cache L1, pas une requête.
            .then(() => pruneEmptyHorizon(films.value, days.value.map(d => d.date)))
            .catch(e => console.error('Relevé des séances événement échoué', e));
    };

    // Réessai après échec réseau : on purge le L1 du jour pour forcer un nouvel appel (le L2
    // décidera de son côté s'il retape Allociné ou s'il ressert du périmé).
    const retry = async () => {
        forgetDay(selectedDay.value.date);
        await load();
    };

    // La bande de jours a-t-elle changé de semaine ? `rollToToday` tranche (cf. `useSeanceDays`) ; ce
    // qui suit est la part qui regarde les séances — purge du cache mémoire des journées désormais
    // derrière nous, puis rechargement. Appelé au retour sur l'onglet : c'est le moment où
    // l'utilisateur relit l'écran, donc le moment où un décalage se verrait.
    const syncToday = async () => {
        if (!rollToToday()) return false;

        openCard.value = null;
        forgetBefore(isoDay(0));
        await load();
        return true;
    };

    // « Actualiser » : ressortir chez Allociné quels que soient les deux caches. Porte de sortie quand
    // la vue et le site de la salle divergent. Geste explicite, jamais automatique.
    //
    // Borné à un forçage par minute et par date : un clic coûte jusqu'à 14 sorties réseau, et le
    // `disabled` ne protège que du double-clic, pas de celui qui reclique faute de voir un changement.
    const FORCE_COOLDOWN_MS = 60 * 1000;
    const lastForcedAt = useState('seancesLastForced', () => ({}));

    const refreshDay = async () => {
        const date = selectedDay.value.date;
        const since = Date.now() - (lastForcedAt.value[date] ?? 0);
        if (since < FORCE_COOLDOWN_MS) return;

        lastForcedAt.value = { ...lastForcedAt.value, [date]: Date.now() };
        forgetDay(date);
        await load({ force: true });
    };

    const selectDay = async (index) => {
        dayIndex.value = index;
        openCard.value = null;
        await load();
    };

    // Cadré sur un film sans séance aujourd'hui : on avance jusqu'au premier jour qui en a —
    // l'information qu'on vient chercher est *quand*. Gratuit : `nextDate` est déjà dans le payload.
    //
    // ⚠️ La boucle existe parce que ce `nextDate` est calculé sur Paris **et sa couronne** : il peut
    // désigner un jour où le film ne joue qu'à Boulogne, donc vide une fois le filtre intra-muros
    // passé. Bornée à trois sauts.
    const MAX_HOPS = 3;

    const jumpToNextAvailableDay = async () => {
        if (!focusFilm.value) return;

        for (let hop = 0; hop < MAX_HOPS; hop++) {
            // `entries` et non `filtered` : les filtres (carte, version, arrondissement) ont leurs
            // propres messages, avec leur propre porte de sortie. Sauter un jour parce que le
            // pré-filtre carte l'a vidé masquerait le fait qu'il s'y joue quelque chose.
            if (entries.value.length) return;

            const index = days.value.findIndex(d => d.date === nextDate.value);
            if (index < 0) return;   // hors des 7 jours affichés : rien à proposer de mieux

            dayIndex.value = index;
            openCard.value = null;
            await load();
        }
    };

    // --- dérivés ---

    // Une entrée = un couple (film, salle) pour le jour sélectionné, avec ses horaires bruts.
    // C'est la granularité commune aux deux regroupements.
    const entries = computed(() => {
        const date = selectedDay.value.date;
        const referential = cinemas.value ?? {};
        const out = [];

        for (const movie of visibleFilms.value) {
            const payload = payloadFor(movie, date);
            if (!payload) continue;

            for (const theater of payload.theaters ?? []) {
                const known = referential[theater.code] ?? {};
                const arr = known.arrondissement ?? arrondissementFromZip(theater.zip);

                out.push({
                    movie,
                    cinema: {
                        code: theater.code,
                        name: theater.name,
                        zip: theater.zip,
                        circuit: theater.circuit,
                        arrondissement: arr,
                        // La commune, pour les villes sans arrondissements. Absente des entrées de
                        // cache écrites avant `2609221215` — toutes parisiennes, donc sans usage.
                        city: theater.city ?? null,
                        // Repère géographique **déjà résolu** : arrondissement à Paris, commune
                        // ailleurs. Résolu ici et pas dans le `.vue`, comme le reste — les
                        // composants ne font que rendre ce qui sort d'ici.
                        place: placeOf({ arrondissement: arr, city: theater.city ?? null }, cityInfo.value),
                        acceptsUgc: known.accepts_ugc === true,
                        // Trajet porte-à-porte, pré-calculé côté serveur : le domicile ne bougeant
                        // pas, c'est une constante par salle. Rien à calculer ici, et surtout
                        // aucune coordonnée personnelle à exposer au navigateur.
                        // ⚠️ Mis à `null` hors des villes qui en ont : `transit_minutes` est calculé
                        // depuis **un** domicile (`scripts/transit-times.mjs`, `HOME_LAT`/`HOME_LNG`),
                        // qui est parisien. L'afficher à Troyes annoncerait un trajet depuis Paris
                        // comme s'il partait de chez soi — un chiffre faux, et crédible, donc pire
                        // qu'une absence.
                        transitMinutes: cityInfo.value.hasTransitTimes ? (known.transit_minutes ?? null) : null,
                        favorite: known.favorite === true,
                        // Position géocodée, pour l'itinéraire. Absente tant que
                        // `scripts/geocode-cinemas.mjs` n'est pas passé sur une salle : `maps.js`
                        // retombe alors sur « nom, code postal Paris ».
                        lat: known.lat ?? null,
                        lng: known.lng ?? null,
                        // Salle qu'Allociné ne rend plus mais qu'on a vue récemment : on la garde
                        // à l'écran (cf. `carryOverMissing`) en disant qu'on ne peut plus la
                        // confirmer. La montrer sans le dire serait pire que de la cacher.
                        unconfirmedSince: theater.unconfirmedSince ?? null,
                    },
                    showtimes: theater.showtimes ?? [],
                });
            }
        }

        return out;
    });

    // Plage horaire demandée, en minutes depuis minuit — `null` quand le filtre est sur « Toutes ».
    const timeRange = computed(() => slotRange(timeSlot.value, customRange.value));

    // Les filtres actifs, sous la forme qu'attend `applyFilters`. `card` reste à part : on l'appelle
    // aussi avec `false` pour compter ce que le pré-filtre carte masque.
    const filters = (card) => ({ card, range: timeRange.value });

    const filtered = computed(() => applyFilters(entries.value, filters(effectiveUgcOnly.value)));

    const byFilm = computed(() => groupByFilm(filtered.value));
    const byCinema = computed(() => groupByCinema(filtered.value));

    const nbFilms = computed(() => byFilm.value.length);
    const nbSeances = computed(() => countShowtimes(filtered.value));
    const nbEvents = computed(() => countEvents(filtered.value));

    // Ce que le pré-filtre carte masque, à filtres égaux : distingue « rien ce jour-là » de « le filtre
    // a tout mangé », sans quoi l'écran vide se lit comme un bug.
    const hiddenByCard = computed(() =>
        effectiveUgcOnly.value ? countMatching(entries.value, filters(false)) - nbSeances.value : 0
    );

    // Même raisonnement pour la plage horaire. ⚠️ Levée sur la base des filtres courants (`...filters`)
    // et non d'un littéral : un filtre ajouté plus tard s'y appliquera sans qu'on y repense.
    const hiddenByTime = computed(() =>
        timeRange.value
            ? countMatching(entries.value, { ...filters(effectiveUgcOnly.value), range: null }) - nbSeances.value
            : 0
    );

    // Séances événement masquées par le pré-filtre carte. Cas presque systématique : une avant-première
    // n'est pas couverte par la carte, et le pré-filtre est actif par défaut. Sans ce décompte, le badge
    // du rail enverrait sur une page où l'événement est introuvable, sans un mot.
    const hiddenEvents = computed(() =>
        effectiveUgcOnly.value ? countMatchingEvents(entries.value, filters(false)) - nbEvents.value : 0
    );

    // Au moins une salle affichée n'est plus confirmée par la source. Signalé une fois pour la page
    // plutôt que salle par salle : le message explique le *pourquoi*, le badge sur la ligne dit *où*.
    const hasUnconfirmed = computed(() => filtered.value.some(e => e.cinema.unconfirmedSince));

    // Payloads servis depuis une entrée périmée (Allociné injoignable au dernier rafraîchissement).
    const stale = computed(() => {
        const date = selectedDay.value.date;
        return visibleFilms.value.some(m => payloadFor(m, date)?.stale);
    });

    // Prochaine date avec des séances, quand le jour sélectionné est vide. On prend la plus proche
    // annoncée par Allociné parmi les films affichés.
    const nextDate = computed(() => {
        const date = selectedDay.value.date;
        const dates = visibleFilms.value
            .map(m => payloadFor(m, date)?.nextDate)
            .filter(Boolean)
            .sort();
        return dates[0] ?? null;
    });

    // Heure du dernier rafraîchissement effectif, pour la ligne de provenance.
    // ⚠️ Daté dès que ce n'est pas d'aujourd'hui (cf. `stampForDisplay`) : la page s'ouvrant sur le
    // relevé de la visite précédente, un « à 21:34 » nu se lirait « il y a un instant ».
    const updatedAt = computed(() => {
        const date = selectedDay.value.date;
        const stamps = visibleFilms.value
            .map(m => payloadFor(m, date)?.fetchedAt)
            .filter(Boolean)
            .sort();
        return stamps.length ? stampForDisplay(stamps[stamps.length - 1]) : null;
    });

    return {
        // état
        days, dayIndex, selectedDay, group, timeSlot, customRange, ugcOnly, cardFilterApplies, openCard,
        focusFilmId, loading, error, stale, silentCinemas, hasUnconfirmed,
        // données
        films, focusFilm, unresolved, byFilm, byCinema, nbFilms, nbSeances, nbEvents,
        hiddenByCard, hiddenByTime, hiddenEvents, nextDate, updatedAt,
        // actions
        load, retry, refreshDay, selectDay, toggleFavorite, jumpToNextAvailableDay, syncToday, refreshCinemas,
    };
}
