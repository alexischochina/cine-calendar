<script setup>
const handleMovieAdded = ((newEntry) => {
    window.dispatchEvent(new CustomEvent('movie-added', { detail: { newEntry } }));
})

const handleMovieExists = ((movieId) => {
    window.dispatchEvent(new CustomEvent('movie-exists', { detail: { movieId } }));
})

const handleScrollToToday = () => {
    window.dispatchEvent(new CustomEvent('scroll-to-today'));
}

const handleSearchMovie = (term) => {
    window.dispatchEvent(new CustomEvent('search-movie', { detail: { term } }));
}

</script>

<template>
    <div class="default">
        <NavHeader @movie-added="handleMovieAdded" @movie-exists="handleMovieExists" @scroll-to-today="handleScrollToToday" @search-movie="handleSearchMovie"/>
        <slot/>
    </div>
</template>

<style lang="scss" scoped>

</style>