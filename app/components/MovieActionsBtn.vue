<script setup>
import { onClickOutside } from '@vueuse/core';

const emits = defineEmits(['movie-deleted', 'release-date-updated']);

const props = defineProps({
    id: {
        type: Number,
        required: true,
    },
    manualReleaseDate: {
        type: String,
        default: null,
    },
});

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

onClickOutside(container, close);
</script>

<template>
    <div class="actions-btn-wrapper" ref="container">
        <button class="actions-btn" :class="{ '-active': !!manualReleaseDate }" @click.stop="toggle" title="Actions">
            <Svg name="more"/>
        </button>
        <div v-if="isOpen" class="popover" @click.stop>
            <template v-if="view === 'menu'">
                <button class="menu-item" @click="view = 'date'">
                    <Svg name="calendar"/>
                    <span>Modifier la date</span>
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
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear, color .2s linear;
    color: rgba($color-white, .6);

    > svg {
        width: 1.6rem;
        height: auto;
    }

    &.-active {
        color: #ec008b;
    }

    @media (hover: hover) {
        &:hover {
            background-color: $color-dark-grey;
            color: $color-white;
        }

        &.-active:hover {
            color: #ec008b;
        }
    }
}

.popover {
    position: absolute;
    top: calc(100% + .5rem);
    right: 0;
    background-color: $color-dark-grey;
    border-radius: .5rem;
    padding: .5rem;
    display: flex;
    flex-direction: column;
    gap: .25rem;
    z-index: 20;
    box-shadow: 0 4px 12px rgba(0, 0, 0, .4);
    min-width: 18rem;
}

.menu-item {
    background-color: transparent;
    color: $color-white;
    border: none;
    border-radius: .25rem;
    padding: .75rem 1rem;
    font-family: inherit;
    font-size: 1.4rem;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: .75rem;
    transition: background-color .2s linear;

    > :deep(svg) {
        width: 1.4rem;
        height: 1.4rem;
        flex-shrink: 0;
    }

    @media (hover: hover) {
        &:hover {
            background-color: rgba($color-white, .08);
        }
    }
}
</style>
