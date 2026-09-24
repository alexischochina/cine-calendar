<script setup>
// Shell persistant (jamais démonté entre pages) : c'est ce qui fait glisser la pastille du switch
// de vue et charge le state une fois. Les pages ne rendent que le corps via <slot/>.
const store = useMoviesStore()
const {
    movies, sortedMovies, moviesWithoutDate, cinemaNow, eventSoon,
    getMovies, sortMovies, setCatchup, refreshLetterboxdRatings,
    handleMovieAdded, handleMovieExists,
} = useMovieCalendar()

const {
    currentYear, selectedYear, viewMode, sharedSlug, isLibrary,
    selectYear, selectView, selectSharedList, goToMovie, goToSeances, onScrollToToday, onSearch,
} = useCalendarNav()

const { warmSharedLists, sharedGrouped, sharedNotice } = useSharedLists()

const { syncInTheaters } = useInTheatersSync()
const { syncUpcomingEvents } = useUpcomingEvents()

const { catchupNotice } = useCatchupFlow()
const { highlightMessage } = useMovieHighlight()
const { dispatchMovieAdded, dispatchMovieExists, dispatchScrollToToday, dispatchSearchMovie } = useNavEvents()

const mobileYearMenu = ref(false)

// Années disponibles + compteurs (rail gauche / menu mobile).
//
// ⚠️ **La source suit la liste affichée** : garder mes années laisserait cliquer sur des années où
// il n'a rien. `sharedGrouped` est posé par la page, pour que le rail ne diverge pas de l'écran.
const yearList = computed(() => sharedGrouped.value
    ? yearsOf(sharedGrouped.value.grouped, sharedGrouped.value.undated)
    : yearsOf(sortedMovies.value, moviesWithoutDate.value))

const selectedYearLabel = computed(() => selectedYear.value === null ? 'Sans date' : String(selectedYear.value))

const onSelectYear = (year) => {
    mobileYearMenu.value = false
    selectYear(year)
}

const onMovieAdded = async (event) => {
    await handleMovieAdded(event)
    goToMovie(event.detail?.newEntry?.movie_id)
}

const onMovieExists = (event) => {
    const movieId = handleMovieExists(event)
    // Même besoin que la recherche : on vient de chercher ce titre pour l'ajouter, il y était déjà.
    if (movieId) goToMovie(movieId, { highlight: true })
}

// Notes Letterboxd rafraîchies au passage en Stats / changement d'année en Stats.
watch([viewMode, selectedYear], ([mode, year]) => {
    if (mode === 'stats' && year !== null) refreshLetterboxdRatings(year)
})

// Re-tri au changement de filtres. Ici (instance persistante unique) et non dans le composable
// (appelé par plusieurs composants → doublons).
watch(() => store.filters, () => sortMovies(movies.value), { deep: true })

// Auto-dismiss de la notice catchup (timer possédé par le layout, la page stats ne fait que la poser).
let catchupNoticeTimer = null
watch(catchupNotice, (v) => {
    if (catchupNoticeTimer) clearTimeout(catchupNoticeTimer)
    if (v) catchupNoticeTimer = setTimeout(() => { catchupNotice.value = null }, 4500)
})

// Les deux notices se rendent au même endroit : la nouvelle chasse l'ancienne.
watch(sharedNotice, (v) => { if (v) catchupNotice.value = null })

onMounted(async () => {
    window.addEventListener('movie-added', onMovieAdded)
    window.addEventListener('movie-exists', onMovieExists)
    window.addEventListener('scroll-to-today', onScrollToToday)
    window.addEventListener('search-movie', onSearch)
    await getMovies()

    // En tâche de fond et sans `await`, comme `syncInTheaters` plus bas. ⚠️ Après `getMovies` : le
    // compteur se calcule contre **ma** liste.
    warmSharedLists().catch(e => console.error('Listes partagées illisibles', e))
    // Landing par défaut (année courante, timeline) → cadre sur le film du jour ; deep-link respecté.
    if (viewMode.value === 'timeline' && selectedYear.value === currentYear) onScrollToToday()
    else if (viewMode.value === 'stats' && selectedYear.value !== null) refreshLetterboxdRatings(selectedYear.value)

    // Contrôle « en salle » (Allociné), en tâche de fond et **sans await** : il ne doit jamais
    // retarder le premier rendu. Il ne fait quelque chose qu'une fois par semaine ciné ; les jours
    // où il tourne, la timeline et le rail se réordonnent d'eux-mêmes à son retour.
    //
    // Puis, **enchaîné et non lancé en parallèle**, le repérage des avant-premières des films à venir.
    // Les deux partagent le cache L1 des séances et la file par date de `useShowtimes` : les chaîner
    // évite que le second redemande ce que le premier vient de rapporter pour aujourd'hui.
    syncInTheaters()
        .then(() => syncUpcomingEvents())
        .catch(e => console.error('Contrôle Allociné de fond échoué', e))
})

