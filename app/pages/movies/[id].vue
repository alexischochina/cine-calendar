<script setup lang="ts">
import type { Movie } from '~/types/Movie';

definePageMeta({ layout: 'bare' });

const route = useRoute();
const movieId = computed(() => route.params.id);

const {data} = await useFetch<Movie>(`/api/movies/${movieId.value}`);
</script>

<template>
    <div class="page-search">
        <div class="wrapper -medium -padded">
            <div class="title-2">{{ data?.title }}</div>
            <div class="flex" v-for="genre in data?.genres" :key="genre.id">{{ genre.name }}</div>
            <NuxtImg v-if="data?.poster_path" :src="`https://image.tmdb.org/t/p/w500${data.poster_path}`"
                     :alt="`Affiche du film ${data?.title}`"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>

</style>