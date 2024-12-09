<script setup>
import SelectBtn from "~/components/SelectBtn.vue";

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
        validator: value => ['cinema', 'streaming', 'unknown'].includes(value)
    },
    platform: {
        type: String,
        default: 'vod',
        validator: value => ['netflix', 'primeVideo', 'disney+', 'vod'].includes(value)
    },
    stat: {
        type: String,
        default: 'unseen',
        validator: value => ['unseen', 'seen', 'downloadAvailable'].includes(value)
    },
})
const selectedMedia = ref('cinema');
const selectedState = ref('unseen');

const onMediaSelected = (option) => {
    selectedMedia.value = option;
}

const onStateSelected = (option) => {
    selectedState.value = option;
}
</script>

<template>
    <div class="movie-list-item flex -align-center -justify-space-between"
         :class="`-${selectedMedia}`">
        <div class="movie-infos flex -align-center">
            <div class="title-4">04</div>
            <NuxtImg src="/images/poster.jpg" class="poster"/>
            <div class="title-5">Babylon</div>
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