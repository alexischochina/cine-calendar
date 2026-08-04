<script setup>

definePageMeta({
    middleware: ['auth'],
})
useHead({ title: 'Mon calendrier' })

const { movies, sortedMovies, moviesWithoutDate, getMovies, handleMovieAdded, handleMovieExists, handleMovieDeleted, handleReleaseDateUpdated, setCatchup, refreshLetterboxdRatings, addCatchupMovie } = useMovieCalendar()
const { closestMovie, searchMovie, scrollToMovie, scrollToTop } = useMovieScroll(movies)

const currentYear = new Date().getFullYear();
// Année (ou "Sans date" = null) affichée. Comme la maquette : on ne rend qu'une année à la fois.
const selectedYear = ref(currentYear);
const mobileYearMenu = ref(false);
// Vue principale : timeline (calendrier) ou stats (statistiques de l'année sélectionnée).
const viewMode = ref('timeline');
const selectView = (mode) => { viewMode.value = mode; };

const yearOfMovie = (m) => {
    if (!m?.release_date) return null;
    const d = new Date(m.release_date);
    return isNaN(d) ? null : d.getFullYear();
};

// Mois de l'année sélectionnée (null = section « Sans date »).
const monthsOfYear = computed(() =>
    selectedYear.value === null ? null : (sortedMovies.value[selectedYear.value] || {})
);
const hasContent = computed(() =>
    selectedYear.value === null
        ? moviesWithoutDate.value.length > 0
        : Object.keys(monthsOfYear.value).length > 0
);

// Films actuellement en salle (rail droit + bande mobile), triés par date.
const cinemaNow = computed(() =>
    movies.value
        .filter(m => m.state === 'inTheaters')
        .sort((a, b) => new Date(a.release_date) - new Date(b.release_date))
);

// Années disponibles + compteurs (rail gauche / menu mobile).
const yearList = computed(() => {
    const out = [];
    for (const [year, months] of Object.entries(sortedMovies.value)) {
        let count = 0;
        for (const days of Object.values(months))
            for (const list of Object.values(days)) count += list.length;
        out.push({ year: Number(year), label: year, count });
    }
    out.sort((a, b) => a.year - b.year);
    if (moviesWithoutDate.value.length)
        out.push({ year: null, label: 'Sans date', count: moviesWithoutDate.value.length });
    return out;
});

const selectedYearLabel = computed(() => selectedYear.value === null ? 'Sans date' : String(selectedYear.value));

const selectYear = (year) => {
    selectedYear.value = year;
    mobileYearMenu.value = false;
    nextTick(() => scrollToTop());
};

// Va sur un film : bascule sur son année puis scrolle jusqu'à lui.
const goToMovie = (movieId) => {
    const movie = movies.value.find(m => m.movie_id === Number(movieId));
    if (!movie) return;
    selectedYear.value = yearOfMovie(movie);
    nextTick(() => scrollToMovie(movieId));
};

const onScrollToToday = () => {
    const target = closestMovie();
    if (!target) { selectedYear.value = currentYear; return; }
    goToMovie(target.movie_id);
};

const onSearch = (event) => {
    const best = searchMovie(event.detail?.term);
    if (best) goToMovie(best.movie_id);
};

const onMovieAdded = async (event) => {
    await handleMovieAdded(event);
    goToMovie(event.detail?.newEntry?.movie_id);
}

const onMovieExists = (event) => {
    const movieId = handleMovieExists(event);
    if (movieId) goToMovie(movieId);
}

const onStatsGoToMovie = (movieId) => {
    selectView('timeline');
    nextTick(() => goToMovie(movieId));
}

// Notice éphémère « ajouté à la liste de <année> » (le film peut viser une autre année).
const catchupNotice = ref(null);
let catchupNoticeTimer = null;
const notifyCatchup = (title, yearLabel) => {
    catchupNotice.value = { title, yearLabel };
    if (catchupNoticeTimer) clearTimeout(catchupNoticeTimer);
    catchupNoticeTimer = setTimeout(() => { catchupNotice.value = null; }, 4500);
};

// Ajout depuis Stats : on reste sur l'onglet Stats. La liste étant par année, un film qui sort
// une autre année atterrit dans la liste de SON année → on le signale (sinon il semble ne pas s'ajouter).
const onAddCatchupMovie = async (payload) => {
    const entry = await addCatchupMovie(payload);
    if (entry) await handleMovieAdded({ detail: { newEntry: entry } });

    const movie = movies.value.find(m => m.movie_id === Number(payload.movieId));
    if (!movie) return;
    // Année d'atterrissage : année de sortie si datée, sinon année cible catchup_year (film sans date FR).
    const landingYear = yearOfMovie(movie) ?? movie.catchup_year ?? null;
    if (landingYear !== selectedYear.value) {
        notifyCatchup(movie.title || 'Le film', landingYear === null ? 'Sans date' : String(landingYear));
    }
}

// Rafraîchit les notes Letterboxd une fois par (ouverture Stats, année) — jamais côté timeline.
watch([viewMode, selectedYear], ([mode, year]) => {
    if (mode === 'stats' && year !== null) refreshLetterboxdRatings(year);
});

onMounted(async () => {
    window.addEventListener('movie-added', onMovieAdded)
    window.addEventListener('movie-exists', onMovieExists)
    window.addEventListener('scroll-to-today', onScrollToToday)
    window.addEventListener('search-movie', onSearch)
    await getMovies()
    onScrollToToday()
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
                    @select-year="selectYear" @select-view="selectView" />

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

        <div class="shell-main">
            <CinemaNowPanel v-if="viewMode === 'timeline'" class="shell-band" variant="band" :movies="cinemaNow" @select-movie="goToMovie" />

            <StatsView v-if="viewMode === 'stats'" :movies="movies" :year="selectedYear"
                       @go-to-movie="onStatsGoToMovie" @toggle-catchup="setCatchup" @add-catchup-movie="onAddCatchupMovie" />

            <TimelineList v-else :selected-year="selectedYear" :months-of-year="monthsOfYear"
                          :movies-without-date="moviesWithoutDate" :has-content="hasContent"
                          @movie-deleted="handleMovieDeleted" @release-date-updated="handleReleaseDateUpdated"
                          @toggle-catchup="setCatchup" />
        </div>

        <CinemaNowPanel v-if="viewMode === 'timeline'" class="shell-rail -right" variant="rail" :movies="cinemaNow" @select-movie="goToMovie" />

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
                        type="button" @click="selectYear(y.year)">
                    <span>{{ y.label }}</span>
                    <span class="count">{{ y.count }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.timeline-shell {
    display: flex;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;

    .shell-main {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
}

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
        .timeline { padding: 0 0 11rem; }
    }

    .shell-mobilehead { display: block; }

    .month-head {
        padding: 1.4rem 1.8rem .8rem;

        > .name { font-size: 1.5rem; }
    }
}

@media (min-width: 1000px) {
    .timeline-shell .shell-band { display: none; }
}
</style>
