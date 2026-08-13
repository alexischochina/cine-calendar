// Année + vue dérivées de la route, navigation et scroll. Partagé layout ↔ pages.
export function useCalendarNav() {
    const route = useRoute()
    const { movies } = useMovieCalendar()
    const { scrollToMovie, scrollToTop, closestMovie, searchMovie } = useMovieScroll(movies)

    const currentYear = new Date().getFullYear()

    // `/seances` vit à la racine : sémantiquement juste (la vue ne dépend d'aucune année), mais
    // la route ne porte alors aucun param `year`. Sans mémoire, `selectedYear` retomberait à null
    // et le shell surlignerait « Sans date » dans le rail comme dans la pastille mobile.
    const lastSelectedYear = useState('lastSelectedYear', () => currentYear)

    // `undefined` = la route ne porte pas d'année (ou une année invalide) ; `null` = « Sans date »,
    // qui est une sélection légitime — les deux ne se confondent pas.
    const routeYear = computed(() => parseYearParam(route.params.year))
    watch(routeYear, (year) => {
        if (year !== undefined) lastSelectedYear.value = year
    }, { immediate: true })

    const selectedYear = computed(() =>
        routeYear.value === undefined ? lastSelectedYear.value : routeYear.value
    )

    // Noms de route Nuxt : `year-timeline` / `year-stats` / `seances`. Lecture explicite plutôt
    // qu'un `endsWith` : à trois vues, deviner la vue par son suffixe devient un piège.
    const VIEW_BY_ROUTE = { seances: 'seances', 'year-stats': 'stats' }
    const viewMode = computed(() => VIEW_BY_ROUTE[String(route.name || '')] ?? 'timeline')

    // Navigue vers la timeline de l'année du film, puis scrolle jusqu'à lui.
    const goToMovie = async (movieId) => {
        const movie = movies.value.find(m => m.movie_id === Number(movieId))
        if (!movie) return
        await navigateTo(`/${yearToSlug(yearOfMovie(movie))}/timeline`)
        await nextTick()
        scrollToMovie(movieId)
    }

    // « Au ciné en ce moment » → la vue Séances, cadrée sur ce film. L'identifiant passe par l'URL
    // (et non par un `useState`) pour que le lien soit partageable et surtout survive à un
    // rechargement : la page relit `?film` au montage.
    const goToSeances = (movieId) =>
        navigateTo({ path: '/seances', query: { film: String(movieId) } })

    const selectYear = async (year) => {
        // `/2026/seances` n'existe pas : choisir une année depuis Séances ramène sur sa timeline.
        const mode = viewMode.value === 'seances' ? 'timeline' : viewMode.value
        await navigateTo(`/${yearToSlug(year)}/${mode}`)
        await nextTick()
        scrollToTop()
    }

    const selectView = (mode) => mode === 'seances'
        ? navigateTo('/seances')
        : navigateTo(`/${yearToSlug(selectedYear.value)}/${mode}`)

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
        goToSeances,
        selectYear,
        selectView,
        onScrollToToday,
        onSearch,
    }
}
