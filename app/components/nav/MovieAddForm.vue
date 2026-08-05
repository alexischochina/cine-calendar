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

const url = computed(() => `/api/movies/search?query=${encodeURIComponent(debouncedMovieTitle.value)}&page=${page.value}`);

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
        // Si TMDB est indisponible, on insère quand même (métadonnées nulles) :
        // le filet de sécurité de getMovies les résoudra au prochain chargement.
        let meta = { title: null, poster_path: null, release_date: null, director: null, genres: null, countries: null, vote_average: null };
        try {
            meta = await $fetch(`/api/movies/${movieId.value}/full`);
        } catch (e) {
            console.error('Métadonnées TMDB indisponibles à l\'ajout, résolution différée:', e);
        }
        const { data: inserted, error } = await client
            .from('calendar')
            .insert({
                movie_id: movieId.value,
                media: selectedMedia.value,
                state: 'unseen',
                title: meta.title,
                poster_path: meta.poster_path,
                release_date: meta.release_date,
                director: meta.director,
                genres: meta.genres,
                countries: meta.countries,
                tmdb_vote: meta.vote_average,
            })
            .select()
            .single()
        if (error) throw error;
        const newEntry = {
            movie_id: movieId.value,
            media: selectedMedia.value,
            state: 'unseen',
            id: inserted.id,
            title: meta.title,
            poster_path: meta.poster_path,
            release_date: meta.release_date,
            director: meta.director,
            genres: meta.genres,
            countries: meta.countries,
            tmdb_vote: meta.vote_average,
        };
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
                   placeholder="Titre du film" aria-label="Titre du film à ajouter" v-model="movieTitle" autocomplete="off"
                   @input="movieSelected = false"
                   @keydown.enter.prevent="movieSelected && addMovie()">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected" open-direction="bottom"/>
            <button class="input-btn" type="button" @click="addMovie" aria-label="Ajouter le film">
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
    background-color: transparent;
    width: var(--search-bar-width);
    padding: .4rem 0;
    height: 3rem;
    color: $color-text-body;
    font: $normal 1.4rem/1 $font-body;
}

.suggestions-container {
    background-color: $color-surface-2;
    border: 1px solid $color-border-5;
    width: calc(var(--search-bar-width) + 3rem);
    height: auto;
    position: absolute;
    bottom: 0;
    left: 0;
    z-index: 900;
    border-radius: 1.4rem;
    overflow: hidden;
    padding: 0 0 var(--search-bar-height);
    box-shadow: 0 18px 44px rgba(0, 0, 0, .6);
}

.suggestion {
    width: 100%;
    padding: 1.1rem 1.4rem;
    border-bottom: solid 1px $color-border-2;
    text-align: left;
    transition: background-color .2s linear;
}

.movie-title {
    color: $color-text;
    font: $semi-bold 1.4rem/1 $font-body;
}

.release-date {
    margin-left: .6rem;
    color: $color-text-weaker;
    font-family: $font-mono;
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

@media (hover: hover) {
    .input-btn:hover {
        background-color: $color-hover;
        color: $color-text-dim;
    }

    .suggestion:hover {
        background-color: $color-hover-strong;
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
