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
            const month = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(date).replace('.', '');
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

        const toUpdate = movieList.filter(m =>
            m.media === 'cinema' &&
            m.state === 'unseen' &&
            m.release_date &&
            m.release_date <= todayStr
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
                        .update({ title: meta.title, poster_path: meta.poster_path, release_date: meta.release_date })
                        .eq('id', row.id);
                    row.title = meta.title;
                    row.poster_path = meta.poster_path;
                    row.release_date = meta.release_date;
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
    }
}