onBeforeUnmount(() => {
    window.removeEventListener('movie-added', onMovieAdded)
    window.removeEventListener('movie-exists', onMovieExists)
    window.removeEventListener('scroll-to-today', onScrollToToday)
    window.removeEventListener('search-movie', onSearch)
    if (catchupNoticeTimer) clearTimeout(catchupNoticeTimer)
})
</script>

<template>
    <div class="timeline-shell">
        <NavSideNav class="shell-rail -left" :years="yearList" :active-year="selectedYear" :view-mode="viewMode"
                    :shared-slug="sharedSlug"
                    @select-year="onSelectYear" @select-view="selectView"
                    @select-shared-list="selectSharedList" />

        <!-- En-tête mobile : titre + pastille année (vues de la liste seulement) + bande d'onglets -->
        <div class="shell-mobilehead">
            <div class="top">
                <div class="brand">Cinégenda</div>
                <button class="year-pill" :class="{ '-hidden': !isLibrary }" type="button"
                        aria-label="Choisir l'année" aria-haspopup="true" :aria-expanded="mobileYearMenu"
                        @click="mobileYearMenu = !mobileYearMenu">
                    {{ selectedYearLabel }}<Svg name="chevron" class="chev" aria-hidden="true" />
                </button>
            </div>
            <NavViewTabs layout="row" :view-mode="viewMode" :shared-slug="sharedSlug"
                         @select-view="selectView" @select-shared-list="selectSharedList" />
        </div>

        <!-- `--rail-space` dépend seulement de la présence de films en salle (pas de la vue) → stable
             pendant un switch, donc la vue sortante ne se recomprime pas pendant le crossfade. -->
        <div class="shell-main" :style="{ '--rail-space': (cinemaNow.length || eventSoon.length) ? '26.4rem' : '0px' }">
            <slot />
        </div>

        <!-- Rail droit en overlay (hors flux) → largeur de shell-main constante entre les vues.
             ⚠️ Affiché aussi sur une liste partagée, où il montre toujours **mes** films en salle
             (comme la maquette) — le masquer ferait sauter la largeur du contenu. -->
        <Transition name="rail">
            <CinemaNowPanel v-if="viewMode === 'timeline' || viewMode === 'shared'"
                            class="shell-rail -right" variant="rail"
                            :movies="cinemaNow" :event-movies="eventSoon" @select-movie="goToSeances" />
        </Transition>

        <!-- Équivalent parlé de la ligne marquée par une recherche. Toujours rendue, jamais derrière un
             `v-if` : une région live insérée en même temps que son texte n'est pas annoncée. -->
        <p class="sr" role="status">{{ highlightMessage }}</p>

        <!-- Notice « ajouté à la liste à rattraper de <année> » -->
        <Transition name="notice">
            <div v-if="catchupNotice" class="catchup-notice" role="status">
                <span class="msg">« {{ catchupNotice.title }} » ajouté à ta liste à rattraper de
                    <strong>{{ catchupNotice.yearLabel }}</strong></span>
            </div>
        </Transition>

        <!-- Notice « ajouté à ta liste ». Même gabarit que ci-dessus, liseré vert plutôt que rose. -->
        <Transition name="notice">
            <div v-if="sharedNotice" class="catchup-notice -added" role="status">
                <span class="msg">« {{ sharedNotice.title }} » ajouté à ta liste</span>
            </div>
        </Transition>

        <!-- Menu année (mobile) -->
        <div v-if="mobileYearMenu" class="year-overlay" @click="mobileYearMenu = false">
            <div class="year-sheet" role="dialog" aria-label="Choisir l'année" @click.stop>
                <button v-for="y in yearList" :key="y.label" class="year" :class="{ '-active': y.year === selectedYear }"
                        type="button" @click="onSelectYear(y.year)">
                    <span>{{ y.label }}</span>
                    <span class="count">{{ y.count }}</span>
                </button>
            </div>
        </div>

        <NavHeader @movie-added="dispatchMovieAdded" @movie-exists="dispatchMovieExists"
                   @scroll-to-today="dispatchScrollToToday" @search-movie="dispatchSearchMovie" />
    </div>
