<script setup>

definePageMeta({
    middleware: ['auth'],
})
useHead({ title: 'Mon calendrier' })

const { movies, sortedMovies, moviesWithoutDate, getMovies, handleMovieAdded, handleMovieExists, handleMovieDeleted } = useMovieCalendar()
const { scrollToClosestDate, scrollToMovie, handleScrollToYear, handleSearchMovie } = useMovieScroll()

const currentYear = new Date().getFullYear();
const expandedYears = ref([currentYear]);

const isYearExpanded = (year) => expandedYears.value.includes(Number(year));

const toggleYear = (year) => {
    const y = Number(year);
    if (isYearExpanded(y)) {
        expandedYears.value = expandedYears.value.filter(yr => yr !== y);
    } else {
        expandedYears.value = [...expandedYears.value, y];
    }
};

const expandYear = (year) => {
    const y = Number(year);
    if (!isYearExpanded(y)) expandedYears.value = [...expandedYears.value, y];
};

const onMovieAdded = async (event) => {
    await handleMovieAdded(event);
    await nextTick();
    scrollToMovie(event.detail?.newEntry?.movie_id);
}

const onMovieExists = (event) => {
    const movieId = handleMovieExists(event);
    if (movieId) scrollToMovie(movieId);
}

const onExpandYear = (e) => { if (e.detail?.year) expandYear(e.detail.year); };

onMounted(async () => {
    window.addEventListener('movie-added', onMovieAdded)
    window.addEventListener('movie-exists', onMovieExists)
    window.addEventListener('scroll-to-today', scrollToClosestDate)
    window.addEventListener('search-movie', handleSearchMovie)
    window.addEventListener('scroll-to-year', handleScrollToYear)
    window.addEventListener('expand-year', onExpandYear)
    await getMovies()
    scrollToClosestDate()
})

onBeforeUnmount(() => {
    window.removeEventListener('movie-added', onMovieAdded)
    window.removeEventListener('movie-exists', onMovieExists)
    window.removeEventListener('scroll-to-today', scrollToClosestDate)
    window.removeEventListener('search-movie', handleSearchMovie)
    window.removeEventListener('scroll-to-year', handleScrollToYear)
    window.removeEventListener('expand-year', onExpandYear)
})
</script>

<template>
    <div class="home-wrapper wrapper -large -padded">
        <div class="year-container" v-for="(months, year) in sortedMovies" :key="year" :data-year="year">
            <div class="year-header flex -align-center" @click="toggleYear(year)">
                <div class="title-4">{{ year }}</div>
                <span class="year-chevron" :class="{ '-expanded': isYearExpanded(year) }" />
            </div>
            <Transition name="year-content">
                <div v-show="isYearExpanded(year)" class="year-body">
                    <div class="month-container" v-for="(days, month) in months" :key="month">
                        <div class="month-title title-2" :class="{ '-sticky': Object.keys(days).length > 1 }">{{ month }}</div>
                        <div class="days-container">
                            <div class="day" v-for="(movies, day) in days" :key="day" :data-date="movies[0].release_date">
                                <MovieListItem v-for="(movie, index) in movies" :key="movie.id"
                                               :release-day="index === 0 ? day : ''"
                                               :movie-id="movie.movie_id"
                                               :media="movie.media"
                                               :state="movie.state"
                                               :id="movie.id"
                                               :style="new Date(movie.release_date) > new Date() ? { opacity: 0.5 } : {}"
                                               @movie-deleted="handleMovieDeleted"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>
        </div>

        <div class="no-date-section" v-if="moviesWithoutDate.length">
            <div class="title-4">Sans date</div>
            <MovieListItem v-for="movie in moviesWithoutDate"
                           :key="movie.id"
                           :release-day="''"
                           :movie-id="movie.movie_id"
                           :media="movie.media"
                           :state="movie.state"
                           :id="movie.id"
                           :style="{ opacity: 0.5 }"
                           @movie-deleted="handleMovieDeleted"
            />
        </div>
    </div>
</template>

<style lang="scss">
.home-wrapper {
    padding: 13rem 0;
    min-height: 100vh;
}

.year-header {
    gap: 1rem;
    padding: 1.5rem 0;
    border-top: 1px solid rgba($color-white, .2);
    cursor: pointer;
    user-select: none;

    &:first-child {
        border-top: none;
    }
}

.year-chevron {
    display: block;
    width: .9rem;
    height: .9rem;
    border-right: 2px solid rgba($color-white, .5);
    border-bottom: 2px solid rgba($color-white, .5);
    transform: rotate(45deg) translateY(-2px);
    transition: transform .2s $cubic-ease-out, border-color .2s ease;
    flex-shrink: 0;

    &.-expanded {
        transform: rotate(-135deg) translateY(-2px);
        border-color: $color-white;
    }
}

.month-container {
    display: grid;
    grid-template-columns: 15rem auto;
    border-top: 1px solid $color-white;
}

.month-title {
    padding: 2rem 0;
    text-transform: capitalize;

    &.-sticky {
        position: sticky;
        top: 2rem;
        align-self: start;
    }
}

.day:not(:last-child) {
    border-bottom: solid 1px $color-white;
}

.no-date-section {
    margin-top: 4rem;
    border-top: 1px solid $color-white;
    padding-top: 2rem;
}

// Year expand/collapse transition
.year-content-enter-active,
.year-content-leave-active {
    transition: opacity .2s ease;
}

.year-content-enter-from,
.year-content-leave-to {
    opacity: 0;
}

@media (hover: hover) {
    .year-header:hover .year-chevron {
        border-color: $color-white;
    }
}
</style>
