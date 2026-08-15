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

const pad = (n) => String(n).padStart(2, '0');

export function useSeances() {
    const { seanceFilms } = useMovieCalendar();
    const { payloadFor, resolveAllocineIds, loadShowtimes, forgetDay, forgetBefore } = useShowtimes();
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
    const openCard = useState('seancesOpenCard', () => null);

    // Film mis au premier plan par un clic depuis « Au ciné en ce moment » (`/seances?film=<tmdbId>`).
    // C'est l'`id` de la ligne `calendar`, pas l'identifiant TMDB : c'est lui qui sert de clé partout
    // en aval (buckets, entries). La page fait la conversion, elle seule connaît la route.
    const focusFilmId = useState('seancesFocusFilm', () => null);

    // --- données ---
    const loading = useState('seancesLoading', () => false);
    const error = useState('seancesError', () => null);

    // Films que la vue doit savoir montrer, dans l'ordre du rail : la rubrique « Événement à venir »
    // d'abord, puis « Au ciné en ce moment ». Certains ne sont pas encore sortis — une avant-première a
    // lieu avant la sortie — et c'est justement pour eux qu'on vient ici.
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

    // Fenêtre d'ouverture des ventes : c'est là que la grille d'un jour se remplit **pendant** la
    // journée, et donc là qu'un cache, même récent, ment. Les exploitants mettent en vente à J-3 /
    // J-4 et Allociné intègre par vagues — constaté deux fois le 13/08/2026 sur UGC Ciné Cité Les
    // Halles au dimanche 16 (J+3), une fois sur une entrée de 9 h et une fois sur une entrée de
    // 41 minutes. Aucun TTL défendable ne couvre ce cas : à 41 minutes, il faudrait rafraîchir en
    // permanence tous les jours de la semaine pour rattraper trois d'entre eux.
    const PUBLICATION_WINDOW = [2, 4];      // J+2 → J+4 (index dans `days`)
    const REVALIDATE_AFTER = 30 * 60 * 1000;

    // Le jour affiché mérite-t-il une seconde lecture en arrière-plan ?
    const needsRevalidation = () => {
        const [from, to] = PUBLICATION_WINDOW;
        if (dayIndex.value < from || dayIndex.value > to) return false;

        const date = selectedDay.value.date;
        const stamps = films.value
            .map(m => payloadFor(m, date)?.fetchedAt)
            .filter(Boolean)
            .map(Date.parse)
            .filter(Number.isFinite);

        return stamps.length > 0 && Date.now() - Math.min(...stamps) > REVALIDATE_AFTER;
    };

    const load = async ({ force = false } = {}) => {
        loading.value = true;
        error.value = null;
        try {
            await Promise.all([loadCinemas(), resolveAllocineIds(films.value)]);
            const { requested, failures } = await loadShowtimes(films.value, selectedDay.value.date, { force });
            // Un seul film en échec sur douze ne justifie pas d'effacer la page : on n'annonce
            // l'erreur que si le jour est intégralement perdu.
            if (failures && failures === requested) error.value = 'Impossible de récupérer les séances.';
        } finally {
            loading.value = false;
        }

        // Seconde passe : qualifier les séances en séances événement, puis noter ce qu'on a trouvé sur
        // les lignes `calendar` pour que le rail « Au ciné en ce moment » puisse les mettre en avant.
        //
        // **Hors du `try` et sans `await`, volontairement.** La vue s'affiche dès que les horaires sont
        // là ; les marqueurs apparaissent une fraction de seconde après, sans écran de chargement.
        // L'ordre importe en revanche : `syncEvents` lit le L1 que `loadEvents` vient d'enrichir, d'où
        // le chaînage plutôt que deux appels côte à côte.
        //
        // `films.value` et non `visibleFilms` : cadré sur un film, le rail continue de parler de tous.
        // C'est aussi ce qui fait que revenir de `/seances?film=…` ne perd pas les badges des autres.
        loadEvents(films.value, selectedDay.value.date)
            .then(() => syncEvents(films.value, [selectedDay.value.date]))
            // Et, gratuitement : si la navigation a fini par charger les sept journées, un film dont
            // l'horizon entier est vide sort de l'affiche sans attendre le mercredi. Ne fait rien tant
            // que la preuve est incomplète — c'est une lecture du cache L1, pas une requête.
            .then(() => pruneEmptyHorizon(films.value, days.value.map(d => d.date)))
            .catch(e => console.error('Relevé des séances événement échoué', e));

        // Puis, sans bloquer l'affichage : on montre le cache tout de suite, et on va vérifier
        // derrière. La vue se complète toute seule si une salle a ouvert ses ventes entre-temps —
        // c'est le seul moyen de ne pas dépendre d'un clic sur « Actualiser » pour être juste.
        // Pas de boucle possible : la relecture réécrit `fetchedAt`, la condition retombe.
        if (!force && needsRevalidation()) {
            loadShowtimes(films.value, selectedDay.value.date, { force: true })
                .catch(e => console.error('Revalidation du jour échouée', e));
        }
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

    // « Actualiser » : ressortir chez Allociné pour le jour affiché, quels que soient les deux
    // caches. C'est la porte de sortie quand la vue et le site de la salle ne disent pas la même
    // chose — les exploitants ouvrent leurs ventes en cours de journée, aucun TTL ne peut deviner
    // quand. Geste explicite, donc jamais déclenché tout seul.
    //
    // Borné à un forçage par minute et par date : un clic coûte jusqu'à 14 sorties réseau, et le
    // `disabled` pendant le chargement ne protège que du double-clic — pas de l'utilisateur qui
    // reclique parce qu'il ne voit rien changer (le cas le plus probable, justement).
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

    // Cadré sur un film sans séance aujourd'hui : on avance jusqu'au premier jour qui en a. Arriver
    // depuis « Au ciné en ce moment » sur un mur vide alors que le film joue samedi n'a aucun
    // intérêt — l'information qu'on vient chercher est *quand*.
    //
    // Le repérage ne coûte rien : `nextDate` est déjà dans le payload du jour courant, Allociné le
    // livre justement quand il n'a rien à cette date. On saute donc directement au bon jour au lieu
    // de sonder les sept.
    //
    // La boucle existe parce que ce `nextDate` est calculé sur Paris **et sa couronne** (cf.
    // `PARIS_LOCALIZATION`) : il peut désigner un jour où le film ne joue qu'à Boulogne, donc vide
    // une fois le filtre intra-muros passé. On repart alors du `nextDate` de ce jour-là. Bornée à
    // trois sauts — au-delà, mieux vaut laisser l'utilisateur sur le message « prochaine séance
    // le … » que d'enchaîner les chargements.
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
                        acceptsUgc: known.accepts_ugc === true,
                        // Trajet porte-à-porte, pré-calculé côté serveur : le domicile ne bougeant
                        // pas, c'est une constante par salle. Rien à calculer ici, et surtout
                        // aucune coordonnée personnelle à exposer au navigateur.
                        transitMinutes: known.transit_minutes ?? null,
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

    const filtered = computed(() => applyFilters(entries.value, filters(ugcOnly.value)));

    const byFilm = computed(() => groupByFilm(filtered.value));
    const byCinema = computed(() => groupByCinema(filtered.value));

    const nbFilms = computed(() => byFilm.value.length);
    const nbSeances = computed(() => countShowtimes(filtered.value));
    const nbEvents = computed(() => countEvents(filtered.value));

    // Ce que le pré-filtre carte masque, à filtres égaux par ailleurs. Sert à distinguer
    // « il n'y a rien ce jour-là » de « c'est le filtre carte qui a tout mangé » — sans quoi
    // l'écran vide se lit comme un bug plutôt que comme un filtre.
    const hiddenByCard = computed(() =>
        ugcOnly.value ? countMatching(entries.value, filters(false)) - nbSeances.value : 0
    );

    // Même raisonnement pour la plage horaire : sans ce compte, une journée pleine mais hors créneau
    // afficherait « aucune séance ce jour-là », suivi d'un « prochaine séance le … » franchement
    // faux — il y en a une, c'est juste qu'on a demandé à ne pas la voir.
    //
    // La plage est **levée sur la base des filtres courants** (`...filters`) et non d'un objet
    // reconstruit à la main : un filtre ajouté plus tard à `filters()` s'appliquera ici sans qu'on y
    // repense, alors qu'un littéral l'aurait oublié en silence — et ce décompte serait devenu faux.
    const hiddenByTime = computed(() =>
        timeRange.value
            ? countMatching(entries.value, { ...filters(ugcOnly.value), range: null }) - nbSeances.value
            : 0
    );

    // Séances événement que le pré-filtre carte masque. Cas presque systématique et non anecdotique :
    // une avant-première n'est pas couverte par la carte UGC (cf. `isCardEligible`), et le pré-filtre
    // est actif par défaut. Sans ce décompte, le badge « ÉVÉNEMENT » du rail enverrait sur une page où
    // l'événement est introuvable, sans un mot pour l'expliquer — la promesse d'un côté, le silence de
    // l'autre. On préfère le dire et proposer la porte de sortie.
    const hiddenEvents = computed(() =>
        ugcOnly.value ? countMatchingEvents(entries.value, filters(false)) - nbEvents.value : 0
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
    const updatedAt = computed(() => {
        const date = selectedDay.value.date;
        const stamps = visibleFilms.value
            .map(m => payloadFor(m, date)?.fetchedAt)
            .filter(Boolean)
            .sort();
        if (!stamps.length) return null;
        const d = new Date(stamps[stamps.length - 1]);
        return isNaN(d) ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    });

    return {
        // état
        days, dayIndex, selectedDay, group, timeSlot, customRange, ugcOnly, openCard,
        focusFilmId, loading, error, stale, silentCinemas, hasUnconfirmed,
        // données
        films, focusFilm, unresolved, byFilm, byCinema, nbFilms, nbSeances, nbEvents,
        hiddenByCard, hiddenByTime, hiddenEvents, nextDate, updatedAt,
        // actions
        load, retry, refreshDay, selectDay, toggleFavorite, jumpToNextAvailableDay, syncToday, refreshCinemas,
    };
}
