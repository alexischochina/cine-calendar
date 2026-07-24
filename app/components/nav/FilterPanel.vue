<script setup>
import { onClickOutside } from '@vueuse/core';

const moviesStore = useMoviesStore();

const stateFilters = [
    { value: 'unseen', label: 'Non vu' },
    { value: 'seen', label: 'Vu' },
    { value: 'downloadAvailable', label: 'Téléchargeable' },
    { value: 'inTheaters', label: 'En salle' },
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
                            <MediaBadge :media="f.value" mini class="option-icon" />
                            <span class="option-label">{{ f.label }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
        <button class="input-btn filter-toggle" :class="{ '-active': hasActiveFilters }"
                type="button" :aria-label="hasActiveFilters ? 'Filtres (actifs)' : 'Filtres'"
                :aria-expanded="isOpen" @click="isOpen = !isOpen">
            <svg class="funnel-icon" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
        color: $color-primary;
    }

    .active-dot {
        position: absolute;
        top: .5rem;
        right: .5rem;
        width: .6rem;
        height: .6rem;
        border-radius: 50%;
        background-color: $color-primary;
    }
}

.filter-panel {
    position: absolute;
    bottom: calc(100% + 0.75rem);
    right: 0;
    background-color: $color-surface-2;
    border: 1px solid $color-border-5;
    border-radius: 1.4rem;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: .75rem;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .6);
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
        background-color: $color-hover-strong;
    }

    .option-icon {
        width: 2.2rem;
        height: 2.2rem;
        object-fit: contain;
        flex-shrink: 0;

        &.-seen { color: $color-yellow; }
        &.-downloadAvailable { color: $color-text-muted; }
        &.-inTheaters { color: $color-primary; }
    }

    .option-label {
        font-size: 1rem;
        white-space: nowrap;
        color: $color-text-body;
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

@media (max-width: 767px) {
    .filter-panel {
        position: fixed;
        bottom: 7rem;
        left: 1.25rem;
        right: 1.25rem;
        width: auto;
        transform-origin: bottom center;
        padding: 1.25rem 1.25rem 1rem;
        border-radius: 1.5rem;
        background: $color-surface-2;
        border: 1px solid $color-border-5;
        box-shadow: 0 18px 44px rgba(0, 0, 0, .6);
    }

    .filter-row {
        flex-direction: column;
        align-items: flex-start;
        gap: .6rem;
    }

    .filter-row-label {
        width: auto;
    }

    .filter-options {
        flex-wrap: wrap;
        gap: .35rem;
        width: 100%;
    }
}
</style>
