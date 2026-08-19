// Année + vue dérivées de la route, navigation et scroll. Partagé layout ↔ pages.

// Vues qui vivent hors année, et leur route. **Source unique** de cette liste : la dupliquer la
// ferait diverger au prochain onglet ajouté, et le symptôme serait une navigation vers
// `/2026/evenements`, qui n'existe pas.
//
// Hors de la fonction pour que la partition soit lisible sans instancier le composable : le rail
// gauche reçoit sa vue en prop et ne peut pas passer par le `computed` lié à la route.
const YEARLESS_VIEWS = { seances: '/seances', events: '/evenements' }

// « Vues ville » (Séances, Événements) contre « vues de la liste » (Timeline, Stats) : les deux
// familles n'ont pas le même contexte dans le rail ni le même en-tête mobile.
export const isYearlessView = (mode) => Boolean(YEARLESS_VIEWS[mode])
export const isLibraryView = (mode) => !isYearlessView(mode)

export function useCalendarNav() {
    const route = useRoute()
    const store = useMoviesStore()
    const { movies } = useMovieCalendar()
    const { scrollToMovie, scrollToTop, closestMovie, searchMovie } = useMovieScroll(movies)

    const currentYear = new Date().getFullYear()

    // `/seances` et `/evenements` vivent à la racine : sémantiquement juste (ces vues ne dépendent
    // d'aucune année), mais la route ne porte alors aucun param `year`. Sans mémoire, `selectedYear`
    // retomberait à null et le shell surlignerait « Sans date » dans le rail comme dans la pastille
    // mobile.
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

    // Noms de route Nuxt : `year-timeline` / `year-stats` / `seances` / `evenements`. Lecture
    // explicite plutôt qu'un `endsWith` : à quatre vues, deviner la vue par son suffixe est un piège.
    const VIEW_BY_ROUTE = { seances: 'seances', evenements: 'events', 'year-stats': 'stats' }
    const viewMode = computed(() => VIEW_BY_ROUTE[String(route.name || '')] ?? 'timeline')

    // Navigue vers la timeline de l'année du film, puis scrolle jusqu'à lui.
    const goToMovie = async (movieId) => {
        const movie = movies.value.find(m => m.movie_id === Number(movieId))
        if (!movie) return
        await navigateTo(`/${yearToSlug(yearOfMovie(movie))}/timeline`)
        await nextTick()
        scrollToMovie(movieId)
    }

    // Le rail → la vue Séances, cadrée sur ce film. L'identifiant passe par l'URL (et non par un
    // `useState`) pour que le lien soit partageable et surtout survive à un rechargement : la page
    // relit `?film` au montage.
    //
    // `date` : la journée à ouvrir, quand on clique un événement daté. Sans elle la vue s'ouvre sur
    // aujourd'hui et il faudrait retrouver le bon jour à la main — alors que la carte cliquée affichait
    // « dim. 16 août ». Omise pour un clic ordinaire depuis « Au ciné en ce moment ».
    const goToSeances = (movieId, date = null) =>
        navigateTo({
            path: '/seances',
            query: { film: String(movieId), ...(date ? { jour: String(date) } : {}) },
        })

    const goToEvents = () => navigateTo('/evenements')

    // La même partition, liée à la route — pour les appelants sans `viewMode` sous la main.
    const isCity = computed(() => isYearlessView(viewMode.value))
    const isLibrary = computed(() => !isCity.value)

    const selectYear = async (year) => {
        // `/2026/seances` n'existe pas : choisir une année depuis une vue hors année ramène sur sa
        // timeline.
        const mode = YEARLESS_VIEWS[viewMode.value] ? 'timeline' : viewMode.value
        await navigateTo(`/${yearToSlug(year)}/${mode}`)
        await nextTick()
        scrollToTop()
    }

    const selectView = (mode) => YEARLESS_VIEWS[mode]
        ? navigateTo(YEARLESS_VIEWS[mode])
        : navigateTo(`/${yearToSlug(selectedYear.value)}/${mode}`)

    const onScrollToToday = async () => {
        const target = closestMovie()
        if (!target) { await navigateTo(`/${currentYear}/timeline`); return }
        await goToMovie(target.movie_id)
    }

    const onSearch = (event) => {
        const best = searchMovie(event.detail?.term)
        if (!best) return

        // La recherche gagne sur les filtres : `searchMovie` cherche dans la liste entière, alors que
        // la timeline n'affiche que ce que les filtres laissent passer — sans cette levée, un titre
        // masqué mène à « Aucun film ne correspond. ». Seuls les filtres qui bloquent sont levés.
        for (const key of blockingFilters(best, store.filters)) store.filters[key] = null

        goToMovie(best.movie_id)
    }

    return {
        currentYear,
        selectedYear,
        viewMode,
        isLibrary,
        isCity,
        yearOfMovie,
        goToMovie,
        goToSeances,
        goToEvents,
        selectYear,
        selectView,
        onScrollToToday,
        onSearch,
    }
}
