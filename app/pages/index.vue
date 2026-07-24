<script setup>

definePageMeta({
    middleware: ['auth'],
})
useHead({ title: 'Mon calendrier' })

const { movies, sortedMovies, moviesWithoutDate, getMovies, handleMovieAdded, handleMovieExists, handleMovieDeleted, handleReleaseDateUpdated } = useMovieCalendar()
const { closestMovie, searchMovie, scrollToMovie, scrollToTop } = useMovieScroll(movies)

const currentYear = new Date().getFullYear();
const scrollEl = ref(null);
// Année (ou "Sans date" = null) affichée. Comme la maquette : on ne rend qu'une année à la fois.
const selectedYear = ref(currentYear);
const mobileYearMenu = ref(false);

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

const monthCount = (days) => {
    const n = Object.values(days).reduce((acc, list) => acc + list.length, 0);
    return `${n} film${n > 1 ? 's' : ''}`;
};

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
})
</script>

<template>
    <div class="timeline-shell">
        <NavSideNav class="shell-rail -left" :years="yearList" :active-year="selectedYear" @select-year="selectYear" />

        <!-- En-tête mobile : titre + pastille année + segmented Timeline|Stats -->
        <div class="shell-mobilehead">
            <div class="top">
                <div class="brand">Ma cinémathèque</div>
                <button class="year-pill" type="button" aria-label="Choisir l'année" aria-haspopup="true"
                        :aria-expanded="mobileYearMenu" @click="mobileYearMenu = !mobileYearMenu">
                    {{ selectedYearLabel }}<Svg name="chevron" class="chev" aria-hidden="true" />
                </button>
            </div>
            <div class="tabs">
                <button class="tab -active" type="button"><Svg name="list" class="ico" />Timeline</button>
                <button class="tab -disabled" type="button" disabled aria-disabled="true" title="Bientôt disponible">
                    <Svg name="chart" class="ico" />Stats
                </button>
            </div>
        </div>

        <div class="shell-main">
            <CinemaNowPanel class="shell-band" variant="band" :movies="cinemaNow" @select-movie="goToMovie" />

            <div class="timeline scr" ref="scrollEl">
                <template v-if="hasContent">
                    <!-- Année datée : groupes de mois -->
                    <template v-if="selectedYear !== null">
                        <div class="month-group" v-for="(days, month) in monthsOfYear" :key="month">
                            <div class="month-head">
                                <span class="name">{{ month }}</span>
                                <span class="rule" />
                                <span class="count">{{ monthCount(days) }}</span>
                            </div>
                            <template v-for="(dayMovies, day) in days" :key="day">
                                <MovieListItem v-for="(movie, index) in dayMovies" :key="movie.id"
                                               :release-day="index === 0 ? String(day) : ''"
                                               :movie-id="movie.movie_id"
                                               :media="movie.media"
                                               :state="movie.state"
                                               :id="movie.id"
                                               :title="movie.title"
                                               :poster-path="movie.poster_path"
                                               :manual-release-date="movie.manual_release_date"
                                               :director="movie.director"
                                               @movie-deleted="handleMovieDeleted"
                                               @release-date-updated="handleReleaseDateUpdated" />
                            </template>
                        </div>
                    </template>

                    <!-- Sans date -->
                    <div class="month-group" v-else>
                        <MovieListItem v-for="movie in moviesWithoutDate" :key="movie.id"
                                       :release-day="''"
                                       :movie-id="movie.movie_id"
                                       :media="movie.media"
                                       :state="movie.state"
                                       :id="movie.id"
                                       :title="movie.title"
                                       :poster-path="movie.poster_path"
                                       :manual-release-date="movie.manual_release_date"
                                       :director="movie.director"
                                       @movie-deleted="handleMovieDeleted"
                                       @release-date-updated="handleReleaseDateUpdated" />
                    </div>
                </template>

                <div v-else class="empty">Aucun film ne correspond.</div>
            </div>
        </div>

        <CinemaNowPanel class="shell-rail -right" variant="rail" :movies="cinemaNow" @select-movie="goToMovie" />

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
        display: flex;
        flex-direction: column;
    }

    .timeline {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: .8rem 0 11rem;
    }

    .empty {
        padding: 8rem 3rem;
        text-align: center;
        color: $color-text-weak;
        font: $normal 1.4rem/1 $font-body;
    }
}

.month-head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: 1.6rem 2.4rem 1rem;
    background: rgba($color-bg, .92);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);

    > .name {
        color: $color-text;
        font: 800 1.7rem/1 $font-title;
        text-transform: capitalize;
    }

    > .rule {
        flex: 1;
        height: 1px;
        background: $color-border-2;
    }

    > .count {
        font: $normal 1.1rem/1 $font-mono;
        color: $color-text-weak;
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

    > .tabs {
        display: flex;
        gap: .4rem;
        background: $color-surface-1;
        border: 1px solid $color-border-2;
        border-radius: 1.1rem;
        padding: .4rem;

        > .tab {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: .6rem;
            padding: .8rem;
            border-radius: .8rem;
            color: $color-text-muted;
            font: $semi-bold 1.25rem/1 $font-body;
            cursor: pointer;

            > .ico { width: 1.5rem; height: 1.5rem; }

            &.-active { background: $color-primary; color: $color-white; }
            &.-disabled { cursor: default; opacity: .55; }
        }
    }
}

@keyframes pop {
    from { transform: scale(.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

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
