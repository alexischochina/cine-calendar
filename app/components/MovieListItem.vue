<script setup>
const emits = defineEmits(['movie-deleted', 'release-date-updated']);

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
        validator: value => ['unseen', 'seen', 'downloadAvailable', 'inTheaters'].includes(value)
    },
    id: {
        type: Number,
        required: true,
    },
    manualReleaseDate: {
        type: String,
        default: null,
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
         :class="[`-${selectedMedia}`, `-state-${selectedState}`, `-id-${props.movieId}`]">
        <div class="movie-infos flex -align-center">
            <div class="title-4">{{ props.releaseDay }}</div>
            <NuxtImg v-if="moviePosterUrl" :src="`https://image.tmdb.org/t/p/w500${moviePosterUrl}`" class="poster"/>
            <div v-else class="poster poster-placeholder"/>
            <a :href="`https://letterboxd.com/tmdb/${props.movieId}/`" target="_blank" rel="noopener" class="title-5 movie-link">{{ movieTitle }}</a>
        </div>
        <div class="stream-infos flex -align-center">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"/>
            <SelectBtn type="state" :selected="selectedState" @option-selected="onStateSelected"/>
            <MovieActionsBtn :id="props.id" :manual-release-date="manualReleaseDate"
                             @movie-deleted="emits('movie-deleted', $event)"
                             @release-date-updated="emits('release-date-updated', $event)"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.movie-list-item {
    padding: 1rem 3rem;
    width: 100%;

    &.-state-inTheaters {
        background-color: rgba(#ec008b, .12);
        box-shadow: inset 3px 0 0 #ec008b;
    }
}

.movie-infos {
    gap: 3rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.poster {
    border-radius: .5rem;
    width: 5rem;
    aspect-ratio: 2 / 3;
    flex-shrink: 0;
}

.poster-placeholder {
    background-color: $color-dark-grey;
}

.stream-infos {
    gap: 3rem;
    flex-shrink: 0;
}

.title-4 {
    width: 3rem;
    text-align: right;
    flex-shrink: 0;
}

.movie-link {
    display: block;
    text-decoration: none;
    color: inherit;
    transition: color .2s linear;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    @media (hover: hover) {
        &:hover {
            color: #ec008b;
        }
    }
}

@media (max-width: 1024px) {
    .movie-list-item {
        padding: 1rem 2rem;
    }

    .movie-infos {
        gap: 1.5rem;
        flex: 1;
    }

    .stream-infos {
        gap: 1.5rem;
    }
}

@media (max-width: 767px) {
    .movie-list-item {
        padding: .6rem var(--wrapper-padding);
    }

    .poster {
        display: none;
    }

    .movie-infos {
        gap: 1.5rem;
    }

    .title-4 {
        width: 2.5rem;
    }

    .movie-link {
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .stream-infos {
        gap: .5rem;
    }
}
</style>