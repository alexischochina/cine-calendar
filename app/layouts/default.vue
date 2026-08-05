<script setup>
// Shell persistant (jamais démonté entre pages) : c'est ce qui fait glisser la pastille du switch
// de vue et charge le state une fois. Les pages ne rendent que le corps via <slot/>.
const store = useMoviesStore()
const {
    movies, sortedMovies, moviesWithoutDate,
    getMovies, sortMovies, setCatchup, refreshLetterboxdRatings,
    handleMovieAdded, handleMovieExists,
} = useMovieCalendar()

const {
    currentYear, selectedYear, viewMode,
    selectYear, selectView, goToMovie, onScrollToToday, onSearch,
} = useCalendarNav()

const { catchupNotice } = useCatchupFlow()
const { dispatchMovieAdded, dispatchMovieExists, dispatchScrollToToday, dispatchSearchMovie } = useNavEvents()

const mobileYearMenu = ref(false)

// Films actuellement en salle (rail droit + bande mobile), triés par date.
const cinemaNow = computed(() =>
    movies.value
        .filter(m => m.state === 'inTheaters')
        .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))
)

// Années disponibles + compteurs (rail gauche / menu mobile).
const yearList = computed(() => {
    const out = []
    for (const [year, months] of Object.entries(sortedMovies.value)) {
        let count = 0
        for (const days of Object.values(months))
            for (const list of Object.values(days)) count += list.length
        out.push({ year: Number(year), label: year, count })
    }
    out.sort((a, b) => a.year - b.year)
    if (moviesWithoutDate.value.length)
        out.push({ year: null, label: 'Sans date', count: moviesWithoutDate.value.length })
    return out
})

const selectedYearLabel = computed(() => selectedYear.value === null ? 'Sans date' : String(selectedYear.value))

const onSelectYear = (year) => {
    mobileYearMenu.value = false
    selectYear(year)
}

const onMovieAdded = async (event) => {
    await handleMovieAdded(event)
    goToMovie(event.detail?.newEntry?.movie_id)
}

const onMovieExists = (event) => {
    const movieId = handleMovieExists(event)
    if (movieId) goToMovie(movieId)
}

// Notes Letterboxd rafraîchies au passage en Stats / changement d'année en Stats.
watch([viewMode, selectedYear], ([mode, year]) => {
    if (mode === 'stats' && year !== null) refreshLetterboxdRatings(year)
})

// Re-tri au changement de filtres. Ici (instance persistante unique) et non dans le composable
// (appelé par plusieurs composants → doublons).
watch(() => store.filters, () => sortMovies(movies.value), { deep: true })

// Auto-dismiss de la notice catchup (timer possédé par le layout, la page stats ne fait que la poser).
let catchupNoticeTimer = null
watch(catchupNotice, (v) => {
    if (catchupNoticeTimer) clearTimeout(catchupNoticeTimer)
    if (v) catchupNoticeTimer = setTimeout(() => { catchupNotice.value = null }, 4500)
})

onMounted(async () => {
    window.addEventListener('movie-added', onMovieAdded)
    window.addEventListener('movie-exists', onMovieExists)
    window.addEventListener('scroll-to-today', onScrollToToday)
    window.addEventListener('search-movie', onSearch)
    await getMovies()
    // Landing par défaut (année courante, timeline) → cadre sur le film du jour ; deep-link respecté.
    if (viewMode.value === 'timeline' && selectedYear.value === currentYear) onScrollToToday()
    else if (viewMode.value === 'stats' && selectedYear.value !== null) refreshLetterboxdRatings(selectedYear.value)
})

onBeforeUnmount(() => {
    window.removeEventListener('movie-added', onMovieAdded)
    window.removeEventListener('movie-exists', onMovieExists)
    window.removeEventListener('scroll-to-today', onScrollToToday)
    window.removeEventListener('search-movie', onSearch)
    if (catchupNoticeTimer) clearTimeout(catchupNoticeTimer)
})
</script>

