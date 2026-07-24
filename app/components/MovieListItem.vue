<script setup>
const emits = defineEmits(['movie-deleted', 'release-date-updated']);

const props = defineProps({
    releaseDay: {
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
    title: {
        type: String,
        default: '',
    },
    posterPath: {
        type: String,
        default: null,
    },
})
const selectedMedia = ref(props.media);
const selectedState = ref(props.state);
const client = useSupabaseClient();

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
</script>

<template>
    <div class="movie-list-item flex -align-center -justify-space-between"
         :class="[`-${selectedMedia}`, `-state-${selectedState}`, `-id-${props.movieId}`]">
        <div class="movie-infos flex -align-center">
            <div class="title-4">{{ props.releaseDay }}</div>
            <NuxtImg v-if="props.posterPath" :src="`https://image.tmdb.org/t/p/w500${props.posterPath}`" :alt="props.title ? `Affiche du film ${props.title}` : ''" class="poster" loading="lazy"/>
            <div v-else class="poster poster-placeholder"/>
            <a :href="`https://letterboxd.com/tmdb/${props.movieId}/`" target="_blank" rel="noopener" class="title-5 movie-link">{{ props.title }}</a>
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
    position: relative;
    padding: 1rem 3rem;
    width: 100%;

    // Single source of truth: only these states define --accent.
    // The streaming media list lives here once and nowhere else.
    &.-state-inTheaters {
        --accent: #{$color-primary};
    }

    &.-cinema.-state-seen {
        --accent: #{$color-green};
    }

    &.-state-seen:is(.-streaming, .-netflix, .-primeVideo, .-disney\+, .-vod) {
        --accent: #{$color-yellow};
    }

    // Tint + crisp full-height left bar, driven entirely by --accent.
    // With no accent set, both resolve to transparent → no visual change,
    // so this single block covers every row without duplicating selectors.
    background-color: color-mix(in srgb, var(--accent, transparent) 20%, transparent);

    &::before {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
        background-color: var(--accent, transparent);
        pointer-events: none; // decorative bar must not intercept clicks
        z-index: 1;
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
            color: $color-primary;
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