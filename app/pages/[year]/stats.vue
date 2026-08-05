<script setup>
// `key: 'stats'` constant sur l'année → changer d'année réutilise l'instance et les barres de
// StatsMeter transitionnent leur largeur (pas de reset).
definePageMeta({ key: 'stats', middleware: ['auth', 'valid-year'] })
useHead({ title: 'Statistiques' })

const { movies, setCatchup } = useMovieCalendar()
const { selectedYear, goToMovie } = useCalendarNav()
const { onAddCatchupMovie } = useCatchupFlow()
</script>

<template>
    <StatsView :movies="movies" :year="selectedYear"
               @go-to-movie="goToMovie" @toggle-catchup="setCatchup" @add-catchup-movie="onAddCatchupMovie" />
</template>
