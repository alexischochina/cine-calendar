<script setup>
const emits = defineEmits(['movie-deleted', 'release-date-updated', 'toggle-catchup', 'add-to-list']);

const props = defineProps({
    releaseDay: {
        type: String,
    },
    movieId: {
        type: Number,
    },
    media: {
        type: String,
        default: 'unknown',
        validator: value => ['cinema', 'streaming', 'netflix', 'primeVideo', 'disney+', 'vod'].includes(value)
    },
    state: {
        type: String,
        default: 'unseen',
        validator: value => ['unseen', 'seen', 'downloadAvailable', 'inTheaters'].includes(value)
    },
    id: {
        type: Number,
        required: true,
    },
    manualReleaseDate: {
        type: String,
        default: null,
    },
    title: {
        type: String,
        default: '',
    },
    posterPath: {
        type: String,
        default: null,
    },
    director: {
        type: String,
        default: null,
    },
    // Colonne `letterboxd_directors`. Null tant que la ligne n'est pas résolue : `directorLinks`
    // retombe alors sur le slug deviné.
    letterboxdDirectors: {
        type: Array,
        default: null,
    },
    releaseDate: {
        type: String,
        default: null,
    },
    catchup: {
        type: Boolean,
        default: false,
    },
    // Ligne appartenant à un **autre compte** : lecture seule complète. ⚠️ Pas de la cosmétique — un
    // `update` sur sa ligne toucherait **zéro ligne sans lever**, donc un sélecteur laissé actif
    // changerait d'état à l'écran, rien en base, et personne ne le dirait.
    shared: {
        type: Boolean,
        default: false,
    },
    // En mode `shared` : déjà dans ma liste ?
    alreadyMine: {
        type: Boolean,
        default: false,
    },
})
const selectedMedia = ref(props.media);
const selectedState = ref(props.state);
const client = useSupabaseClient();

// L'état est aussi écrit **de l'extérieur** : `useInTheatersSync` fait entrer et sortir les films de
// « En salle » en tâche de fond. La ligne n'est pas remontée pour autant (`:key="movie.id"` dans
// TimelineList), donc sans ce report la pastille et le liseré resteraient sur l'ancienne valeur
// jusqu'au prochain rechargement complet.
watch(() => props.state, (state) => { selectedState.value = state });

const onMediaSelected = (option) => {
    selectedMedia.value = option;
    updateMedia(option)
}

const onStateSelected = (option) => {
    selectedState.value = option;
    updateState(option);
}

const updateMedia = async (newMedia) => {
    await client.from('calendar').update({ media: newMedia }).eq('id', props.id)
}

const updateState = async (newState) => {
    await client.from('calendar').update({ state: newState }).eq('id', props.id)
}

// Sous-titre de droite : réalisateur si connu, sinon libellé état/média.
const MEDIA_LABELS = { cinema: 'Cinéma', netflix: 'Netflix', primeVideo: 'Prime Video', 'disney+': 'Disney+', streaming: 'Streaming', vod: 'Streaming', unknown: 'Streaming' };
// En salle : le nom du réal reste dans le sous-titre, le badge « En salle » se cale à droite du titre.
const isInTheaters = computed(() => selectedState.value === 'inTheaters');
// Une entrée cliquable par personne, chacune portant son `sep` — sans quoi le gabarit empile trois
// `<template>` pour un `v-if="i"`.
const directors = computed(() => directorLinks(props.director, props.letterboxdDirectors));
// Marque « c'est cette ligne » posée par une recherche : elle vient du rendu, pas d'une classe ajoutée
// sur le DOM, qu'un patch du `:class` ci-dessous effacerait (cf. `useMovieHighlight`).
const { highlightedMovieId, clearMovieFlash } = useMovieHighlight();
const isFlashing = computed(() => highlightedMovieId.value === props.movieId);
// ⚠️ Ancre de scroll, et **seulement sur ma liste** : `useMovieScroll` la cible par un
// `document.querySelector`, donc en global, et deux listes coexistent le temps d'un crossfade.
const anchorClass = computed(() => props.shared ? null : `-id-${props.movieId}`);

// Libellés des pastilles inertes : sans texte visible, l'information passe par `aria-label`.
const STATE_LABELS = { unseen: 'envie de voir', seen: 'vu', downloadAvailable: 'dispo en téléchargement', inTheaters: 'en salle' };
const mediaLabel = computed(() => MEDIA_LABELS[selectedMedia.value] || 'Streaming');
const stateLabel = computed(() => STATE_LABELS[selectedState.value] ?? selectedState.value);

