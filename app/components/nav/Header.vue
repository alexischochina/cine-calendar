<script setup>
import {refDebounced} from "@vueuse/shared";

const emits = defineEmits(['movie-added', 'movie-exists', 'scroll-to-today', 'search-movie'])

const searchMode = ref(false);
const addMode = ref(false);
const searchTerm = ref('');
const searchInput = ref(null);
const addFormRef = ref(null);
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

const openAdd = () => {
    addMode.value = true;
    nextTick(() => addFormRef.value?.$el?.querySelector('input')?.focus());
}

const closeAdd = () => {
    addMode.value = false;
}

const onMovieAdded = (event) => {
    addMode.value = false;
    emits('movie-added', event);
}

const scrollToToday = () => {
    yearPickerRef.value?.resetToCurrentYear();
    emits('scroll-to-today');
}
</script>

<template>
    <div class="nav-header flex -align-center" :class="{ '-add-mode': addMode, '-search-mode': searchMode }">

        <!-- Add form: always on desktop, shown in addMode on mobile -->
        <div class="add-form-wrapper flex -align-center" v-if="!searchMode">
            <NavMovieAddForm ref="addFormRef"
                             @movie-added="onMovieAdded"
                             @movie-exists="emits('movie-exists', $event)" />
            <button class="input-btn close-add-btn" type="button" @click="closeAdd">
                <Svg name="close"/>
            </button>
        </div>

        <!-- Search mode -->
        <div class="form-content flex -align-center" v-if="searchMode">
            <input ref="searchInput" type="text" class="text-input input-body"
                   placeholder="Rechercher dans ma liste..."
                   v-model="searchTerm" autocomplete="off" @keydown.escape="closeSearch">
            <button class="input-btn" type="button" @click="closeSearch">
                <Svg name="close"/>
            </button>
        </div>

        <!-- Mobile add button (compact state) -->
        <button class="input-btn mobile-add-btn" type="button" @click="openAdd"
                v-if="!searchMode && !addMode">
            <Svg name="add"/>
        </button>

        <!-- Separator + utilities: single instance, always in DOM -->
        <div class="utilities flex -align-center">
            <div class="separator" />
            <NavYearPicker ref="yearPickerRef" />
            <button class="input-btn" type="button" @click="scrollToToday">
                <Svg name="calendar"/>
            </button>
            <button class="input-btn" type="button" @click="openSearch" v-if="!searchMode">
                <Svg name="search"/>
            </button>
            <NavFilterPanel />
        </div>

    </div>
</template>

<style lang="scss" scoped>
.nav-header {
    --search-bar-width: 30rem;
    --search-bar-height: 5.5rem;
    z-index: 999;
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 1rem;
    gap: .5rem;
    border-radius: 1.5rem;
    background: rgba($color-grey, 0.88);
    border: 1px solid rgba($color-white, 0.07);
    box-shadow:
        inset 0 1px 0 rgba($color-white, 0.06),
        0 8px 24px rgba(0, 0, 0, 0.5),
        0 24px 48px rgba(0, 0, 0, 0.3);

    &::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        z-index: -1;
    }
}

.add-form-wrapper {
    gap: .5rem;
}

.close-add-btn { display: none; }
.mobile-add-btn { display: none; }

.utilities { gap: .5rem; }

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

.separator {
    width: 1px;
    height: 2rem;
    background: linear-gradient(to bottom, transparent, rgba($color-white, 0.14), transparent);
    flex-shrink: 0;
    margin: 0 .25rem;
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

        &.-close { width: 1.7rem; }
    }
}

@media (hover: hover) {
    .input-btn:hover { background-color: $color-dark-grey; }
}

@media (hover: none) {
    .input-btn:active {
        background-color: $color-dark-grey;
        transform: scale(.9);
    }
}

@media (max-width: 767px) {
    .nav-header {
        left: 50%;
        right: auto;
        bottom: 1.25rem;
        transform: translateX(-50%);
        padding: .75rem 1rem;
        border-radius: 2rem;
        width: fit-content;
        transition: width .38s $cubic-ease-out, border-radius .3s $cubic-ease-out;
    }

    .nav-header.-add-mode,
    .nav-header.-search-mode {
        width: calc(100% - 2.5rem);
        border-radius: 1.5rem;
    }

    /* Default: hide add form, show mobile add btn */
    .add-form-wrapper { display: none; }
    .mobile-add-btn { display: flex; }

    /* Add mode: show form full width, hide utilities */
    .nav-header.-add-mode {
        .add-form-wrapper {
            display: flex;
            flex: 1;
            min-width: 0;
        }
        .close-add-btn { display: flex; }
        .utilities { display: none; }
    }

    /* Search mode: hide utilities */
    .nav-header.-search-mode {
        .utilities { display: none; }
        .form-content {
            flex: 1;
            min-width: 0;
        }
    }

    .text-input {
        flex: 1;
        width: auto;
        min-width: 0;
    }
}
</style>
