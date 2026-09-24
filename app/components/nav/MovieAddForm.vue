<script setup>
import {refDebounced} from "@vueuse/shared";

const emit = defineEmits(['movie-added', 'movie-exists'])

const movieTitle = ref("")
const selectedMedia = ref('cinema');
const client = useSupabaseClient();
const user = useSupabaseUser();
const page = ref(1);
const movieId = ref(0);
const movieSelected = ref(false);
const movieInput = ref(null)

const debouncedMovieTitle = refDebounced(movieTitle, 300);

const url = computed(() => `/api/movies/search?query=${encodeURIComponent(debouncedMovieTitle.value)}&page=${page.value}`);

const {data} = await useFetch(url)

const bestResults = computed(() => data.value ? data.value.results.slice(0, 5) : []);

const listboxId = useId();
const activeIndex = ref(-1);
const suggestionsDismissed = ref(false);

const suggestionsOpen = computed(() =>
    !movieSelected.value && !suggestionsDismissed.value && !!movieTitle.value && bestResults.value.length > 0);

const activeSuggestionId = computed(() =>
    activeIndex.value >= 0 ? `${listboxId}-option-${activeIndex.value}` : undefined);

// Les résultats se renouvellent à chaque frappe : un index conservé désignerait un autre film.
watch(bestResults, () => { activeIndex.value = -1; });

const resetForm = () => {
    movieTitle.value = '';
    movieId.value = 0;
    movieSelected.value = false;
    selectedMedia.value = 'cinema';
    activeIndex.value = -1;
    suggestionsDismissed.value = false;
    nextTick(() => movieInput.value?.focus());
}

const addMovie = async () => {
    if (!movieId.value) return;
    try {
        // ⚠️ `.eq('user_id', …)` : la lecture de `calendar` n'est plus cloisonnée par RLS (cf.
        // `useMovieCalendar.getMovies`). Sans lui, `maybeSingle()` **lève** dès que l'autre compte a
        // le même film, et l'ajout part dans le `catch` — le seul indice étant une ligne de console.
        const { data: existing } = await client
            .from('calendar')
            .select('id')
            .eq('movie_id', movieId.value)
            .eq('user_id', userIdOf(user.value))
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
                // ⚠️ Explicite bien que la colonne porte `default auth.uid()` : ce défaut vaut
                // `null` en service-role (scripts, cron), donc s'y fier ici apprendrait à ne pas le
                // poser là où il ne rattraperait rien.
                user_id: userIdOf(user.value),
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
        // Ici plutôt qu'à la réception de `movie-added` : le layout `bare` émet sans écouter.
        // Après l'emit et sans `await` — l'insert est acquis, et le slug deviné s'affiche en
        // attendant plutôt que de retenir la fermeture du formulaire jusqu'à 8 s.
        void resolveLetterboxdDirectors(client, newEntry);
    } catch (error) {
        console.error("Erreur lors de l'insertion:", error.message);
    }
}

const onMediaSelected = (option) => { selectedMedia.value = option; }

const setMovieInfos = (title, id) => {
    movieTitle.value = title;
    movieId.value = id;
    movieSelected.value = true;
    activeIndex.value = -1;
    nextTick(() => movieInput.value?.focus());
}

const onInput = () => {
    movieSelected.value = false;
    suggestionsDismissed.value = false;
}

const moveActive = (step) => {
    if (!suggestionsOpen.value) return;
    const count = bestResults.value.length;
    activeIndex.value = activeIndex.value === -1
        ? (step > 0 ? 0 : count - 1)
        : (activeIndex.value + step + count) % count;
}

const dismissSuggestions = () => {
    suggestionsDismissed.value = true;
    activeIndex.value = -1;
}

const onEnter = () => {
    const active = suggestionsOpen.value ? bestResults.value[activeIndex.value] : null;
    if (active) return setMovieInfos(active.title, active.id);
    if (movieSelected.value) addMovie();
}

const getReleaseYear = (releaseDate) => new Date(releaseDate).getFullYear();
</script>

<template>
    <form class="add-form" @submit.prevent>
        <div class="form-content flex -align-center">
            <input ref="movieInput" type="text" name="movie" id="movie" class="text-input input-body"
                   placeholder="Titre du film" aria-label="Titre du film à ajouter" v-model="movieTitle" autocomplete="off"
                   role="combobox" aria-autocomplete="list" :aria-expanded="suggestionsOpen"
                   :aria-controls="listboxId" :aria-activedescendant="activeSuggestionId"
                   @input="onInput"
                   @keydown.down.prevent="moveActive(1)"
                   @keydown.up.prevent="moveActive(-1)"
                   @keydown.escape="dismissSuggestions"
                   @keydown.enter.prevent="onEnter">
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected" open-direction="bottom"/>
            <button class="input-btn" type="button" @click="addMovie" aria-label="Ajouter le film">
                <Svg name="add"/>
            </button>
        </div>
        <ul class="suggestions-container" v-if="suggestionsOpen" :id="listboxId" role="listbox"
            aria-label="Suggestions de films">
            <li v-for="(movie, index) in bestResults" :key="movie.id" class="suggestion input-body"
                :id="`${listboxId}-option-${index}`" role="option"
                :aria-selected="index === activeIndex" :class="{ '-active': index === activeIndex }"
                @mouseenter="activeIndex = index"
                @click="setMovieInfos(movie.title, movie.id)">
                <span class="movie-title">{{ movie.title }}</span>
                <span class="small-body release-date">{{ getReleaseYear(movie.release_date) }}</span>
            </li>
        </ul>
    </form>
</template>

<style lang="scss" scoped>
.form-content {
    gap: .5rem;
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

// Le bloc conteneur est `.nav-header`, pas le formulaire (contrat noté dans `nav/Header.vue`) :
// c'est ce qui donne au panneau la largeur de la barre entière.
.suggestions-container {
    background-color: $color-surface-2;
    border: 1px solid $color-border-5;
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 1rem);
    border-radius: 1.4rem;
    overflow: hidden;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .6);
}

.suggestion {
    display: flex;
    align-items: baseline;
    gap: .8rem;
    padding: 1.1rem 1.4rem;
    cursor: pointer;
    transition: background-color .2s linear;

    & + & {
        border-top: solid 1px $color-border-2;
    }

    // Pas de `:hover` : souris et clavier passent tous deux par `-active`, sinon le surlignage
    // visuel et l'option annoncée par `aria-activedescendant` peuvent désigner deux films.
    &.-active {
        background-color: $color-hover-strong;
    }
}

.movie-title {
    color: $color-text;
    font: $semi-bold 1.4rem/1 $font-body;
}

.release-date {
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
}
</style>
