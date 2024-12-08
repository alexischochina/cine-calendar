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
</script>

<template>
    <div class="movie-list-item flex -align-center" :class="`-${props.media} -${props.platform} -${props.stat}`">
        <div class="movie-infos flex -align-center -justify-space-between">
            <div class="title-4">04</div>
            <div class="title-5">Babylon</div>
        </div>
        <div class="stream-infos flex -align-center">
            <Svg :name="props.media" :class="props.media"/>
            <Svg :name="props.stat" :class="props.stat"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>

</style>