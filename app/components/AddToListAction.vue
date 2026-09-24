<script setup>
import { onClickOutside } from '@vueuse/core';

// Le menu « ⋯ » d'une ligne de liste partagée : une seule entrée, le seul geste possible sur le film
// de quelqu'un d'autre.
//
// ⚠️ Un composant à part et non une branche dans `MovieActionsBtn` : celui-là ne fait qu'écrire
// (date, rattrapage, suppression), et y greffer un mode « ne touche à rien » mettrait trois actions
// destructrices à un `v-if` près d'une liste qu'on n'a pas le droit de modifier.
const props = defineProps({
    // Déjà chez moi ? L'entrée devient un constat, pas une action.
    alreadyMine: {
        type: Boolean,
        default: false,
    },
});

const emits = defineEmits(['add-to-list']);

const isOpen = ref(false);
const container = ref(null);

const close = () => { isOpen.value = false; };
const toggle = () => { isOpen.value = !isOpen.value; };

const onAdd = () => {
    if (props.alreadyMine) return;
    emits('add-to-list');
    close();
};

onClickOutside(container, close);
</script>

<template>
    <div class="add-to-list-action" ref="container" @keydown.escape="close">
        <button class="actions-btn" type="button" @click.stop="toggle"
                aria-label="Actions du film" :aria-expanded="isOpen">
            <Svg name="more" />
        </button>

        <div v-if="isOpen" class="popover" @click.stop>
            <button class="menu-item" :class="{ '-done': alreadyMine }" type="button"
                    :disabled="alreadyMine" @click="onAdd">
                <span class="ico-box"><Svg :name="alreadyMine ? 'check' : 'add'" /></span>
                <span class="label">{{ alreadyMine ? 'Déjà dans ta liste' : 'Ajouter à ma liste' }}</span>
            </button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.add-to-list-action {
    position: relative;
    flex: none;
}

.actions-btn {
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 7px;
    color: $color-text-weak;
    cursor: pointer;
    transition: background-color .15s linear, color .15s linear;
    @include focusRing();

    :deep(svg) { width: 1.8rem; height: 1.8rem; }

    @media (hover: hover) {
        &:hover {
            background: $color-hover;
            color: $color-text-dim;
        }
    }
}

.popover {
    position: absolute;
    top: calc(100% + .6rem);
    right: 0;
    z-index: 30;
    min-width: 21rem;
    padding: .5rem;
    background: $color-surface-2;
    border: 1px solid $color-border-4;
    border-radius: 1rem;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .55);
    animation: pop .14s ease;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    padding: .9rem 1rem;
    border-radius: .8rem;
    color: $color-text;
    font: $medium 1.3rem/1 $font-body;
    text-align: left;
    cursor: pointer;
    transition: background-color .15s linear;
    @include focusRing();

    > .ico-box {
        flex: none;
        display: grid;
        place-items: center;
        width: 2.4rem;
        height: 2.4rem;
        border-radius: .7rem;
        background: rgba($color-primary, .14);
        color: $color-primary-light;

        :deep(svg) { width: 1.4rem; height: 1.4rem; }
    }

    // Déjà là : lisible, mais ne se présente plus comme un bouton.
    &.-done {
        color: $color-text-weaker;
        cursor: default;

        > .ico-box {
            background: $color-surface-4;
            color: $color-text-weak;
        }
    }

    @media (hover: hover) {
        &:not(.-done):hover { background: $color-hover; }
    }
}

@keyframes pop {
    from { transform: scale(.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}
</style>
