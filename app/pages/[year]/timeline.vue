<script setup>
// `key: 'timeline'` constant sur l'année → changer d'année ne remonte pas la page (seul le
// changement de vue déclenche la pageTransition).
definePageMeta({ key: 'timeline', middleware: ['auth', 'valid-year'] })
useHead({ title: 'Mon calendrier' })

const { sortedMovies, moviesWithoutDate, cinemaNow, handleMovieDeleted, handleReleaseDateUpdated, setCatchup } = useMovieCalendar()
const { selectedYear, goToMovie } = useCalendarNav()

// null = section « Sans date ».
const monthsOfYear = computed(() =>
    selectedYear.value === null ? null : (sortedMovies.value[selectedYear.value] || {})
)
const hasContent = computed(() =>
    selectedYear.value === null
        ? moviesWithoutDate.value.length > 0
        : Object.keys(monthsOfYear.value).length > 0
)
</script>

<template>
    <div class="timeline-page">
        <!-- Portée par la page et non par le shell : rendue par le layout, elle disparaîtrait
             dès le début du crossfade et ferait remonter la vue sortante d'un cran. -->
        <CinemaNowPanel class="band" variant="band" :movies="cinemaNow" @select-movie="goToMovie" />

        <TimelineList :selected-year="selectedYear" :months-of-year="monthsOfYear"
                      :movies-without-date="moviesWithoutDate" :has-content="hasContent"
                      @movie-deleted="handleMovieDeleted" @release-date-updated="handleReleaseDateUpdated"
                      @toggle-catchup="setCatchup" />
    </div>
</template>

<style lang="scss" scoped>
// `min-height: 0` pour que la liste puisse rétrécir sous sa hauteur de contenu et scroller.
.timeline-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

@media (min-width: 1000px) {
    .timeline-page > .band { display: none; }
}
</style>