</template>

<style lang="scss" scoped>
// Contenu lu par les lecteurs d'écran (cf. `srOnly` dans `assets/styles/_a11y.scss`).
.sr { @include srOnly; }

.timeline-shell {
    position: relative; // contexte du rail overlay
    display: flex;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;

    .shell-main {
        position: relative; // ancre le crossfade (vue sortante en position absolute)
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
}

.shell-rail.-right {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
}

.rail-enter-active,
.rail-leave-active { transition: opacity .2s ease; }

.rail-enter-from,
.rail-leave-to { opacity: 0; }

// Menu année (mobile)
.year-overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 0 4rem;
    background: rgba(0, 0, 0, .5);

    .year-sheet {
        width: 26rem;
        background: $color-surface-2;
        border: 1px solid $color-border-4;
        border-radius: 1.6rem;
        padding: .8rem;
        animation: pop .16s ease;

        > .year {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            padding: 1.1rem 1.4rem;
            border-radius: 1rem;
            color: $color-text-muted;
            font: $normal 1.5rem/1 $font-body;
            cursor: pointer;

            > .count { font: $normal 1.1rem/1 $font-mono; color: $color-text-weak; }

            &.-active {
                background: rgba($color-primary, .14);
                color: $color-text;
                font-weight: $bold;

                > .count { color: $color-primary-light; }
            }
        }
    }
}

// En-tête mobile (masqué desktop)
.shell-mobilehead {
    display: none;
    flex: none;
    padding: 2.4rem 1.8rem 1rem;

    > .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.2rem;

        > .brand {
            color: $color-text;
            font: 800 2.1rem/1 $font-title;
            letter-spacing: -.05rem;
        }

        // La pastille ne pilote que Timeline / Stats mais reste **dans le flux** ailleurs : c'est
        // elle qui donne sa hauteur à la rangée, et la retirer faisait remonter toute la page de
        // quelques pixels à chaque changement d'onglet. `visibility` plutôt qu'un `min-height`
        // chiffré à la main (le chevron est plus haut que la ligne de texte, le calcul était faux
        // d'1 px) — et le bouton sort quand même du tab order.
        > .year-pill {
            display: flex;
            align-items: center;
            gap: .6rem;
            padding: .6rem 1rem;
            border-radius: 999px;
            background: $color-surface-3;
            border: 1px solid $color-border-3;
            color: $color-text-dim;
            font: $bold 1.2rem/1 $font-mono;
            cursor: pointer;
            transition: opacity .2s ease, visibility .2s;
            @include focusRing();

            > .chev { width: 1.3rem; height: 1.3rem; }

            // `visibility` dans la transition : bascule discrète, elle attend donc la fin de
            // l'opacité. Même durée que le crossfade des vues.
            &.-hidden {
                visibility: hidden;
                opacity: 0;
            }
        }
    }
}

@keyframes pop {
    from { transform: scale(.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

// Notice « ajouté à la liste à rattraper de <année> »
.catchup-notice {
    position: fixed;
    left: 50%;
    bottom: 9rem;
    transform: translateX(-50%);
    z-index: 60;
    max-width: calc(100vw - 4rem);
    padding: 1.2rem 1.8rem;
    background: $color-surface-2;
    border: 1px solid $color-border-4;
    border-left: 3px solid $color-primary;
    border-radius: 1.2rem;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .6);

    > .msg {
        color: $color-text-dim;
        font: $normal 1.35rem/1.4 $font-body;

        > strong { color: $color-primary-light; font-weight: $bold; }
    }

    &.-added { border-left-color: $color-green; }
}

.notice-enter-active,
.notice-leave-active { transition: opacity .2s ease, transform .2s ease; }

.notice-enter-from,
.notice-leave-to { opacity: 0; transform: translate(-50%, 1rem); }

@media (max-width: 999px) {
    .timeline-shell {
        flex-direction: column;

        .shell-rail { display: none; }
    }

    .shell-mobilehead { display: block; }
}
</style>
