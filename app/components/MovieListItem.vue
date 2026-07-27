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
    director: {
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
    await client.from('calendar').update({ media: newMedia }).eq('id', props.id)
}

const updateState = async (newState) => {
    await client.from('calendar').update({ state: newState }).eq('id', props.id)
}

// Sous-titre de droite : réalisateur si connu, sinon libellé état/média (cf. plan « sub »).
const MEDIA_LABELS = { cinema: 'Cinéma', netflix: 'Netflix', primeVideo: 'Prime Video', 'disney+': 'Disney+', streaming: 'Streaming', vod: 'Streaming', unknown: 'Streaming' };
// En salle : on garde le nom du réal dans le sous-titre, le badge « En salle » se cale à droite du titre (cf. template).
const isInTheaters = computed(() => selectedState.value === 'inTheaters');
const sub = computed(() => {
    const dir = props.director;
    if (selectedState.value === 'seen') return dir || MEDIA_LABELS[selectedMedia.value] || 'Streaming';
    if (selectedState.value === 'inTheaters') return dir || MEDIA_LABELS[selectedMedia.value] || 'Cinéma';
    if (selectedState.value === 'downloadAvailable') return dir || 'Dispo en téléchargement';
    return dir || 'Envie de voir';
});
</script>

<template>
    <div class="movie-list-item"
         :class="[`-${selectedMedia}`, `-state-${selectedState}`, `-id-${props.movieId}`]">
        <div class="day">{{ props.releaseDay }}</div>
        <NuxtImg v-if="props.posterPath" :src="`https://image.tmdb.org/t/p/w342${props.posterPath}`"
                 :alt="props.title ? `Affiche du film ${props.title}` : ''" class="poster" loading="lazy" />
        <div v-else class="poster -placeholder" />
        <div class="info">
            <div class="title-row">
                <a :href="`https://letterboxd.com/tmdb/${props.movieId}/`" target="_blank" rel="noopener" class="title">{{ props.title }}</a>
                <span v-if="isInTheaters" class="badge">En salle</span>
            </div>
            <div class="sub">{{ sub }}</div>
        </div>
        <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected" />
        <SelectBtn type="state" :selected="selectedState" @option-selected="onStateSelected" />
        <MovieActionsBtn :id="props.id" :manual-release-date="manualReleaseDate"
                         @movie-deleted="emits('movie-deleted', $event)"
                         @release-date-updated="emits('release-date-updated', $event)" />
    </div>
</template>

<style lang="scss" scoped>
.movie-list-item {
    display: flex;
    align-items: center;
    gap: 1.4rem;
    padding: 1.1rem 2.2rem 1.1rem 1.9rem;
    // Bord gauche 3px + fond teinté, pilotés par l'état. Défaut = gris « à venir ».
    --accent: #{$color-status-grey};
    border-left: 3px solid var(--accent);
    background: transparent;

    &.-state-inTheaters {
        --accent: #{$color-primary};
        background: rgba($color-primary, .16);
    }

    &.-cinema.-state-seen {
        --accent: #{$color-green};
        background: rgba($color-green, .15);
    }

    &.-state-seen:is(.-streaming, .-netflix, .-primeVideo, .-disney\+, .-vod) {
        --accent: #{$color-yellow};
        background: rgba($color-yellow, .14);
    }

    > .day {
        width: 3rem;
        text-align: center;
        flex: none;
        color: $color-text-body;
        font: $bold 1.6rem/1 $font-mono;
    }

    > .poster {
        width: 3.8rem;
        height: 5.7rem;
        border-radius: 6px;
        flex: none;
        object-fit: cover;

        &.-placeholder { background: $color-surface-1; }
    }

    // .info disparaît de la mise en page desktop : title-row + sub deviennent frères directs.
    > .info { display: contents; }

    // Titre + badge « En salle » regroupés ; le badge se cale à droite du titre.
    .title-row {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: .8rem;
    }

    .badge {
        flex: none;
        padding: .3rem .55rem;
        border-radius: 4px;
        background: rgba($color-primary, .22);
        color: $color-primary-light;
        font: $bold 1.05rem/1 $font-body;
        text-transform: uppercase;
        letter-spacing: .03em;
        white-space: nowrap;
    }

    .title {
        min-width: 0;
        color: $color-text;
        font: $semi-bold 1.5rem/1.2 $font-body;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color .2s linear;

        @media (hover: hover) {
            &:hover { color: $color-primary-light; }
        }
    }

    .sub {
        width: 12rem;
        flex: none;
        color: $color-text-muted;
        font: $normal 1.25rem/1.2 $font-body;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    // Teintes de texte par état.
    &.-state-inTheaters .sub { color: $color-primary-light; }
    &.-state-unseen, &.-state-downloadAvailable {
        .sub { color: $color-text-weak; }
        > .day { color: $color-text-faint; }
        .title { color: $color-text-dim; }
        > .poster { opacity: .78; }
    }
}

@media (max-width: 999px) {
    .movie-list-item {
        gap: 1.1rem;
        padding: .9rem 1.4rem .9rem 1.2rem;

        > .day {
            width: 2.4rem;
            font-size: 1.5rem;
        }

        > .poster {
            width: 3.6rem;
            height: 5.4rem;
        }

        // Sur mobile on n'affiche que le titre : le sous-titre (réal) et le badge « En salle » sont masqués.
        > .info {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 0;
        }

        .title { font-size: 1.35rem; }

        .sub,
        .badge { display: none; }
    }
}
</style>
