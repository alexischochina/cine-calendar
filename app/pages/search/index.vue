<script setup>
import {refDebounced} from "@vueuse/shared";

const searchTerm = ref('');
const page = ref(1);

const debouncedSearchTerm = refDebounced(searchTerm, 700);

const url = computed(() => `api/movies/search?query=${encodeURIComponent(debouncedSearchTerm.value)}&page=${page.value}`);

const {data} = await useFetch(url)
</script>

<template>
    <div class="page-search">
        <div class="wrapper -medium -padded">
            <div class="title-2">Recherche</div>
            <input type="text" v-model="searchTerm" placeholder="Rechercher..." aria-label="Rechercher un film">
            <div class="grid">
                <div class="col -auto -one" v-for="movie in data?.results" :key="movie.id">
                    <div class="flex -direction-column">
                        <div class="title-4">{{ movie.title }}</div>
                        <NuxtImg class="poster" :src="`https://image.tmdb.org/t/p/w500${movie.poster_path}`"
                                 :alt="`Affiche du film ${movie.title}`" loading="lazy"/>
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