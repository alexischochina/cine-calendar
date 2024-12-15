<script setup>
const handleMovieAdded = (() => {
    const event = new CustomEvent('movie-added');
    window.dispatchEvent(event);
})
</script>

<template>
    <div class="default">
        <NavHeader @movie-added="handleMovieAdded"/>
        <slot/>
    </div>
</template>

<style lang="scss" scoped>

</style>