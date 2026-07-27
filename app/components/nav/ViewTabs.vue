<script setup>
// Segmented Timeline|Stats avec pastille rose glissante. Partagé entre le rail gauche
// desktop (NavSideNav) et l'en-tête mobile (index.vue) — une seule source de vérité.
defineProps({
    viewMode: {
        type: String,
        default: 'timeline',
    },
});

const emit = defineEmits(['select-view']);
</script>

<template>
    <div class="view-tabs" :class="`-view-${viewMode}`">
        <button class="tab" :class="{ '-active': viewMode === 'timeline' }" type="button"
                @click="emit('select-view', 'timeline')">
            <Svg name="list" class="ico" />Timeline
        </button>
        <button class="tab" :class="{ '-active': viewMode === 'stats' }" type="button"
                @click="emit('select-view', 'stats')">
            <Svg name="chart" class="ico" />Stats
        </button>
    </div>
</template>

<style lang="scss" scoped>
.view-tabs {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr; // colonnes strictement égales (calage exact de la pastille)
    gap: .4rem;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.1rem;
    padding: .4rem;

    // Pastille rose glissante : couvre un onglet, translate vers l'autre au changement de vue.
    &::before {
        content: '';
        position: absolute;
        top: .4rem;
        left: .4rem;
        bottom: .4rem;
        width: calc(50% - .6rem);
        background: $color-primary;
        border-radius: .8rem;
        transition: transform .28s cubic-bezier(.4, 0, .2, 1);
        z-index: 0;
    }

    &.-view-stats::before { transform: translateX(calc(100% + .4rem)); }

    > .tab {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .5rem;
        padding: .8rem .6rem;
        border-radius: .8rem;
        color: $color-text-muted;
        font: $semi-bold 1.15rem/1 $font-body;
        cursor: pointer;
        transition: color .2s linear;

        > .ico { width: 1.3rem; height: 1.3rem; }

        &.-active { color: $color-white; }
    }
}
</style>