// Repli quand le réalisateur est inconnu : un libellé, jamais un lien.
const subFallback = computed(() => {
    if (selectedState.value === 'seen') return MEDIA_LABELS[selectedMedia.value] || 'Streaming';
    if (selectedState.value === 'inTheaters') return MEDIA_LABELS[selectedMedia.value] || 'Cinéma';
    if (selectedState.value === 'downloadAvailable') return 'Dispo en téléchargement';
    return 'Envie de voir';
});
</script>

<template>
    <!-- `.self` : `animationend` remonte, et `MovieActionsBtn` anime son popover à l'intérieur de la
         ligne — sans le modificateur, ouvrir le menu ⋯ couperait le clignotement. -->
    <div class="movie-list-item"
         :class="[`-${selectedMedia}`, `-state-${selectedState}`, anchorClass, { '-flash': isFlashing }]"
         @animationend.self="clearMovieFlash(props.movieId)">
        <div class="day">{{ props.releaseDay }}</div>
        <NuxtImg v-if="props.posterPath" :src="`https://image.tmdb.org/t/p/w342${props.posterPath}`"
                 :alt="props.title ? `Affiche du film ${props.title}` : ''" class="poster" loading="lazy" />
        <div v-else class="poster -placeholder" />
        <div class="info">
            <div class="title-row">
                <a :href="`https://letterboxd.com/tmdb/${props.movieId}/`" target="_blank" rel="noopener" class="title">{{ props.title }}</a>
                <span v-if="isInTheaters" class="badge">En salle</span>
            </div>
            <div class="sub">
                <template v-if="directors.length">
                    <template v-for="dir in directors" :key="dir.url">{{ dir.sep }}<a
                        :href="safeUrl(dir.url) || undefined" target="_blank" rel="noopener" class="person"
                        :aria-label="`Filmographie de ${dir.name} sur Letterboxd (nouvel onglet)`"
                    >{{ dir.name }}</a></template>
                </template>
                <template v-else>{{ subFallback }}</template>
            </div>
        </div>
        <!-- Des pastilles inertes plutôt que des sélecteurs neutralisés : un contrôle qui a l'air
             d'ouvrir un menu et n'en ouvre aucun se lit comme une panne. -->
        <template v-if="props.shared">
            <MediaBadge :media="selectedMedia" class="ro-media" role="img" :aria-label="`Média : ${mediaLabel}`" />
            <span class="ro-state" :class="`-${selectedState}`" role="img" :aria-label="`État : ${stateLabel}`">
                <Svg :name="selectedState" aria-hidden="true" />
            </span>
            <AddToListAction :already-mine="props.alreadyMine" @add-to-list="emits('add-to-list')" />
        </template>

        <template v-else>
            <SelectBtn type="media" :selected="selectedMedia" @option-selected="onMediaSelected" />
            <SelectBtn type="state" :selected="selectedState" @option-selected="onStateSelected" />
            <MovieActionsBtn :id="props.id" :manual-release-date="manualReleaseDate"
                             :release-date="props.releaseDate" :catchup="props.catchup"
                             @movie-deleted="emits('movie-deleted', $event)"
                             @release-date-updated="emits('release-date-updated', $event)"
                             @toggle-catchup="(id, value) => emits('toggle-catchup', id, value)" />
        </template>
    </div>
</template>

