export function useMovieCalendar() {
    const client = useSupabaseClient()
    // Le propriétaire des lignes créées ici. RLS couvre déjà les lectures et les modifications
    // (`user_id = auth.uid()`) ; seule l'insertion doit dire explicitement pour qui elle écrit.
    const user = useSupabaseUser()
    const store = useMoviesStore()
    // State singleton (useState) partagé entre layout et pages.
    const movies = useState('movies', () => [])
    const sortedMovies = useState('sortedMovies', () => ({}))
    const moviesWithoutDate = useState('moviesWithoutDate', () => [])

    const formatDate = (fullDate) => {
        const date = new Date(fullDate)
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }

    const sortMovies = (list) => {
        const sorted = {};

        const filtered = list.filter(m => matchesFilters(m, store.filters));

        const dated = filtered
            .map(movie => ({ movie, date: releaseDateOf(movie) }))
            .filter(entry => entry.date !== null)
            .sort((a, b) => a.date - b.date);

        moviesWithoutDate.value = filtered.filter(m => releaseDateOf(m) === null);

        dated.forEach(({ movie, date }) => {
            const year = date.getFullYear();
            const month = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(date);
            const day = date.getDate();

            if (!sorted[year]) sorted[year] = {};
            if (!sorted[year][month]) sorted[year][month] = {};
            if (!sorted[year][month][day]) sorted[year][month][day] = [];

            sorted[year][month][day].push(movie);
        });

        sortedMovies.value = sorted;
    }

    const applyAutoInTheaters = async (movieList) => {
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const currentYear = d.getFullYear();

        // Sorties cinéma de l'année en cours, déjà sorties, non vues → « en salle maintenant ».
        // Garde-fou `>= currentYear` : on ne (re)flague jamais un film d'une année précédente.
        //
        // ⚠️ Promotion **optimiste et provisoire** : elle ne vaut que tant qu'Allociné n'a rien dit.
        // Dès qu'une ligne a été contrôlée (`in_theaters_checked_at`), `useInTheatersSync` est seul
        // à décider — sans cette garde, un film retiré de l'affiche par le contrôle serait re-flaggé
        // au chargement suivant, puis re-retiré la semaine d'après : un va-et-vient perpétuel.
        const toUpdate = movieList.filter(m =>
            m.media === 'cinema' &&
            m.state === 'unseen' &&
            !m.in_theaters_checked_at &&
            m.release_date &&
            m.release_date <= todayStr &&
            yearOf(m.release_date) >= currentYear
        );

        if (!toUpdate.length) return movieList;

        const ids = toUpdate.map(m => m.id);
        await client.from('calendar').update({ state: 'inTheaters' }).in('id', ids);

        return movieList.map(m => ids.includes(m.id) ? { ...m, state: 'inTheaters' } : m);
    }

    // Résout la date effective d'une ligne : override manuel prioritaire, sinon date stockée.
    const effectiveDate = (row) =>
        row.manual_release_date ? formatDate(row.manual_release_date) : (row.release_date || null);

    // Appelé au montage du layout (une fois par montage ; un retour depuis une page `bare` rafraîchit).
    const getMovies = async () => {
        const { data, error } = await client.from('calendar').select('*');
        if (error) return;

        // Filet de sécurité : lignes ajoutées pendant la transition, sans métadonnées.
        // Cas résiduel — on les résout à la volée via /full et on persiste.
        const missing = data.filter(m => !m.title);
        if (missing.length) {
            await promisePool(missing.map(row => async () => {
                try {
                    const meta = await $fetch(`/api/movies/${row.movie_id}/full`);
                    await client.from('calendar')
                        .update({ title: meta.title, poster_path: meta.poster_path, release_date: meta.release_date, director: meta.director, genres: meta.genres, countries: meta.countries, tmdb_vote: meta.vote_average })
                        .eq('id', row.id);
                    row.title = meta.title;
                    row.poster_path = meta.poster_path;
                    row.release_date = meta.release_date;
                    row.director = meta.director;
                    row.genres = meta.genres;
                    row.countries = meta.countries;
                    row.tmdb_vote = meta.vote_average;
                } catch (e) {
                    console.error('Filet de sécurité: résolution échouée pour', row.movie_id, e);
                }
            }), 8);
        }

        // `release_date` local = date effective (triable) ; `_tmdbReleaseDate` conserve
        // la date TMDB stockée en base (pour `recheckUpcomingCinema` et le retrait d'un override).
        const withDates = data.map(movie => ({
            ...movie,
            _tmdbReleaseDate: movie.release_date || null,
            release_date: effectiveDate(movie),
        }));
        const updated = await applyAutoInTheaters(withDates);
        movies.value = updated;
        sortMovies(updated);
        recheckUpcomingCinema();
    }

    // Revérifie les métadonnées (date, titre, poster) des sorties cinéma à venir — seul cas où
    // elles peuvent encore bouger côté TMDB. Exclut les overrides manuels et les films déjà sortis.
    const recheckUpcomingCinema = async () => {
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const toCheck = movies.value.filter(m =>
            m.media === 'cinema' &&
            !m.manual_release_date &&
            (!m.release_date || m.release_date > todayStr)
        );
        if (!toCheck.length) return;

        // On accumule les patchs et on ne réassigne `movies.value` qu'une seule fois à la fin,
        // pour éviter un re-rendu par film modifié.
        const patches = new Map();
        await promisePool(toCheck.map(movie => async () => {
            try {
                const meta = await $fetch(`/api/movies/${movie.movie_id}/full`);
                const fresh = meta.release_date || null;
                const patch = {};
                if (fresh !== (movie._tmdbReleaseDate || null)) patch.release_date = fresh;
                if (meta.title && meta.title !== movie.title) patch.title = meta.title;
                if (meta.poster_path !== movie.poster_path) patch.poster_path = meta.poster_path;
                if (meta.director !== movie.director) patch.director = meta.director;
                // genres/countries stables côté TMDB mais absents des lignes pré-backfill : on les
                // renseigne si manquants (coût nul, /full les renvoie déjà).
                if ((!movie.genres || !movie.genres.length) && meta.genres?.length) patch.genres = meta.genres;
                if ((!movie.countries || !movie.countries.length) && meta.countries?.length) patch.countries = meta.countries;
                if ((movie.tmdb_vote == null) && meta.vote_average != null) patch.tmdb_vote = meta.vote_average;
                if (!Object.keys(patch).length) return;

                await client.from('calendar').update(patch).eq('id', movie.id);
                patches.set(movie.id, { patch, fresh });
            } catch (e) {
                console.error('Revérif film à venir échouée pour', movie.movie_id, e);
            }
        }), 8);

        if (!patches.size) return;

        movies.value = movies.value.map(m => {
            const entry = patches.get(m.id);
            if (!entry) return m;
            const next = { ...m, ...entry.patch };
            // toCheck exclut les overrides manuels → release_date effective = date TMDB fraîche.
            if ('release_date' in entry.patch) next._tmdbReleaseDate = entry.fresh;
            return next;
        });
        const resorted = await applyAutoInTheaters(movies.value);
        movies.value = resorted;
        sortMovies(resorted);
    }

    const handleMovieAdded = async (event) => {
        const newEntry = event.detail?.newEntry;
        if (!newEntry) return;
        // newEntry porte déjà title / poster_path / release_date (persistés à l'ajout).
        const newMovie = {
            ...newEntry,
            _tmdbReleaseDate: newEntry.release_date || null,
            release_date: effectiveDate(newEntry),
        };
        const [resolved] = await applyAutoInTheaters([newMovie]);
        movies.value = [...movies.value, resolved];
        sortMovies(movies.value);
    }

    // Marque / démarque un film « à rattraper ». Patch local sans refetch.
    // `catchup_at` = horodatage d'ajout (ordre du slider, le dernier ajouté à droite) ; null au retrait.
    const setCatchup = async (id, value) => {
        const catchup_at = value ? new Date().toISOString() : null;
        const { error } = await client.from('calendar').update({ catchup: value, catchup_at }).eq('id', id);
        if (error) { console.error('Toggle catchup échoué pour', id, error.message); return; }
        movies.value = movies.value.map(m => m.id === id ? { ...m, catchup: value, catchup_at } : m);
        // Re-trie pour rafraîchir les références d'objets exposées via sortedMovies (la timeline
        // lit `catchup` par ce biais) ; le tri lui-même est inchangé (catchup n'affecte pas l'ordre).
        sortMovies(movies.value);
    }

    // Rafraîchit les notes Letterboxd des films non vus & sortis de l'année donnée.
    // Skip les notes fraîches (< 7 j). Throttlé (8), un seul réassign de movies.value.
    const refreshLetterboxdRatings = async (year) => {
        const todayStr = today();
        const staleBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;

        // Gate sur l'ancienneté du dernier check (jamais checké OU périmé > 7 j). Un film jamais
        // noté avec succès n'est pas horodaté (voir plus bas) → il repasse ici à chaque ouverture
        // jusqu'à obtenir une note ; les films notés sont mis en cache 7 j.
        //
        // ⚠️ Ne **pas** y ajouter « ou les liens réalisateurs manquent » : sans porte de sortie, un
        // film que Letterboxd ne crédite pas repasserait à chaque ouverture, pour toujours. Ces
        // liens sont acquis à l'insertion et par le backfill ; ici ils sont ramassés au passage.
        const toCheck = movies.value.filter(m =>
            m.state !== 'seen' &&
            m.release_date &&
            m.release_date <= todayStr &&
            yearOf(m.release_date) === year &&
            (!m.letterboxd_rating_at || new Date(m.letterboxd_rating_at).getTime() < staleBefore)
        );
        if (!toCheck.length) return;

        const nowIso = new Date().toISOString();
        const patches = new Map();
        await promisePool(toCheck.map(movie => async () => {
            try {
                const { rating, directors } = await $fetch(`/api/movies/${movie.movie_id}/letterboxd`);
                let patch = null;
                if (rating != null) {
                    patch = { letterboxd_rating: rating, letterboxd_rating_at: nowIso };
                } else if (movie.letterboxd_rating != null) {
                    // Scrape transitoirement raté mais note déjà en base : on la garde et on
                    // repousse le prochain check en rafraîchissant seulement l'horodatage.
                    patch = { letterboxd_rating_at: nowIso };
                }
                // Écrits même si la note manque : les liens, eux, ne périment pas.
                if (directors?.length) patch = { ...patch, letterboxd_directors: directors };
                // Ni note ni liens → on n'horodate pas : nouvelle tentative à la prochaine ouverture.
                if (!patch) return;

                const applied = await patchCalendarRow(client, movie.id, patch);
                if (applied) patches.set(movie.id, applied);
            } catch (e) {
                console.error('Refresh note Letterboxd échoué pour', movie.movie_id, e);
            }
        }), 8);

        if (!patches.size) return;
        movies.value = movies.value.map(m => {
            const patch = patches.get(m.id);
            return patch ? { ...m, ...patch } : m;
        });
    }

    // Ajoute un film « à rattraper » : réutilise la ligne existante si présente (toggle catchup),
    // sinon insère une nouvelle ligne calendar (comme MovieAddForm) avec catchup=true.
    // `year` = année de la vue Stats d'où part l'ajout : persistée en `catchup_year`, elle sert de
    // repli d'année pour les films sans date FR résolue (voir filtre dans Catchup.vue).
    // Retourne l'entrée à intégrer localement (ou null si simple toggle d'un film déjà là).
    const addCatchupMovie = async ({ movieId, media = 'cinema', year = null }) => {
        // `.limit(1)` + repli sur le premier plutôt que `.maybeSingle()` : tolère d'éventuels
        // doublons de `movie_id` sans lever. Enveloppé pour ne jamais casser l'ajout.
        let existing = null;
        try {
            const { data } = await client
                .from('calendar')
                .select('id')
                .eq('movie_id', movieId)
                .order('id')
                .limit(1);
            existing = data?.[0] ?? null;
        } catch (e) {
            console.error('Lecture ligne catchup existante échouée:', e);
        }
        const catchup_at = new Date().toISOString();
        if (existing) {
            const { error } = await client
                .from('calendar')
                .update({ catchup: true, catchup_year: year, catchup_at })
                .eq('id', existing.id);
            if (error) { console.error('Toggle catchup (ligne existante) échoué:', error.message); return null; }
            movies.value = movies.value.map(m => m.id === existing.id ? { ...m, catchup: true, catchup_year: year, catchup_at } : m);
            sortMovies(movies.value);
            return null;
        }

        let meta = { title: null, poster_path: null, release_date: null, director: null, genres: null, countries: null, vote_average: null };
        try {
            meta = await $fetch(`/api/movies/${movieId}/full`);
        } catch (e) {
            console.error('Métadonnées TMDB indisponibles à l\'ajout catchup, résolution différée:', e);
        }
        const { data: inserted, error } = await client
            .from('calendar')
            .insert({
                // Cf. la note du jumeau dans `nav/MovieAddForm.vue` : explicite, pas laissé au
                // `default auth.uid()` de la colonne.
                user_id: user.value?.id,
                movie_id: movieId,
                media,
                state: 'unseen',
                catchup: true,
                catchup_year: year,
                catchup_at,
                title: meta.title,
                poster_path: meta.poster_path,
                release_date: meta.release_date,
                director: meta.director,
                genres: meta.genres,
                countries: meta.countries,
                tmdb_vote: meta.vote_average,
            })
            .select()
            .single();
        if (error) { console.error('Insert film catchup échoué:', error.message); return null; }

        const entry = {
            id: inserted.id,
            movie_id: movieId,
            media,
            state: 'unseen',
            catchup: true,
            catchup_year: year,
            catchup_at,
            title: meta.title,
            poster_path: meta.poster_path,
            release_date: meta.release_date,
            director: meta.director,
            genres: meta.genres,
            countries: meta.countries,
            tmdb_vote: meta.vote_average,
        };
        // Second point d'insertion — l'autre est nav/MovieAddForm. Sans `await` : l'ajout ne doit pas
        // attendre Letterboxd.
        void resolveLetterboxdDirectors(client, entry);
        return entry;
    }

    const handleMovieExists = (event) => event.detail?.movieId

    const handleMovieDeleted = (id) => {
        movies.value = movies.value.filter(m => m.id !== id);
        sortMovies(movies.value);
    }

    const handleReleaseDateUpdated = async ({ id, manual_release_date }) => {
        const movie = movies.value.find(m => m.id === id);
        if (!movie) return;
        // Override posé → date manuelle ; override retiré → on retombe sur la date TMDB stockée.
        const release_date = manual_release_date
            ? formatDate(manual_release_date)
            : (movie._tmdbReleaseDate || null);
        movies.value = movies.value.map(m =>
            m.id === id ? { ...m, manual_release_date, release_date } : m
        );
        sortMovies(movies.value);
    }

    // Bornes de lecture des événements datés. ⚠️ Lues à chaque réévaluation et non capturées, pour
    // suivre le jour et la semaine — mais elles ne bougent pas d'elles-mêmes tant que la liste ne
    // change pas.
    const eventBounds = () => ({ freshSince: lastWednesday(), today: isoDay(0) })

    // Rubrique « Événements à venir » du rail : les films qui ont une séance événement devant eux —
    // avant-première, séance unique, label de programmation — triés par imminence.
    //
    // ⚠️ Ces films ne sont **pas** forcément `inTheaters`, et c'est tout l'intérêt de la rubrique : une
    // avant-première a lieu *avant* la sortie (cf. `useUpcomingEvents`). Filtrer sur l'état, comme le
    // fait `cinemaNow`, les aurait tous manqués.
    const eventSoon = computed(() => {
        const bounds = eventBounds()
        return movies.value
            .filter(m => hasUpcomingEvent(m, bounds))
            .sort((a, b) => {
                const [ea, eb] = [nextMovieEvent(a, bounds), nextMovieEvent(b, bounds)]
                return String(ea?.date).localeCompare(String(eb?.date))
                    || String(a.title).localeCompare(String(b.title))
            })
    })

    // Films actuellement en salle (rail droit desktop + bande mobile). L'état est tenu à jour par
    // `useInTheatersSync` : ce sont les films qui ont au moins une séance à Paris dans les 7 jours
    // qui viennent, donc exactement ceux que la vue Séances sait montrer.
    //
    // Ceux que la rubrique « Événements à venir » a pris en charge en sortent : les afficher aux deux
    // endroits ferait lire deux fois le même film au même endroit de l'écran, et la version datée est
    // strictement plus informative.
    const cinemaNow = computed(() => {
        const featured = new Set(eventSoon.value.map(m => m.id))
        return movies.value
            .filter(m => m.state === 'inTheaters' && !featured.has(m.id))
            .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))
    })

    // Périmètre de la vue Séances : **les deux rubriques du rail réunies**, celles à événement devant.
    //
    // ⚠️ Et surtout pas `cinemaNow` seul, qui retire les films pris en charge par « Événements à venir »
    // pour ne pas les afficher deux fois : le film ouvrait alors `/seances?film=…` sans y être trouvé,
    // donc ni cadré ni chargé.
    const seanceFilms = computed(() => {
        const out = [...eventSoon.value]
        const seen = new Set(out.map(m => m.id))
        for (const m of cinemaNow.value) if (!seen.has(m.id)) out.push(m)
        return out
    })

    return {
        movies,
        sortedMovies,
        moviesWithoutDate,
        cinemaNow,
        eventSoon,
        seanceFilms,
        eventBounds,
        getMovies,
        sortMovies,
        handleMovieAdded,
        handleMovieExists,
        handleMovieDeleted,
        handleReleaseDateUpdated,
        setCatchup,
        refreshLetterboxdRatings,
        addCatchupMovie,
    }
}
