<script setup lang="ts">
import {refDebounced} from "@vueuse/shared";
import type {ApiResponse} from "~/types/APIReponse";

const searchTerm = ref('');

const page = ref(1);

// Disable pagination depending on first or last page
const disabledPrevious = computed(() => {
    return page.value === 1;
})
const disabledNext = computed(() => {
    return page.value + 1 === data.value?.total_pages;
})

// Create a debounced version of searchTerm
const debouncedSearchTerm = refDebounced(searchTerm, 700);

// replace the url with the debounced version
const url = computed(() => {
    return `api/movies/search?query=${debouncedSearchTerm.value}&page=${page.value}`;
});

const {data} = await useFetch<ApiResponse>(url)

</script>

<template>
    <div class="page-search">
        <div class="wrapper -medium -padded">
            <div class="title-2">Page recherche</div>
            <input type="text" v-model="searchTerm" placeholder="Rechercher...">
            <div class="grid">
                <div class="col -auto -one" v-for="movie in data?.results">
                    <div class="flex -direction-column">
                        <div class="title-4">{{ movie.title }}</div>
                        <NuxtImg class="poster" :src="`https://image.tmdb.org/t/p/w500${movie.poster_path}`"/>
                        <NuxtLink :to="`movies/${movie.id}`">Plus d'infos</NuxtLink>
                    </div>

                </div>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.poster {
    max-width: 10rem;
}

.grid {
    --grid-col-number: 4;
}
</style>