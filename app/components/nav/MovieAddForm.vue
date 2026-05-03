<script setup>
import {refDebounced} from "@vueuse/shared";

const emit = defineEmits(['movie-added', 'movie-exists'])

const movieTitle = ref("")
const selectedMedia = ref('cinema');
const client = useSupabaseClient();
const page = ref(1);
const movieId = ref(0);
const movieSelected = ref(false);
const movieInput = ref(null)

const debouncedMovieTitle = refDebounced(movieTitle, 300);

const url = computed(() => `api/movies/search?query=${debouncedMovieTitle.value}&page=${page.value}`);

const {data} = await useFetch(url)

const bestResults = computed(() => data.value ? data.value.results.slice(0, 5) : []);

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
            emit('movie-exists', existingMovieId);
            return;
        }
        const { data: inserted, error } = await client
            .from('calendar')
            .insert({ movie_id: movieId.value, media: selectedMedia.value, state: 'unseen' })
            .select()
            .single()
        if (error) throw error;
        const newEntry = { movie_id: movieId.value, media: selectedMedia.value, state: 'unseen', id: inserted.id };
        resetForm();
        emit('movie-added', newEntry)
    } catch (error) {
        console.error("Erreur lors de l'insertion:", error.message);
    }
}

const onMediaSelected = (option) => { selectedMedia.value = option; }

const setMovieInfos = (title, id) => {
    movieTitle.value = title;
    movieId.value = id;
    movieSelected.value = true;
    nextTick(() => movieInput.value?.focus());
}

const getReleaseYear = (releaseDate) => new Date(releaseDate).getFullYear();
</script>

<template>
    <form class="add-form" @submit.prevent>
        <div class="form-content flex -align-center">
            <input ref="movieInput" type="text" name="movie" id="movie" class="text-input input-body"
                   placeholder="Titre du film" v-model="movieTitle" autocomplete="off"
                   @input="movieSelected = false"
                   @keydown.enter.prevent="movieSelected && addMovie()">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected" open-direction="bottom"/>
            <button class="input-btn" type="button" @click="addMovie">
                <Svg name="add"/>
            </button>
        </div>
        <div class="suggestions-container" v-if="!movieSelected && movieTitle">
            <button v-for="movie in bestResults" :key="movie.id" class="btn suggestion input-body"
                    @click="setMovieInfos(movie.title, movie.id)">
                <span class="movie-title">{{ movie.title }}</span>
                <span class="small-body release-date">{{ getReleaseYear(movie.release_date) }}</span>
            </button>
        </div>
    </form>
</template>

<style lang="scss" scoped>
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

@media (max-width: 767px) {
    .add-form {
        flex: 1;
        min-width: 0;
    }

    .form-content {
        width: 100%;
    }

    .text-input {
        flex: 1;
        width: auto;
        min-width: 0;
    }

    .suggestions-container {
        left: 0;
        right: 0;
        width: auto;
    }
}
</style>
