<script setup>
// Pastille média (maquette Timeline) : boîte pellicule (cinéma), pastille lettre
// (plateformes) ou icône play (streaming/vod/inconnu). Mapping clés app → maquette.
const props = defineProps({
    media: {
        type: String,
        default: 'unknown',
    },
    mini: {
        type: Boolean,
        default: false,
    },
});

const MEDIA = {
    cinema:     { kind: 'icon',   icon: 'film', bg: '#2a2d36', color: '#c9ccd4' },
    netflix:    { kind: 'letter', letter: 'N',  bg: '#e50914', color: '#ffffff' },
    primeVideo: { kind: 'letter', letter: 'P',  bg: '#00a8e1', color: '#ffffff' },
    'disney+':  { kind: 'letter', letter: 'D+', bg: '#113ccf', color: '#ffffff' },
    streaming:  { kind: 'icon',   icon: 'play', bg: '#3a3f4a', color: '#c9ccd4' },
    vod:        { kind: 'icon',   icon: 'play', bg: '#3a3f4a', color: '#c9ccd4' },
    unknown:    { kind: 'icon',   icon: 'play', bg: '#3a3f4a', color: '#c9ccd4' },
};

const badge = computed(() => MEDIA[props.media] ?? MEDIA.unknown);
</script>

<template>
    <span class="media-badge" :class="{ '-mini': mini }" :style="{ backgroundColor: badge.bg, color: badge.color }">
        <Svg v-if="badge.kind === 'icon'" :name="badge.icon" class="ico" />
        <span v-else class="letter">{{ badge.letter }}</span>
    </span>
</template>

<style lang="scss" scoped>
.media-badge {
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 6px;
    flex-shrink: 0;

    &.-mini {
        width: 2.2rem;
        height: 2.2rem;
    }

    > .ico {
        width: 1.4rem;
        height: 1.4rem;
    }

    > .letter {
        font: 800 1rem/1 $font-body;
    }
}
</style>
