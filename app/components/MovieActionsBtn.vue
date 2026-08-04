<script setup>
import { onClickOutside } from '@vueuse/core';

const emits = defineEmits(['movie-deleted', 'release-date-updated', 'toggle-catchup']);

const props = defineProps({
    id: {
        type: Number,
        required: true,
    },
    manualReleaseDate: {
        type: String,
        default: null,
    },
    releaseDate: {
        type: String,
        default: null,
    },
    catchup: {
        type: Boolean,
        default: false,
    },
});

// « À rattraper » ne concerne que les films déjà sortis (date effective passée).
const isReleased = computed(() => !!props.releaseDate && props.releaseDate <= today());

const isOpen = ref(false);
const view = ref('menu');
const container = ref(null);

const close = () => {
    isOpen.value = false;
    view.value = 'menu';
}

const toggle = () => {
    if (isOpen.value) {
        close();
    } else {
        isOpen.value = true;
        view.value = 'menu';
    }
}

const onDeleted = (id) => {
    emits('movie-deleted', id);
    close();
}

const onReleaseDateUpdated = (payload) => {
    emits('release-date-updated', payload);
}

const onToggleCatchup = () => {
    emits('toggle-catchup', props.id, !props.catchup);
    close();
}

onClickOutside(container, close);
</script>

<template>
    <div class="actions-btn-wrapper" ref="container">
        <button class="actions-btn" :class="{ '-active': !!manualReleaseDate }" @click.stop="toggle"
                aria-label="Actions du film" :aria-expanded="isOpen">
            <Svg name="more"/>
        </button>
        <div v-if="isOpen" class="popover" @click.stop>
            <template v-if="view === 'menu'">
                <button class="menu-item" @click="view = 'date'">
                    <span class="ico-box"><Svg name="calendar"/></span>
                    <span class="label">Modifier la date</span>
                </button>
                <button v-if="isReleased" class="menu-item" :class="{ '-active': catchup }" @click="onToggleCatchup">
                    <span class="ico-box"><Svg name="list"/></span>
                    <span class="label">{{ catchup ? 'Retirer de la liste à rattraper' : 'Ajouter à la liste à rattraper' }}</span>
                </button>
                <DeleteMovieAction :id="id" @movie-deleted="onDeleted"/>
            </template>
            <EditDateAction v-else-if="view === 'date'" :id="id" :manual-release-date="manualReleaseDate"
                            @release-date-updated="onReleaseDateUpdated" @done="close"/>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.actions-btn-wrapper {
    position: relative;
    flex-shrink: 0;
}

.actions-btn {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 7px;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear, color .2s linear;
    color: $color-text-weak;

    > svg {
        width: 1.8rem;
        height: auto;
    }

    &.-active {
        color: $color-primary;
    }

    @media (hover: hover) {
        &:hover {
            background-color: $color-hover;
            color: $color-text-dim;
        }

        &.-active:hover {
            color: $color-primary;
        }
    }
}

.popover {
    position: absolute;
    top: calc(100% + .6rem);
    right: 0;
    background-color: $color-surface-2;
    border: 1px solid $color-border-5;
    border-radius: 1.3rem;
    padding: .6rem;
    display: flex;
    flex-direction: column;
    gap: .2rem;
    z-index: 20;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .6);
    min-width: 19rem;
    transform-origin: top right;
    animation: pop .14s ease;
}

.menu-item {
    background-color: transparent;
    color: $color-text-body;
    border: none;
    border-radius: .9rem;
    padding: .9rem 1.1rem;
    font: $semi-bold 1.3rem/1 $font-body;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 1.1rem;
    transition: background-color .2s linear;

    > .ico-box {
        display: grid;
        place-items: center;
        width: 2.4rem;
        height: 2.4rem;
        border-radius: 7px;
        background: $color-surface-4;
        color: $color-text-dim;
        flex-shrink: 0;

        > :deep(svg) { width: 1.5rem; height: 1.5rem; }
    }

    &.-active {
        color: $color-primary-light;

        > .ico-box { color: $color-primary-light; }
    }

    @media (hover: hover) {
        &:hover {
            background-color: $color-hover-strong;
        }
    }
}

@keyframes pop {
    from { transform: scale(.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}
</style>
