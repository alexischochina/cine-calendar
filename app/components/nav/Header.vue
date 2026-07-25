<script setup>
import {refDebounced} from "@vueuse/shared";

const emits = defineEmits(['movie-added', 'movie-exists', 'scroll-to-today', 'search-movie'])

const searchMode = ref(false);
const addMode = ref(false);
const searchTerm = ref('');
const searchInput = ref(null);
const addFormRef = ref(null);

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
            <button class="input-btn close-add-btn" type="button" @click="closeAdd" aria-label="Fermer l'ajout">
                <Svg name="close"/>
            </button>
        </div>

        <!-- Search mode -->
        <div class="form-content flex -align-center" v-if="searchMode">
            <input ref="searchInput" type="text" class="text-input input-body"
                   placeholder="Rechercher dans ma liste..." aria-label="Rechercher dans ma liste"
                   v-model="searchTerm" autocomplete="off" @keydown.escape="closeSearch">
            <button class="input-btn" type="button" @click="closeSearch" aria-label="Fermer la recherche">
                <Svg name="close"/>
            </button>
        </div>

        <!-- Mobile add button (compact state) -->
        <button class="input-btn mobile-add-btn" type="button" @click="openAdd"
                v-if="!searchMode && !addMode" aria-label="Ajouter un film">
            <Svg name="add"/>
        </button>

        <!-- Separator + utilities: single instance, always in DOM -->
        <div class="utilities flex -align-center">
            <div class="separator" />
            <button class="input-btn" type="button" @click="scrollToToday" aria-label="Aller à aujourd'hui">
                <Svg name="calendar"/>
            </button>
            <button class="input-btn" type="button" @click="openSearch" v-if="!searchMode" aria-label="Rechercher">
                <Svg name="search"/>
            </button>
            <NavFilterPanel />
        </div>

    </div>
</template>

<style lang="scss" scoped>
.nav-header {
    --search-bar-width: 34rem;
    --search-bar-height: 5.5rem;
    z-index: 999;
    position: fixed;
    bottom: 2rem;
    // Centré sur la colonne timeline (offset des rails 22rem / 26.4rem).
    left: calc(50% - 2.2rem);
    transform: translateX(-50%);
    padding: .7rem .8rem .7rem 1.6rem;
    gap: 1rem;
    border-radius: 999px;
    background: $color-surface-3;
    border: 1px solid $color-border-4;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .55);
}

.add-form-wrapper {
    gap: .8rem;
}

.utilities { gap: .4rem; }

.form-content {
    gap: .8rem;
    position: relative;
    z-index: 950;
}

.text-input {
    border: none;
    background-color: transparent;
    width: var(--search-bar-width);
    padding: .4rem 0;
    height: 3rem;
    color: $color-text-body;
    font: $normal 1.4rem/1 $font-body;
}

.separator {
    width: 1px;
    height: 2.2rem;
    background: $color-border-5;
    flex-shrink: 0;
    margin: 0 .2rem;
}

.input-btn {
    width: 3rem;
    height: 3rem;
    border-radius: .8rem;
    display: flex;
    justify-content: center;
    align-items: center;
    color: $color-text-muted;
    transition: background-color .2s linear, color .2s linear;

    > svg {
        width: 1.9rem;
        height: auto;
    }
}

.close-add-btn,
.mobile-add-btn { display: none; }

@media (hover: hover) {
    .input-btn:hover { background-color: $color-hover; color: $color-text-dim; }
}

@media (hover: none) {
    .input-btn:active {
        background-color: $color-hover;
        transform: scale(.9);
    }
}

@media (max-width: 999px) {
    .nav-header {
        left: 50%;
        right: auto;
        bottom: 1.6rem;
        transform: translateX(-50%);
        padding: .6rem .8rem .6rem 1.4rem;
        width: fit-content;
        transition: width .38s $cubic-ease-out, border-radius .3s $cubic-ease-out;
    }

    .nav-header.-add-mode,
    .nav-header.-search-mode {
        width: calc(100% - 3.2rem);
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
