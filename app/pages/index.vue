<script setup>

definePageMeta({
    middleware: ['auth'],
})
useHead({ title: 'Mon calendrier' })

const { movies, sortedMovies, moviesWithoutDate, getMovies, handleMovieAdded, handleMovieExists, handleMovieDeleted } = useMovieCalendar()
const { scrollToClosestDate, scrollToMovie, handleScrollToYear, handleSearchMovie } = useMovieScroll()

const onMovieAdded = async (event) => {
    await handleMovieAdded(event);
    await nextTick();
    scrollToMovie(event.detail?.newEntry?.movie_id);
}

const onMovieExists = (event) => {
    const movieId = handleMovieExists(event);
    if (movieId) scrollToMovie(movieId);
}

onMounted(async () => {
    window.addEventListener('movie-added', onMovieAdded)
    window.addEventListener('movie-exists', onMovieExists)
    window.addEventListener('scroll-to-today', scrollToClosestDate)
    window.addEventListener('search-movie', handleSearchMovie)
    window.addEventListener('scroll-to-year', handleScrollToYear)
    await getMovies()
    scrollToClosestDate()
})

onBeforeUnmount(() => {
    window.removeEventListener('movie-added', onMovieAdded)
    window.removeEventListener('movie-exists', onMovieExists)
    window.removeEventListener('scroll-to-today', scrollToClosestDate)
    window.removeEventListener('search-movie', handleSearchMovie)
    window.removeEventListener('scroll-to-year', handleScrollToYear)
})
</script>

<template>
    <div class="home-wrapper wrapper -large -padded">
        <div class="year-container" v-for="(months, year) in sortedMovies" :key="year" :data-year="year">
            <div class="title-4">{{ year }}</div>
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
</style>
