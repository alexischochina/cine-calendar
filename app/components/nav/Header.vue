<script setup>
import {refDebounced} from "@vueuse/shared";

const emits = defineEmits(['movie-added', 'movie-exists', 'scroll-to-today', 'search-movie'])

const searchMode = ref(false);
const searchTerm = ref('');
const searchInput = ref(null);
const yearPickerRef = ref(null);

const debouncedSearchTerm = refDebounced(searchTerm, 300);

watch(debouncedSearchTerm, (term) => {
    if (term.trim().length >= 1) emits('search-movie', term.trim());
});

const openSearch = () => {
    searchMode.value = true;
    nextTick(() => searchInput.value?.focus());
}

const closeSearch = () => {
    searchMode.value = false;
    searchTerm.value = '';
}

const scrollToToday = () => {
    yearPickerRef.value?.resetToCurrentYear();
    emits('scroll-to-today');
}
</script>

<template>
    <div class="nav-header flex -align-center">
        <template v-if="!searchMode">
            <NavMovieAddForm @movie-added="emits('movie-added', $event)" @movie-exists="emits('movie-exists', $event)" />
        </template>
        <template v-else>
            <div class="form-content flex -align-center">
                <input ref="searchInput" type="text" class="text-input input-body"
                       placeholder="Rechercher dans ma liste..."
                       v-model="searchTerm" autocomplete="off" @keydown.escape="closeSearch">
                <button class="input-btn" type="button" @click="closeSearch">
                    <Svg name="close"/>
                </button>
            </div>
        </template>
        <NavYearPicker ref="yearPickerRef" />
        <button class="input-btn" type="button" @click="scrollToToday">
            <Svg name="calendar"/>
        </button>
        <button class="input-btn" type="button" @click="openSearch" v-if="!searchMode">
            <Svg name="search"/>
        </button>
    </div>
</template>

<style lang="scss" scoped>
.nav-header {
    --search-bar-width: 30rem;
    z-index: 999;
    position: fixed;
    --search-bar-height: 5.5rem;
    bottom: 5rem;
    left: 50%;
    transform: translateX(-50%);
    background-color: $color-grey;
    border-radius: 1rem;
    padding: 1rem;
    gap: .5rem;
}

.form-content {
    gap: .5rem;
    position: relative;
    z-index: 950;
}

.text-input {
    border: none;
    background-color: $color-dark-grey;
    border-radius: .5rem;
    width: var(--search-bar-width);
    padding: .6rem 1rem;
    height: 3.5rem;
    color: $color-white;
}

.input-btn {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear;

    > svg {
        width: 2rem;
        height: auto;

        &.-close {
            width: 1.7rem;
        }
    }
}

@media (hover: hover) {
    .input-btn:hover {
        background-color: $color-dark-grey;
    }
}
</style>
