export function useMovieCalendar() {
    const client = useSupabaseClient()
    const store = useMoviesStore()
    const movies = ref([])
    const sortedMovies = ref({})
    const moviesWithoutDate = ref([])

    const formateDate = (fullDate) => {
        const date = new Date(fullDate)
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}, ${month.toString().padStart(2, '0')}, ${day.toString().padStart(2, '0')}`;
    }

    const getReleaseDateFromId = async (id) => {
        try {
            const dates = await $fetch(`/api/movies/${id}/release_dates`);
            let frenchDates = null;
            let frenchDate = '';

            dates.results.forEach((lang) => {
                if (lang.iso_3166_1 === 'FR') frenchDates = lang.release_dates;
            })

            // Type 3 = theatrical, type 4 = digital, type 5 = physical
            const theatrical = frenchDates?.find(d => d.type === 3);
            if (theatrical) {
                frenchDate = theatrical.release_date;
            } else {
                frenchDates?.forEach((date) => {
                    if (date.note === '' || /CNC/i.test(date.note) || date.note === 'Netflix' || date.note === 'Amazon' || date.note === 'Disney+') {
                        frenchDate = date.release_date;
                    }
                });
            }

            return frenchDate ? formateDate(frenchDate) : null;
        } catch (error) {
            console.error('Erreur de récupération des dates', error);
        }
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

    const getMovies = async () => {
        const { data, error } = await client.from('calendar').select('*');
        if (!error) {
            const withDates = await Promise.all(
                data.map(async (movie) => ({
                    ...movie,
                    release_date: await getReleaseDateFromId(movie.movie_id),
                }))
            );
            movies.value = withDates;
            sortMovies(withDates);
        }
    }

    const handleMovieAdded = async (event) => {
        const newEntry = event.detail?.newEntry;
        if (!newEntry) return;
        const release_date = await getReleaseDateFromId(newEntry.movie_id);
        movies.value = [...movies.value, { ...newEntry, release_date }];
        sortMovies(movies.value);
    }

    const handleMovieExists = (event) => event.detail?.movieId

    const handleMovieDeleted = (id) => {
        movies.value = movies.value.filter(m => m.id !== id);
        sortMovies(movies.value);
    }

    watch(() => store.filters, () => sortMovies(movies.value), { deep: true });

    return {
        movies,
        sortedMovies,
        moviesWithoutDate,
        getMovies,
        getReleaseDateFromId,
        sortMovies,
        handleMovieAdded,
        handleMovieExists,
        handleMovieDeleted,
    }
}
