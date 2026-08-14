// Vue « Séances » : tout l'état et toute la logique métier de la page.
//
// Point de départ : les films `state === 'inTheaters'` (ceux du rail « Au ciné en ce moment »),
// état lui-même tenu par `useInTheatersSync` — les deux vues montrent donc rigoureusement la même
// affiche. Pour chaque film on résout un identifiant Allociné (une fois, persisté en base), puis on
// charge ses séances parisiennes du jour sélectionné. Les composants ne font que rendre ce qui sort
// d'ici — aucune logique métier dans les `.vue`.
//
// La résolution, le chargement d'une journée et le cache L1 vivent dans `useShowtimes`, partagé
// avec le contrôle « en salle » — c'est son en-tête qui décrit les deux niveaux de cache.
// Les filtres (film, plage horaire, carte, regroupement) sont purement dérivés : en changer ne
// déclenche jamais de requête.

const DAYS_AHEAD = SEANCES_HORIZON_DAYS;
const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MSHORT = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'];

// Les règles de filtrage, de tri et de regroupement vivent dans `app/utils/seancesGrouping.js` :
// fonctions pures, donc testables sans monter Nuxt (`scripts/test-seances-rules.mjs`). Ce fichier
// ne garde que ce qui a besoin d'état, de réactivité ou du réseau.

const pad = (n) => String(n).padStart(2, '0');

