<script setup>
const props = defineProps({
    releaseDate: {
        type: Date,
    },
    poster: {
        type: String,
    },
    title: {
        type: String,
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
    }
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
    const { data, error } = await client
        .from('calendar')
        .update({ media: newMedia })
        .eq('id', props.id)
}

const updateState = async (newState) => {
    const { data, error } = await client
        .from('calendar')
        .update({ state: newState })
        .eq('id', props.id)
}
</script>

<template>
    <div class="movie-list-item flex -align-center -justify-space-between"
         :class="`-${selectedMedia}`">
        <div class="movie-infos flex -align-center">
            <div class="title-4">04</div>
            <NuxtImg src="/images/poster.jpg" class="poster"/>
            <div class="title-5">{{ props.title }}</div>
        </div>
        <div class="stream-infos flex -align-center">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"/>
            <SelectBtn type="state" :selected="selectedState" @option-selected="onStateSelected"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.movie-list-item {
    border-top: 1px solid $color-white;
    border-bottom: 1px solid $color-white;
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
</style>