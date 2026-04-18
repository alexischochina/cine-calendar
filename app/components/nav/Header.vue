<script setup>
import {refDebounced} from "@vueuse/shared";

const movieTitle = ref("")
const selectedMedia = ref('cinema');
const client = useSupabaseClient();
const user = useSupabaseUser();
const page = ref(1);
const movieId = ref(0);
const movieSelected = ref(false);
const searchMode = ref(false);
const searchTerm = ref('');
const searchInput = ref(null);
const emits = defineEmits(['movie-added', 'movie-exists', 'scroll-to-today', 'search-movie']);

const debouncedMovieTitle = refDebounced(movieTitle, 300);
const debouncedSearchTerm = refDebounced(searchTerm, 300);

const url = computed(() => {
    return `api/movies/search?query=${debouncedMovieTitle.value}&page=${page.value}`;
});

const {data} = await useFetch(url)

const bestResults = computed(() => {
    return data.value ? data.value.results.slice(0, 5) : [];
})

const movieInput = ref(null)

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

const resetForm = () => {
    movieTitle.value = '';
    movieId.value = 0;
    movieSelected.value = false;
    selectedMedia.value = 'cinema';
    nextTick(() => movieInput.value?.focus());
}

const addMovie = async () => {
    if (!movieId.value) return;
    try {
        const { data: existing } = await client
            .from('calendar')
            .select('id')
            .eq('movie_id', movieId.value)
            .maybeSingle()
        if (existing) {
            const existingMovieId = movieId.value;
            resetForm();
            emits('movie-exists', existingMovieId);
            return;
        }
        const { data: inserted, error } = await client
            .from('calendar')
            .insert({
                movie_id: movieId.value,
                media: selectedMedia.value,
                state: 'unseen',
            })
            .select()
            .single()
        if (error) throw error;
        const newEntry = { movie_id: movieId.value, media: selectedMedia.value, state: 'unseen', id: inserted.id };
        resetForm();
        emits('movie-added', newEntry)
    } catch (error) {
        console.error("Erreur lors de l'insertion:", error.message);
    }
}

const onMediaSelected = (option) => {
    selectedMedia.value = option;
}

const setMovieInfos = ((title, id) => {
    movieTitle.value = title;
    movieId.value = id;
    movieSelected.value = true;
    nextTick(() => movieInput.value?.focus());
})

const getReleaseYear = ((releaseDate) => {
    return new Date(releaseDate).getFullYear();
})
</script>

<template>
    <div class="nav-header flex -align-center">
        <template v-if="!searchMode">
            <form class="form" @submit.prevent>
                <div class="form-content flex -align-center">
                    <input ref="movieInput" type="text" name="movie" id="movie" class="text-input input-body" placeholder="Titre du film"
                           v-model="movieTitle" autocomplete="off" @input="movieSelected = false"
                           @keydown.enter.prevent="movieSelected && addMovie()">
                    <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"
                               open-direction="bottom"/>
                    <button class="input-btn" type="button" @click="addMovie">
                        <Svg name="add"/>
                    </button>
                </div>
                <div class="suggestions-container" v-if="!movieSelected && movieTitle">
                    <button v-for="movie in bestResults" class="btn suggestion input-body"
                            @click="setMovieInfos(movie.title, movie.id)">
                        <span class="movie-title">{{ movie.title }}</span>
                        <span class="small-body release-date">{{ getReleaseYear(movie.release_date) }}</span>
                    </button>
                </div>
            </form>
        </template>

        <template v-else>
            <div class="form-content flex -align-center">
                <input ref="searchInput" type="text" class="text-input input-body" placeholder="Rechercher dans ma liste..."
                       v-model="searchTerm" autocomplete="off" @keydown.escape="closeSearch">
                <button class="input-btn" type="button" @click="closeSearch">
                    <Svg name="close"/>
                </button>
            </div>
        </template>

        <button class="input-btn" type="button" @click="$emit('scroll-to-today')">
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

.form-content, .nav-wrapper {
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

.suggestions-container {
    background-color: $color-grey;
    width: calc(var(--search-bar-width) + 2rem);
    height: auto;
    position: absolute;
    bottom: 0;
    left: 0;
    z-index: 900;
    border-radius: 1rem;
    padding: 0 1rem var(--search-bar-height);
}

.suggestion {
    width: 100%;
    padding: 1rem;
    border-bottom: solid 1px $color-dark-grey;
    text-align: left;
    transition: background-color .3s linear;

    &:first-child {
        margin-top: 1rem;
    }
}

.movie-title {
    font-weight: $regular;
}

.release-date {
    margin-left: .5rem;
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

    .suggestion:hover {
        background-color: $color-dark-grey;
    }
}
</style>