<template>
    <div class="timeline-shell">
        <NavSideNav class="shell-rail -left" :years="yearList" :active-year="selectedYear" :view-mode="viewMode"
                    @select-year="onSelectYear" @select-view="selectView" />

        <!-- En-tête mobile : titre + pastille année + segmented Timeline|Stats -->
        <div class="shell-mobilehead">
            <div class="top">
                <div class="brand">Ma cinémathèque</div>
                <button class="year-pill" type="button" aria-label="Choisir l'année" aria-haspopup="true"
                        :aria-expanded="mobileYearMenu" @click="mobileYearMenu = !mobileYearMenu">
                    {{ selectedYearLabel }}<Svg name="chevron" class="chev" aria-hidden="true" />
                </button>
            </div>
            <NavViewTabs :view-mode="viewMode" @select-view="selectView" />
        </div>

        <!-- `--rail-space` dépend seulement de la présence de films en salle (pas de la vue) → stable
             pendant un switch, donc la vue sortante ne se recomprime pas pendant le crossfade. -->
        <div class="shell-main" :style="{ '--rail-space': cinemaNow.length ? '26.4rem' : '0px' }">
            <CinemaNowPanel v-if="viewMode === 'timeline'" class="shell-band" variant="band" :movies="cinemaNow" @select-movie="goToMovie" />
            <slot />
        </div>

        <!-- Rail droit en overlay (hors flux) → largeur de shell-main constante entre les vues. -->
        <Transition name="rail">
            <CinemaNowPanel v-if="viewMode === 'timeline'" class="shell-rail -right" variant="rail" :movies="cinemaNow" @select-movie="goToMovie" />
        </Transition>

        <!-- Notice « ajouté à la liste à rattraper de <année> » -->
        <Transition name="notice">
            <div v-if="catchupNotice" class="catchup-notice" role="status">
                <span class="msg">« {{ catchupNotice.title }} » ajouté à ta liste à rattraper de
                    <strong>{{ catchupNotice.yearLabel }}</strong></span>
            </div>
        </Transition>

        <!-- Menu année (mobile) -->
        <div v-if="mobileYearMenu" class="year-overlay" @click="mobileYearMenu = false">
            <div class="year-sheet" role="dialog" aria-label="Choisir l'année" @click.stop>
                <button v-for="y in yearList" :key="y.label" class="year" :class="{ '-active': y.year === selectedYear }"
                        type="button" @click="onSelectYear(y.year)">
                    <span>{{ y.label }}</span>
                    <span class="count">{{ y.count }}</span>
                </button>
            </div>
        </div>

        <NavHeader @movie-added="dispatchMovieAdded" @movie-exists="dispatchMovieExists"
                   @scroll-to-today="dispatchScrollToToday" @search-movie="dispatchSearchMovie" />
    </div>
</template>

<style lang="scss" scoped>
.timeline-shell {
    position: relative; // contexte du rail overlay
    display: flex;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;

    .shell-main {
        position: relative; // ancre le crossfade (vue sortante en position absolute)
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
}

.shell-rail.-right {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
}

.rail-enter-active,
.rail-leave-active { transition: opacity .2s ease; }

.rail-enter-from,
.rail-leave-to { opacity: 0; }

// Menu année (mobile)
.year-overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 0 4rem;
    background: rgba(0, 0, 0, .5);

    .year-sheet {
        width: 26rem;
        background: $color-surface-2;
        border: 1px solid $color-border-4;
        border-radius: 1.6rem;
        padding: .8rem;
        animation: pop .16s ease;

        > .year {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            padding: 1.1rem 1.4rem;
            border-radius: 1rem;
            color: $color-text-muted;
            font: $normal 1.5rem/1 $font-body;
            cursor: pointer;

            > .count { font: $normal 1.1rem/1 $font-mono; color: $color-text-weak; }

            &.-active {
                background: rgba($color-primary, .14);
                color: $color-text;
                font-weight: $bold;

                > .count { color: $color-primary-light; }
            }
        }
    }
}

// En-tête mobile (masqué desktop)
.shell-mobilehead {
    display: none;
    flex: none;
    padding: 2.4rem 1.8rem 1rem;

    > .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.2rem;

        > .brand {
            color: $color-text;
            font: 800 2.1rem/1 $font-title;
            letter-spacing: -.05rem;
        }

        > .year-pill {
            display: flex;
            align-items: center;
            gap: .6rem;
            padding: .6rem 1rem;
            border-radius: 999px;
            background: $color-surface-3;
            border: 1px solid $color-border-3;
            color: $color-text-dim;
            font: $bold 1.2rem/1 $font-mono;
            cursor: pointer;

            > .chev { width: 1.3rem; height: 1.3rem; }
        }
    }
}

@keyframes pop {
    from { transform: scale(.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

// Notice « ajouté à la liste à rattraper de <année> »
.catchup-notice {
    position: fixed;
    left: 50%;
    bottom: 9rem;
    transform: translateX(-50%);
    z-index: 60;
    max-width: calc(100vw - 4rem);
    padding: 1.2rem 1.8rem;
    background: $color-surface-2;
    border: 1px solid $color-border-4;
    border-left: 3px solid $color-primary;
    border-radius: 1.2rem;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .6);

    > .msg {
        color: $color-text-dim;
        font: $normal 1.35rem/1.4 $font-body;

        > strong { color: $color-primary-light; font-weight: $bold; }
    }
}

.notice-enter-active,
.notice-leave-active { transition: opacity .2s ease, transform .2s ease; }

.notice-enter-from,
.notice-leave-to { opacity: 0; transform: translate(-50%, 1rem); }

@media (max-width: 999px) {
    .timeline-shell {
        flex-direction: column;

        .shell-rail { display: none; }
    }

    .shell-mobilehead { display: block; }
}

@media (min-width: 1000px) {
    .timeline-shell .shell-band { display: none; }
}
</style>
