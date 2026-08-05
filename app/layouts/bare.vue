<script setup>
// Layout minimal (search, détail film) : uniquement la nav flottante, pas le shell timeline.
const { dispatchMovieAdded, dispatchMovieExists, dispatchScrollToToday, dispatchSearchMovie } = useNavEvents()
</script>

<template>
    <div class="bare">
        <NavHeader @movie-added="dispatchMovieAdded" @movie-exists="dispatchMovieExists"
                   @scroll-to-today="dispatchScrollToToday" @search-movie="dispatchSearchMovie" />
        <slot />
    </div>
</template>
