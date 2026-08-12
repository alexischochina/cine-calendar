<script setup>
// Segmented Timeline|Stats|Séances avec pastille rose glissante. Partagé entre le rail gauche
// desktop (NavSideNav) et l'en-tête mobile (layouts/default.vue) — une seule source de vérité.
//
// Deux dispositions, comme la maquette : le rail **empile** les onglets (22rem de large, trois
// libellés horizontaux n'y tiennent pas — c'est ce qui débordait), l'en-tête mobile garde le
// segmented horizontal. La pastille glisse sur l'axe correspondant.
defineProps({
    viewMode: {
        type: String,
        default: 'timeline',
    },
    layout: {
        type: String,
        default: 'stack',
        validator: (v) => ['stack', 'row'].includes(v),
    },
});

const emit = defineEmits(['select-view']);

const TABS = [
    { mode: 'timeline', icon: 'list', label: 'Timeline' },
    { mode: 'stats', icon: 'chart', label: 'Stats' },
    { mode: 'seances', icon: 'ticket', label: 'Séances' },
];
</script>

<template>
    <div class="view-tabs" :class="[`-${layout}`, `-view-${viewMode}`]">
        <button v-for="tab in TABS" :key="tab.mode" class="tab" type="button"
                :class="{ '-active': viewMode === tab.mode }" :aria-pressed="viewMode === tab.mode"
                @click="emit('select-view', tab.mode)">
            <Svg :name="tab.icon" class="ico" aria-hidden="true" />{{ tab.label }}
        </button>
    </div>
</template>

<style lang="scss" scoped>
.view-tabs {
    position: relative;
    display: grid;
    gap: .4rem;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.1rem;
    padding: .4rem;

    // Pastille rose glissante : couvre un onglet, translate vers le suivant au changement de vue.
    // Sa taille vaut un tiers du conteneur moins sa part des paddings (2 × .4rem) et des gaps
    // (2 × .4rem), soit (.8 + .8) / 3 = .534rem à retrancher.
    &::before {
        content: '';
        position: absolute;
        top: .4rem;
        left: .4rem;
        background: $color-primary;
        border-radius: .8rem;
        transition: transform .28s cubic-bezier(.4, 0, .2, 1);
        z-index: 0;
    }

    > .tab {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: .8rem;
        min-width: 0; // sans quoi le libellé le plus long pousse la colonne et déborde
        padding: .8rem 1rem;
        border-radius: .8rem;
        color: $color-text-muted;
        font: $semi-bold 1.3rem/1 $font-body;
        white-space: nowrap;
        cursor: pointer;
        transition: color .2s linear;

        > .ico { width: 1.6rem; height: 1.6rem; flex: none; }

        &.-active { color: $color-white; }
    }

    // Rail desktop : une colonne, onglets alignés à gauche.
    &.-stack {
        grid-template-rows: repeat(3, 1fr);

        &::before {
            right: .4rem;
            height: calc(33.333% - .534rem);
        }

        &.-view-stats::before { transform: translateY(calc(100% + .4rem)); }
        &.-view-seances::before { transform: translateY(calc(200% + .8rem)); }
    }

    // En-tête mobile : segmented horizontal, colonnes strictement égales (calage exact de la
    // pastille), libellés centrés et resserrés.
    &.-row {
        grid-template-columns: repeat(3, 1fr);

        &::before {
            bottom: .4rem;
            width: calc(33.333% - .534rem);
        }

        &.-view-stats::before { transform: translateX(calc(100% + .4rem)); }
        &.-view-seances::before { transform: translateX(calc(200% + .8rem)); }

        > .tab {
            justify-content: center;
            gap: .5rem;
            padding: .8rem .4rem;
            font-size: 1.2rem;

            > .ico { width: 1.4rem; height: 1.4rem; }
        }
    }
}
</style>
