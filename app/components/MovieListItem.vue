<script setup>
const emits = defineEmits(['movie-deleted']);

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

const deleteMovie = async () => {
    const { error } = await client.from('calendar').delete().eq('id', props.id);
    if (!error) emits('movie-deleted', props.id);
}

const updateState = async (newState) => {
    const {data, error} = await client
        .from('calendar')
        .update({state: newState})
        .eq('id', props.id)
}

const getMovieById = async (id) => {
    const movieData = await $fetch(`/api/movies/${id}`);
    if (movieData) {
        movieTitle.value = movieData.title;
        moviePosterUrl.value = movieData.poster_path;
    }
}

onMounted(() => {
    getMovieById(props.movieId);
});
</script>

<template>
    <div class="movie-list-item flex -align-center -justify-space-between"
         :class="`-${selectedMedia} -id-${props.movieId}`">
        <div class="movie-infos flex -align-center">
            <div class="title-4">{{ props.releaseDay }}</div>
            <NuxtImg v-if="moviePosterUrl" :src="`https://image.tmdb.org/t/p/w500${moviePosterUrl}`" class="poster"/>
            <div v-else class="poster poster-placeholder"/>
            <a :href="`https://letterboxd.com/tmdb/${props.movieId}/`" target="_blank" rel="noopener" class="title-5 movie-link">{{ movieTitle }}</a>
        </div>
        <div class="stream-infos flex -align-center">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"/>
            <SelectBtn type="state" :selected="selectedState" @option-selected="onStateSelected"/>
            <button class="delete-btn" @click="deleteMovie">
                <Svg name="close"/>
            </button>
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
    aspect-ratio: 2/3;
}

.poster-placeholder {
    background-color: $color-dark-grey;
}

.stream-infos {
    gap: 3rem;
}

.delete-btn {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear;
    flex-shrink: 0;

    > svg {
        width: 1.4rem;
        height: auto;
    }

    @media (hover: hover) {
        &:hover {
            background-color: $color-dark-grey;
        }
    }
}

.title-4 {
    min-width: 5rem;
}

.movie-link {
    text-decoration: none;
    color: inherit;
    transition: color .2s linear;

    @media (hover: hover) {
        &:hover {
            color: #ec008b;
        }
    }
}
</style>