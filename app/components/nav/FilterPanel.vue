<script setup>
import { onClickOutside } from '@vueuse/core';

const moviesStore = useMoviesStore();

const stateFilters = [
    { value: 'unseen', label: 'Non vu' },
    { value: 'seen', label: 'Vu' },
    { value: 'downloadAvailable', label: 'Téléchargeable' },
];
const mediaFilters = [
    { value: 'cinema', label: 'Cinéma' },
    { value: 'vod', label: 'VOD' },
    { value: 'primeVideo', label: 'Prime' },
    { value: 'disney+', label: 'Disney+' },
    { value: 'netflix', label: 'Netflix' },
];

const isOpen = ref(false);
const wrapperRef = ref(null);

const hasActiveFilters = computed(() => moviesStore.filters.state || moviesStore.filters.media);

const toggleStateFilter = (value) => {
    moviesStore.filters.state = moviesStore.filters.state === value ? null : value;
};

const toggleMediaFilter = (value) => {
    moviesStore.filters.media = moviesStore.filters.media === value ? null : value;
};

onClickOutside(wrapperRef, () => { isOpen.value = false; });
</script>

<template>
    <div ref="wrapperRef" class="filter-wrapper">
        <Transition name="panel">
            <div v-if="isOpen" class="filter-panel">
                <div class="filter-row">
                    <span class="filter-row-label">État</span>
                    <div class="filter-options flex -align-center">
                        <button v-for="f in stateFilters" :key="f.value"
                                class="filter-option" :class="{ '-active': moviesStore.filters.state === f.value }"
                                type="button" @click="toggleStateFilter(f.value)">
                            <Svg :name="f.value" class="option-icon" :class="`-${f.value}`" />
                            <span class="option-label">{{ f.label }}</span>
                        </button>
                    </div>
                </div>
                <div class="filter-row">
                    <span class="filter-row-label">Mode</span>
                    <div class="filter-options flex -align-center">
                        <button v-for="f in mediaFilters" :key="f.value"
                                class="filter-option" :class="{ '-active': moviesStore.filters.media === f.value }"
                                type="button" @click="toggleMediaFilter(f.value)">
                            <NuxtImg :src="`/images/${f.value}.png`" class="option-icon" />
                            <span class="option-label">{{ f.label }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
        <button class="input-btn filter-toggle" :class="{ '-active': hasActiveFilters }"
                type="button" @click="isOpen = !isOpen">
            <svg class="funnel-icon" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="0" y1="1" x2="18" y2="1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="3" y1="7" x2="15" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="6" y1="13" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span v-if="hasActiveFilters" class="active-dot" />
        </button>
    </div>
</template>

<style lang="scss" scoped>
.filter-wrapper {
    position: relative;
}

.filter-toggle {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear;
    position: relative;

    .funnel-icon {
        width: 1.6rem;
        height: auto;
        transition: color .2s linear;
    }

    &.-active {
        color: #ec008b;
    }

    .active-dot {
        position: absolute;
        top: .5rem;
        right: .5rem;
        width: .6rem;
        height: .6rem;
        border-radius: 50%;
        background-color: #ec008b;
    }
}

.filter-panel {
    position: absolute;
    bottom: calc(100% + 0.75rem);
    right: 0;
    background-color: $color-grey;
    border-radius: 1rem;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: .75rem;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, .4);
    transform-origin: bottom right;
}

.filter-row {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.filter-row-label {
    color: rgba($color-white, .4);
    width: 3.5rem;
    flex-shrink: 0;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: .05em;
}

.filter-options {
    gap: .35rem;
}

.filter-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .4rem;
    padding: .6rem .75rem;
    border-radius: .6rem;
    transition: background-color .15s linear, opacity .15s linear;
    opacity: .35;

    &.-active {
        opacity: 1;
        background-color: $color-dark-grey;
    }

    .option-icon {
        width: 2.2rem;
        height: 2.2rem;
        object-fit: contain;
        flex-shrink: 0;

        &.-seen { color: $color-yellow; }
        &.-downloadAvailable { color: $color-orange; }
    }

    .option-label {
        font-size: 1rem;
        white-space: nowrap;
        color: $color-white;
    }
}

.panel-enter-active,
.panel-leave-active {
    transition: opacity .15s ease, transform .15s $cubic-ease-out;
}

.panel-enter-from,
.panel-leave-to {
    opacity: 0;
    transform: scale(.95);
}

@media (hover: hover) {
    .filter-toggle:hover {
        background-color: $color-dark-grey;
    }

    .filter-option:not(.-active):hover {
        opacity: .6;
    }
}

@media #{$mobile} {
    .filter-panel {
        right: -1rem;
    }

    .filter-options {
        flex-wrap: wrap;
        gap: .5rem;
    }
}
</style>
