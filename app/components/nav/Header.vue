<script setup>
import {refDebounced} from "@vueuse/shared";

const addForm = ref(false)
const movieTitle = ref("")
const selectedMedia = ref('cinema');
const client = useSupabaseClient();
const page = ref(1);
const movieId = ref(0);
const frenchDate = ref('')
const emits = defineEmits(['movie-added']);
const formattedDate = ref('')

const debouncedSearchTerm = refDebounced(movieTitle, 700);

const url = computed(() => {
    return `api/movies/search?query=${debouncedSearchTerm.value}&page=${page.value}`;
});

const {data} = await useFetch(url)

const bestResults = computed(() => {
    return data.value ? data.value.results.slice(0, 5) : [];
})

const onHandleAdd = () => {
    addForm.value = true
}

const addMovie = async () => {
    try {
        const {data, error} = await client
            .from('calendar')
            .insert({
                movie_id: movieId.value,
                media: selectedMedia.value,
                state: 'unseen'
            })
        if (error) throw error;
        emits('movie-added')
    } catch (error) {
        console.error("Erreur lors de l'insertion:", error.message);
    }
}

const closeForm = () => {
    addForm.value = false
}

const onMediaSelected = (option) => {
    selectedMedia.value = option;
}

const setMovieInfos = ((title, id) => {
    movieTitle.value = title;
    movieId.value = id;
})

const getReleaseYear = ((releaseDate) => {
    return new Date(releaseDate).getFullYear();
})
</script>

<template>
    <div class="nav-header flex -align-center">
        <div class="nav-wrapper flex -align-center" v-if="!addForm">
            <button class="input-btn" @click="onHandleAdd">
                <Svg name="add"/>
            </button>
            <button class="input-btn flex">
                <Svg name="search"/>
            </button>
        </div>

        <form class="form" v-if="addForm" @submit.prevent>
            <div class="form-content flex -align-center">
                <input type="text" name="movie" id="movie" class="text-input input-body" placeholder="Titre du film"
                       v-model="movieTitle" autocomplete="off">
                <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected"
                           open-direction="bottom"/>
                <button class="input-btn" type="button" @click="addMovie">
                    <Svg name="add"/>
                </button>
            </div>
            <div class="suggestions-container">
                <button v-for="movie in bestResults" class="btn suggestion input-body"
                        @click="setMovieInfos(movie.title, movie.id)">
                    <span class="movie-title">{{ movie.title }}</span>
                    <span class="small-body release-date">{{ getReleaseYear(movie.release_date) }}</span>
                </button>
            </div>
        </form>
        <button class="input-btn" @click="closeForm" v-if="addForm">
            <Svg name="close" :class="`-close`"/>
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