export function useSeances() {
    const client = useSupabaseClient();
    const { cinemaNow } = useMovieCalendar();
    const { payloadFor, resolveAllocineIds, loadShowtimes, forgetDay, forgetBefore } = useShowtimes();

    // --- état de la vue (useState : la page est démontée au passage sur Timeline/Stats) ---
    const dayIndex = useState('seancesDay', () => 0);
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
    const cinemas = useState('seancesCinemas', () => null);      // référentiel, chargé une fois
    const loading = useState('seancesLoading', () => false);
    const error = useState('seancesError', () => null);

    // Jour de référence de la bande de dates. **Réactif**, et c'est tout l'enjeu : construit
    // directement sur `new Date()`, `days` se figeait au montage. `new Date()` n'est pas une
    // dépendance réactive — une visite laissée ouverte à travers minuit continuerait donc d'appeler
    // « Auj. » la veille et de servir ses séances. L'app mentirait sur le jour, ce qui est pire que
    // de manquer une salle.
    //
    // ⚠️ Défaut trouvé par lecture du code, **pas** observé en conditions réelles : il demande de
    // laisser un onglet ouvert plus de 24 h. Ne pas le confondre avec le cache mémoire de la visite,
    // qui lui se voit tout de suite (une page ouverte quelques heures ressert le jour tel qu'il était
    // au chargement tant qu'on ne recharge pas — c'est ce que corrige `onVisible` côté page).
    const today = useState('seancesToday', () => isoDay(0));

    const days = computed(() => {
        // Midi et non minuit : ajouter des jours à partir de midi traverse les changements d'heure
        // sans jamais retomber sur la veille.
        const [y, m, d] = today.value.split('-').map(Number);
        const base = new Date(y, m - 1, d, 12, 0, 0, 0);

        return Array.from({ length: DAYS_AHEAD }, (_, i) => {
            const d = new Date(base);
            d.setDate(base.getDate() + i);
            return {
                index: i,
                date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                dow: i === 0 ? 'Auj.' : DAY_NAMES[d.getDay()],
                dd: pad(d.getDate()),
                month: MSHORT[d.getMonth()],
                today: i === 0,
            };
        });
    });

    const selectedDay = computed(() => days.value[dayIndex.value] ?? days.value[0]);

    // Films de la liste actuellement en salle, dans l'ordre du rail.
    const films = computed(() => cinemaNow.value);

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

    // Référentiel des salles : une lecture par session, il ne bouge qu'au rythme du seed carte
    // et du script de géocodage.
    const loadCinemas = async () => {
        if (cinemas.value) return;
        // `lat` / `lng` servent l'itinéraire (cf. `utils/maps.js`) : une salle géocodée s'ouvre sur
        // ses coordonnées exactes plutôt que sur une adresse Allociné approximative.
        const COLUMNS = 'code, name, arrondissement, accepts_ugc, transit_minutes, lat, lng';
        const SILENCE = 'allocine_silent_since, allocine_checked_at';

        let { data, error: dbError } = await client.from('cinemas').select(`${COLUMNS}, favorite, ${SILENCE}`);

        // Repli si une colonne récente n'existe pas encore en base : le code peut être déployé avant
        // que la migration soit jouée, et sans ce filet **tout** le référentiel devient illisible —
        // donc plus d'`accepts_ugc`, donc une page vide alors que le pré-filtre carte est actif par
        // défaut. Une salle sans favori ni signalement vaut mieux qu'un écran blanc. On dégrade en
        // deux temps pour ne perdre que ce qui manque vraiment.
        if (dbError?.code === '42703') {
            console.warn('[seances] Colonnes de silence absentes — joue _ressources/sql/2608131800-add-cinema-silence.sql pour signaler les salles absentes d\'Allociné.');
            ({ data, error: dbError } = await client.from('cinemas').select(`${COLUMNS}, favorite`));
        }
        if (dbError?.code === '42703') {
            console.warn('[seances] Colonne `favorite` absente — joue _ressources/sql/2608121820-add-cinema-favorite.sql pour activer les cinémas favoris.');
            ({ data, error: dbError } = await client.from('cinemas').select(COLUMNS));
        }

        if (dbError) {
            console.error('Référentiel cinemas illisible:', dbError.message);
            cinemas.value = {};
            return;
        }
        cinemas.value = Object.fromEntries((data ?? []).map(c => [c.code, c]));
    };

    // Relit le référentiel malgré le cache de session. Il bouge rarement, mais pas jamais : une
    // étoile posée sur un autre appareil, une salle nouvellement géocodée, ou surtout un
    // signalement d'absence écrit par `check-seances.mjs` pendant que la page est ouverte — sans
    // relecture, l'avertissement n'apparaîtrait qu'au prochain rechargement complet.
    const refreshCinemas = async () => {
        cinemas.value = null;
        await loadCinemas();
    };

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

    // La date a-t-elle changé depuis que la page est ouverte ? Si oui, on repart d'une semaine juste :
    // nouvelle bande de jours, retour sur « aujourd'hui », et purge du cache mémoire des journées
    // désormais derrière nous. Appelé au retour sur l'onglet — c'est le moment où l'utilisateur
    // relit l'écran, donc le moment où un décalage se verrait.
    const syncToday = async () => {
        const now = isoDay(0);
        if (now === today.value) return false;

        today.value = now;
        dayIndex.value = 0;
        openCard.value = null;
        forgetBefore(now);
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

    // Épingle / désépingle une salle. Bascule optimiste : le tri se réordonne immédiatement, et on
    // revient en arrière si l'écriture échoue — sur un simple clic d'étoile, attendre l'aller-retour
    // réseau pour voir la carte bouger serait pénible.
    const toggleFavorite = async (code) => {
        const current = cinemas.value?.[code];
        if (!current) return;

        const next = !current.favorite;
        cinemas.value = { ...cinemas.value, [code]: { ...current, favorite: next } };

        const { error: dbError } = await client
            .from('cinemas')
            .update({ favorite: next, updated_at: new Date().toISOString() })
            .eq('code', code);

        if (dbError) {
            console.error('Bascule favori échouée pour', code, dbError.message);
            cinemas.value = { ...cinemas.value, [code]: { ...current } };
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

    // Salles que le dernier contrôle a trouvées **absentes d'Allociné** (cf. `check-seances.mjs`).
    // Leurs séances existent peut-être — elles ne sont simplement pas dans la source. Une salle qui
    // manque ne fait aucun bruit dans la vue : sans ce signalement, l'absence se lit comme « ce
    // cinéma ne joue rien », ce qui est faux et détruit la confiance dans tout le reste.
    //
    // On se tait si le contrôle n'a pas tourné depuis une semaine : mieux vaut ne rien dire qu'un
    // avertissement périmé sur une salle qui a peut-être reparlé depuis.
    const SILENCE_NOTICE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

    const silentCinemas = computed(() => {
        const fresh = Date.now() - SILENCE_NOTICE_MAX_AGE;
        return Object.values(cinemas.value ?? {})
            .filter(c => c.allocine_silent_since
                && c.accepts_ugc
                && Date.parse(c.allocine_checked_at) > fresh)
            .map(c => ({ name: c.name, since: c.allocine_silent_since }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    });

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
        films, focusFilm, unresolved, byFilm, byCinema, nbFilms, nbSeances, hiddenByCard, hiddenByTime,
        nextDate, updatedAt,
        // actions
        load, retry, refreshDay, selectDay, toggleFavorite, jumpToNextAvailableDay, syncToday, refreshCinemas,
    };
}
