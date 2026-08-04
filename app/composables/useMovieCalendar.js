export function useMovieCalendar() {
    const client = useSupabaseClient()
    const store = useMoviesStore()
    const movies = ref([])
    const sortedMovies = ref({})
    const moviesWithoutDate = ref([])

    const formatDate = (fullDate) => {
        const date = new Date(fullDate)
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }

    const sortMovies = (list) => {
        const sorted = {};

        const filtered = list.filter(m => {
            const stateMatch = !store.filters.state || m.state === store.filters.state;
            const mediaMatch = !store.filters.media || m.media === store.filters.media;
            return stateMatch && mediaMatch;
        });

        moviesWithoutDate.value = filtered.filter(m => !m.release_date || isNaN(new Date(m.release_date)));

        const byDate = [...filtered]
            .filter(m => m.release_date && !isNaN(new Date(m.release_date)))
            .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

        byDate.forEach((movie) => {
            const date = new Date(movie.release_date);
            const year = date.getFullYear();
            const month = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(date);
            const day = date.getDate();

            if (!sorted[year]) sorted[year] = {};
            if (!sorted[year][month]) sorted[year][month] = {};
            if (!sorted[year][month][day]) sorted[year][month][day] = [];

            sorted[year][month][day].push(movie);
        });

        sortedMovies.value = sorted;
        window.dispatchEvent(new CustomEvent('years-updated', { detail: { years: Object.keys(sorted).map(Number) } }));
    }

    const applyAutoInTheaters = async (movieList) => {
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const currentYear = d.getFullYear();
        const yearOf = (ds) => { const x = new Date(ds); return isNaN(x) ? null : x.getFullYear(); };

        // Sorties cinéma de l'année en cours, déjà sorties, non vues → « en salle maintenant ».
        // Garde-fou `>= currentYear` : on ne (re)flague jamais un film d'une année précédente.
        const toUpdate = movieList.filter(m =>
            m.media === 'cinema' &&
            m.state === 'unseen' &&
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
        // la date TMDB stockée en base (pour la revérif Step 6 et le retrait d'un override manuel).
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
                // Films à venir : titre/poster peuvent encore bouger côté TMDB → on les rafraîchit
                // aussi (l'appel /full les renvoie déjà, coût nul).
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
                const { rating } = await $fetch(`/api/movies/${movie.movie_id}/letterboxd`);
                let patch;
                if (rating != null) {
                    patch = { letterboxd_rating: rating, letterboxd_rating_at: nowIso };
                } else if (movie.letterboxd_rating != null) {
                    // Scrape transitoirement raté mais note déjà en base : on la garde et on
                    // repousse le prochain check en rafraîchissant seulement l'horodatage.
                    patch = { letterboxd_rating_at: nowIso };
                } else {
                    // Jamais de note obtenue → on n'horodate pas : nouvelle tentative à la
                    // prochaine ouverture (au lieu d'un cache « vide » de 7 j).
                    return;
                }
                await client.from('calendar').update(patch).eq('id', movie.id);
                patches.set(movie.id, patch);
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

        return {
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

    watch(() => store.filters, () => sortMovies(movies.value), { deep: true });

    return {
        movies,
        sortedMovies,
        moviesWithoutDate,
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
