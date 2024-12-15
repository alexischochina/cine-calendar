<script setup>
const props = defineProps({
    releaseDay: {
        type: String,
    },
    poster: {
        type: String,
    },
    movieId: {
        type: Number,
    },
    media: {
        type: String,
        default: 'unknown',
        validator: value => ['cinema', 'streaming', 'netflix', 'primeVideo', 'disney+', 'vod'].includes(value)
    },
    state: {
        type: String,
        default: 'unseen',
        validator: value => ['unseen', 'seen', 'downloadAvailable'].includes(value)
    },
    id: {
        type: Number,
        required: true,
    },
})
const selectedMedia = ref(props.media);
const selectedState = ref(props.state);
const client = useSupabaseClient();
const config = useRuntimeConfig();
const movieTitle = ref('');
const moviePosterUrl = ref('');

const onMediaSelected = (option) => {
    selectedMedia.value = option;
    updateMedia(option)
}

const onStateSelected = (option) => {
    selectedState.value = option;
    updateState(option);
}

const updateMedia = async (newMedia) => {
    const {data, error} = await client
        .from('calendar')
        .update({media: newMedia})
        .eq('id', props.id)
}

const updateState = async (newState) => {
    const {data, error} = await client
        .from('calendar')
        .update({state: newState})
        .eq('id', props.id)
}

const getMovieById = async (id) => {
    const {data: movieData} = await useFetch(`/api/movies/${id}`);

    if (movieData.value) {
        movieTitle.value = movieData.value.title;
        moviePosterUrl.value = movieData.value.poster_path
    }
}

const getDayFrom = ((fullDate) => {
    const date = new Date(fullDate)
    return date.getDate();
})

onMounted(() => {
    getMovieById(props.movieId);
});
</script>

<template>
    <div class="movie-list-item flex -align-center -justify-space-between"
         :class="`-${selectedMedia} -id-${props.movieId}`">
        <div class="movie-infos flex -align-center">
            <div class="title-4">{{ props.releaseDay }}</div>
            <NuxtImg :src="`https://image.tmdb.org/t/p/w500${moviePosterUrl}`" class="poster"/>
            <div class="title-5">{{ movieTitle }}</div>
        </div>
        <div class="stream-infos flex -align-center">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"/>
            <SelectBtn type="state" :selected="selectedState" @option-selected="onStateSelected"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.movie-list-item {
    padding: 1rem 3rem;
    width: 100%;
}

.movie-infos {
    gap: 3rem;
}

.poster {
    border-radius: .5rem;
    width: 5rem;
}

.stream-infos {
    gap: 3rem;

    > svg {
        width: 3.5rem;
        height: auto;
    }
}

.title-4 {
    min-width: 5rem;
}
</style>