<style lang="scss" scoped>
.movie-list-item {
    display: flex;
    align-items: center;
    gap: 1.4rem;
    padding: 1.1rem 2.2rem 1.1rem 1.9rem;
    // Bord gauche 3px + fond teinté, pilotés par l'état. Défaut = gris « à venir ».
    --accent: #{$color-status-grey};
    border-left: 3px solid var(--accent);
    background: transparent;

    &.-state-inTheaters {
        --accent: #{$color-primary};
        background: rgba($color-primary, .16);
    }

    &.-cinema.-state-seen {
        --accent: #{$color-green};
        background: rgba($color-green, .15);
    }

    &.-state-seen:is(.-streaming, .-netflix, .-primeVideo, .-disney\+, .-vod) {
        --accent: #{$color-yellow};
        background: rgba($color-yellow, .14);
    }

    // Ligne d'arrivée d'une recherche : deux pulsations pour dire « c'est là ». La durée n'existe qu'ici,
    // la ligne retirant la marque à la fin de l'animation.
    //
    // `box-shadow: inset` plutôt qu'un `background` animé : la teinte se **superpose** au fond de l'état
    // au lieu de l'écraser, donc la pulsation se voit sur les quatre variantes sans une règle par état,
    // et rien ne touche à la boîte.
    //
    // ⚠️ Un `::after` en `opacity` serait compositable, mais au-dessus du contenu il voile le titre, et
    // le passer dessous (`z-index: -1`) demande un contexte d'empilement sur la ligne — qui enfermerait
    // le popover de `MovieActionsBtn` **sous** les lignes suivantes.
    &.-flash {
        animation: flash-target .55s ease-in-out 2;
    }

    // Mouvement réduit : une seule montée-descente lente — on retire le battement, pas le repère.
    @media (prefers-reduced-motion: reduce) {
        &.-flash { animation: flash-target 1.4s ease-in-out 1; }
    }

    > .day {
        width: 3rem;
        text-align: center;
        flex: none;
        color: $color-text-body;
        font: $bold 1.6rem/1 $font-mono;
    }

    > .poster {
        width: 3.8rem;
        height: 5.7rem;
        border-radius: 6px;
        flex: none;
        object-fit: cover;

        &.-placeholder { background: $color-surface-1; }
    }

    // .info disparaît de la mise en page desktop : title-row + sub deviennent frères directs.
    > .info { display: contents; }

    // Titre + badge « En salle » regroupés ; le badge se cale à droite du titre.
    .title-row {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: .8rem;
    }

    .badge {
        flex: none;
        padding: .3rem .55rem;
        border-radius: 4px;
        background: rgba($color-primary, .22);
        color: $color-primary-light;
        font: $bold 1.05rem/1 $font-body;
        text-transform: uppercase;
        letter-spacing: .03em;
        white-space: nowrap;
    }

    .title {
        min-width: 0;
        color: $color-text;
        font: $semi-bold 1.5rem/1.2 $font-body;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color .2s linear;

        @media (hover: hover) {
            &:hover { color: $color-primary-light; }
        }
    }

    .sub {
        width: 12rem;
        flex: none;
        color: $color-text-muted;
        font: $normal 1.25rem/1.2 $font-body;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;

        // Hérite de la teinte du sous-titre, pilotée par l'état juste dessous. Souligné en
        // permanence et pas seulement recoloré au survol : `.sub` mêle libellés inertes et liens, et
        // un appareil tactile large — où `.sub` reste affiché — n'a pas de survol pour les séparer.
        .person {
            color: inherit;
            text-decoration: underline;
            text-decoration-color: currentColor;
            text-decoration-thickness: 1px;
            text-underline-offset: .25em;
            opacity: .85;
            transition: color .2s linear, opacity .2s linear;

            @media (hover: hover) {
                &:hover { color: $color-primary-light; opacity: 1; }
            }
        }
    }

    // Teintes de texte par état.
    &.-state-inTheaters .sub { color: $color-primary-light; }
    &.-state-unseen, &.-state-downloadAvailable {
        .sub { color: $color-text-weak; }
        > .day { color: $color-text-faint; }
        .title { color: $color-text-dim; }
        > .poster { opacity: .78; }
    }
}

// Mêmes gabarits que les sélecteurs qu'elles remplacent, sinon la colonne de droite se décale d'une
// liste à l'autre.
.movie-list-item {
    > .ro-media { flex: none; }

    > .ro-state {
        flex: none;
        display: grid;
        place-items: center;
        width: 2.6rem;
        height: 2.6rem;
        color: $color-text-weak;

        :deep(svg) { width: 1.9rem; height: 1.9rem; }

        &.-seen { color: $color-yellow; }
        &.-downloadAvailable { color: $color-text-muted; }
        &.-inTheaters { color: $color-primary; }
    }

    // Vu au cinéma : vert, comme dans le sélecteur.
    &.-cinema > .ro-state.-seen { color: $color-green; }
}

@media (max-width: 999px) {
    .movie-list-item {
        gap: 1.1rem;
        padding: .9rem 1.4rem .9rem 1.2rem;

        > .day {
            width: 2.4rem;
            font-size: 1.5rem;
        }

        > .poster {
            width: 3.6rem;
            height: 5.4rem;
        }

        // Sur mobile on n'affiche que le titre : le sous-titre (réal) et le badge « En salle » sont masqués.
        > .info {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 0;
        }

        .title { font-size: 1.35rem; }

        .sub,
        .badge { display: none; }
    }
}

@keyframes flash-target {
    50% { box-shadow: inset 0 0 0 100vmax rgba($color-primary, .3); }
}
</style>
