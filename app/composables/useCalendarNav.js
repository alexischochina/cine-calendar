// Année + vue dérivées de la route, navigation et scroll. Partagé layout ↔ pages.
export function useCalendarNav() {
    const route = useRoute()
    const { movies } = useMovieCalendar()
    const { scrollToMovie, scrollToTop, closestMovie, searchMovie } = useMovieScroll(movies)

    const currentYear = new Date().getFullYear()

    const selectedYear = computed(() => {
        const y = parseYearParam(route.params.year)
        return y === undefined ? null : y
    })
    // Noms de route Nuxt : `year-timeline` / `year-stats`.
    const viewMode = computed(() => String(route.name || '').endsWith('stats') ? 'stats' : 'timeline')

    // Navigue vers la timeline de l'année du film, puis scrolle jusqu'à lui.
    const goToMovie = async (movieId) => {
        const movie = movies.value.find(m => m.movie_id === Number(movieId))
        if (!movie) return
        await navigateTo(`/${yearToSlug(yearOfMovie(movie))}/timeline`)
        await nextTick()
        scrollToMovie(movieId)
    }

    const selectYear = async (year) => {
        await navigateTo(`/${yearToSlug(year)}/${viewMode.value}`)
        await nextTick()
        scrollToTop()
    }

    const selectView = (mode) => navigateTo(`/${yearToSlug(selectedYear.value)}/${mode}`)

    const onScrollToToday = async () => {
        const target = closestMovie()
        if (!target) { await navigateTo(`/${currentYear}/timeline`); return }
        await goToMovie(target.movie_id)
    }

    const onSearch = (event) => {
        const best = searchMovie(event.detail?.term)
        if (best) goToMovie(best.movie_id)
    }

    return {
        currentYear,
        selectedYear,
        viewMode,
        yearOfMovie,
        goToMovie,
        selectYear,
        selectView,
        onScrollToToday,
        onSearch,
    }
}
