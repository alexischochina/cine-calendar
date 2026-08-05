<script setup>
// `key: 'timeline'` constant sur l'année → changer d'année ne remonte pas la page (seul le
// changement de vue déclenche la pageTransition).
definePageMeta({ key: 'timeline', middleware: ['auth', 'valid-year'] })
useHead({ title: 'Mon calendrier' })

const { sortedMovies, moviesWithoutDate, handleMovieDeleted, handleReleaseDateUpdated, setCatchup } = useMovieCalendar()
const { selectedYear } = useCalendarNav()

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
    <TimelineList :selected-year="selectedYear" :months-of-year="monthsOfYear"
                  :movies-without-date="moviesWithoutDate" :has-content="hasContent"
                  @movie-deleted="handleMovieDeleted" @release-date-updated="handleReleaseDateUpdated"
                  @toggle-catchup="setCatchup" />
</template>
