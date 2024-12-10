<script setup lang="ts">
import type { Movie } from '~/types/Movie';

const route = useRoute();
const config = useRuntimeConfig();
const movieId = computed(() => route.params.id);

const imgUrl = computed(() => data.value?.poster_path ? `${config.public.imgBaseUrl}/${data.value?.poster_path}` : 'https://via.placeholder.com/300x500');

const {data} = await useFetch<Movie>(`/api/movies/${movieId.value}`);
console.log(data.value)
</script>

<template>
    <div class="page-search">
        <div class="wrapper -medium -padded">
            <div class="title-2">Page d'un film</div>
            <div class="title-4">" {{ data?.title }} "</div>
            <div class="flex" v-for="genre in data?.genres">{{ genre.name }}</div>
            <NuxtImg :src="`https://image.tmdb.org/t/p/w500${data?.poster_path}`"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>

</style>