<script setup>
import { refDebounced } from "@vueuse/shared";

// Slider « À rattraper » : films personnellement marqués catchup pour l'année, + slots
// « Ajouter » (dashed) jusqu'à 15. Clic carte → film dans la timeline. Clic « Ajouter » →
// popin de recherche : suggestions dans MA liste (non vus de l'année), fallback API TMDB.
const props = defineProps({
    movies: { type: Array, default: () => [] },
    year: { type: [Number, null], default: null },
});

const emit = defineEmits(['toggle-catchup', 'go-to-movie', 'add-catchup-movie']);

// Films catchup de l'année : datés dans l'année, ou sans date FR mais rattachés via `catchup_year`.
// Ordre = date d'ajout (`catchup_at`) croissante, le plus récent à droite ; repli sur `id` si null.
const addedAt = (m) => (m.catchup_at ? new Date(m.catchup_at).getTime() : 0);
const catchup = computed(() =>
    props.movies
        .filter(m => m.catchup && (
            yearOf(m.release_date) === props.year ||
            (m.release_date == null && m.catchup_year === props.year)
        ))
        .sort((a, b) => addedAt(a) - addedAt(b) || a.id - b.id)
);
const MAX_CATCHUP = 15;
const slots = computed(() => Math.max(0, MAX_CATCHUP - catchup.value.length));

// Films non vus, déjà sortis, de l'année, pas déjà catchup — vivier des suggestions « liste ».
const pool = computed(() =>
    props.movies.filter(m =>
        m.state !== 'seen' &&
        !m.catchup &&
        yearOf(m.release_date) === props.year &&
        m.release_date && m.release_date <= today()
    )
);

// ---- Popin de recherche ----
const showPicker = ref(false);
const query = ref('');
const debouncedQuery = refDebounced(query, 300);
const pickerInput = ref(null);
const modalEl = ref(null);
const tmdbMatches = ref([]);
// Élément focalisé avant l'ouverture, pour lui rendre le focus à la fermeture (a11y).
let lastFocused = null;

const onKeydown = (e) => {
    if (e.key === 'Escape') { closePicker(); return; }
    // Piège le focus dans la modale : Tab depuis le dernier focusable revient au premier (et inversement).
    if (e.key !== 'Tab' || !modalEl.value) return;
    const focusables = modalEl.value.querySelectorAll(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
};
const openPicker = () => {
    lastFocused = document.activeElement;
    showPicker.value = true;
    query.value = '';
    tmdbMatches.value = [];
    window.addEventListener('keydown', onKeydown);
    nextTick(() => pickerInput.value?.focus());
};
const closePicker = () => {
    showPicker.value = false;
    window.removeEventListener('keydown', onKeydown);
    lastFocused?.focus?.();
    lastFocused = null;
};
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const toOption = (m) => ({
    source: 'list',
    key: `l-${m.id}`,
    id: m.id,
    movie_id: m.movie_id,
    title: m.title,
    poster_path: m.poster_path,
    dateShort: dateShort(m.release_date),
});

// Query vide → 10 derniers non-vus de l'année (date desc). Saisie → filtre titre (max 5).
const localMatches = computed(() => {
    const term = debouncedQuery.value.trim().toLowerCase();
    if (!term) {
        return [...pool.value]
            .sort((a, b) => new Date(b.release_date) - new Date(a.release_date))
            .slice(0, 10)
            .map(toOption);
    }
    return pool.value
        .filter(m => (m.title || '').toLowerCase().includes(term))
        .slice(0, 5)
        .map(toOption);
});

// Fallback TMDB (max 5) uniquement quand la saisie ne matche aucun film de ma liste.
// La présence locale est recalculée directement depuis `pool` (et non via le computed
// `localMatches`) pour que le fallback se déclenche de façon fiable, sans dépendre du cache réactif.
watch(debouncedQuery, async (term) => {
    tmdbMatches.value = [];
    const q = term.trim();
    if (!showPicker.value || !q) return;
    const needle = q.toLowerCase();
    const hasLocal = pool.value.some(m => (m.title || '').toLowerCase().includes(needle));
    if (hasLocal) return;
    try {
        const data = await $fetch(`/api/movies/search?query=${encodeURIComponent(q)}`);
        tmdbMatches.value = (data?.results ?? []).slice(0, 5).map(r => ({
            source: 'tmdb',
            key: `t-${r.id}`,
            movie_id: r.id,
            title: r.title,
            poster_path: r.poster_path,
            dateShort: dateShort(r.release_date),
        }));
    } catch (e) {
        console.error('Recherche TMDB fallback échouée:', e);
    }
});

const suggestions = computed(() =>
    localMatches.value.length ? localMatches.value : tmdbMatches.value
);

const selectSuggestion = (o) => {
    if (o.source === 'list') emit('toggle-catchup', o.id, true);
    else emit('add-catchup-movie', { movieId: o.movie_id, media: 'cinema', year: props.year });
    closePicker();
};
</script>

<template>
    <section class="stats-catchup card">
        <div class="head flex -align-center">
            <div class="label">À rattraper</div>
            <div class="count">{{ catchup.length }}/{{ MAX_CATCHUP }}</div>
        </div>

        <swiper-container class="strip" slides-per-view="auto" :space-between="12" free-mode="true">
            <swiper-slide v-for="f in catchup" :key="f.id" class="cell">
                <!-- Deux boutons frères (pas d'imbrication interactive) : la carte ouvre le film,
                     le bouton retrait est superposé sur l'affiche. -->
                <div class="cardwrap">
                    <button type="button" class="cardbtn" @click="emit('go-to-movie', f.movie_id)">
                        <div class="poster">
                            <NuxtImg v-if="posterUrl(f.poster_path)" :src="posterUrl(f.poster_path)"
                                     :alt="f.title ? `Affiche du film ${f.title}` : ''" class="img" loading="lazy" />
                            <div v-else class="img -placeholder" />
                        </div>
                        <div class="title">{{ f.title }}</div>
                    </button>
                    <button type="button" class="remove" aria-label="Retirer de la liste à rattraper"
                            @click="emit('toggle-catchup', f.id, false)"><Svg name="close" /></button>
                </div>
            </swiper-slide>

            <swiper-slide v-for="i in slots" :key="`slot-${i}`" class="cell">
                <!-- Slot pleine hauteur d'une carte (réserve l'espace du titre, vide) pour que la
                     bande ne « saute » pas ; seule la boîte du haut (format affiche) est pointillée. -->
                <button type="button" class="slot" @click="openPicker">
                    <span class="box flex -direction-column -align-center -justify-center">
                        <Svg name="add" class="ico" />
                        <span class="txt">Ajouter</span>
                    </span>
                </button>
            </swiper-slide>
        </swiper-container>

        <!-- Popin de recherche -->
        <div v-if="showPicker" class="overlay flex -justify-center" @click="closePicker">
            <div ref="modalEl" class="modal flex -direction-column" role="dialog" aria-modal="true" aria-label="Ajouter un film à rattraper" @click.stop>
                <div class="mhead flex -align-center -justify-space-between">
                    <div class="mtitle">À rattraper</div>
                    <button type="button" class="close" aria-label="Fermer" @click="closePicker"><Svg name="close" /></button>
                </div>
                <input ref="pickerInput" v-model="query" type="text" class="search input-body"
                       placeholder="Rechercher un film…" aria-label="Rechercher un film à rattraper" autocomplete="off" />
                <div class="options">
                    <button v-for="o in suggestions" :key="o.key" type="button"
                            class="option flex -align-center" @click="selectSuggestion(o)">
                        <NuxtImg v-if="posterUrl(o.poster_path)" :src="posterUrl(o.poster_path)"
                                 :alt="o.title ? `Affiche du film ${o.title}` : ''" class="mini" loading="lazy" />
                        <span v-else class="mini -placeholder" />
                        <span class="meta">
                            <span class="otitle">{{ o.title }}</span>
                            <span class="odate">{{ o.dateShort }}</span>
                        </span>
                    </button>
                    <div v-if="!suggestions.length" class="empty">Aucun résultat.</div>
                </div>
            </div>
        </div>
    </section>
</template>

<style lang="scss" scoped>
.stats-catchup {
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;
    min-width: 0;
    overflow: hidden;

    > .head {
        gap: 1rem;
        margin-bottom: 1.4rem;

        > .label {
            color: $color-text-weak;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .12rem;
            text-transform: uppercase;
        }

        > .count {
            color: $color-text-weak;
            font: $normal 1.1rem/1 $font-mono;
        }
    }

    > .strip {
        display: block;

        .cell { width: 9.6rem; }
    }

    .cardwrap {
        position: relative;

        > .remove {
            position: absolute;
            top: .6rem;
            right: .6rem;
            display: grid;
            place-items: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: rgba(0, 0, 0, .65);
            color: $color-primary-lighter;
            cursor: pointer;

            > :deep(svg) { width: 1.2rem; height: 1.2rem; }
        }
    }

    .cardbtn {
        display: block;
        width: 100%;
        text-align: left;
        cursor: pointer;
    }

    .poster {
        width: 9.6rem;
        height: 14.4rem;
        border-radius: 1rem;
        overflow: hidden;
        background: $color-surface-4;

        > .img {
            width: 100%;
            height: 100%;
            object-fit: cover;

            &.-placeholder { background: linear-gradient(150deg, $color-surface-3, $color-surface-1); }
        }
    }

    .title {
        margin-top: .6rem;
        // Hauteur réservée pour 2 lignes (1.15rem × 1.25 × 2) : la carte a toujours la même
        // hauteur totale, identique à celle d'un slot « Ajouter » → pas de saut vertical quand
        // on ajoute le premier film dans une liste vide.
        height: 2.875rem;
        color: $color-text-dim;
        font: $semi-bold 1.15rem/1.25 $font-body;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .slot {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 9.6rem;
        // = affiche (14.4) + marge titre (.6) + hauteur titre 2 lignes (2.875) : réserve la
        // hauteur totale d'une carte pour que la bande ne saute pas ; l'espace titre reste vide.
        height: 17.875rem;
        cursor: pointer;

        > .box {
            gap: .6rem;
            width: 9.6rem;
            height: 14.4rem;
            border: 1px dashed $color-border-5;
            border-radius: 1rem;
            color: $color-text-weak;
            transition: border-color .18s ease, color .18s ease;

            > .ico { width: 1.8rem; height: 1.8rem; }
            > .txt { font: $medium 1.2rem/1 $font-body; }
        }

        @media (hover: hover) {
            &:hover > .box { border-color: $color-primary; color: $color-primary-light; }
        }
    }
}

// ---- Popin ----
.overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    // Ancrée en haut (pas de centrage vertical) : le champ de recherche garde une
    // position fixe quel que soit le nombre de suggestions.
    align-items: flex-start;
    padding: 8vh 2rem 2rem;
    background: rgba(0, 0, 0, .6);
}

.modal {
    width: 42rem;
    max-width: 100%;
    max-height: calc(92vh - 2rem);
    padding: 2rem;
    background: $color-surface-1;
    border: 1px solid $color-border-4;
    border-radius: 2rem;
    box-shadow: 0 30px 70px rgba(0, 0, 0, .6);
    animation: catchup-pop .18s ease;

    > .mhead {
        margin-bottom: 1.4rem;

        > .mtitle { color: $color-text; font: 800 1.8rem/1 $font-title; }

        > .close {
            display: grid;
            place-items: center;
            color: $color-text-muted;
            cursor: pointer;

            > :deep(svg) { width: 2rem; height: 2rem; }
        }
    }

    > .search {
        width: 100%;
        padding: 1rem 1.2rem;
        background: $color-surface-4;
        border: 1px solid $color-border-3;
        border-radius: 1.2rem;
        color: $color-text-body;
        margin-bottom: 1.2rem;
    }

    > .options {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;

        > .option {
            gap: 1.1rem;
            width: 100%;
            padding: .7rem .9rem;
            border-radius: 1.1rem;
            text-align: left;
            cursor: pointer;
            transition: background .18s ease;

            > .mini {
                width: 3.2rem;
                height: 4.8rem;
                flex: none;
                border-radius: .5rem;
                object-fit: cover;

                &.-placeholder { background: $color-surface-4; }
            }

            > .meta {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: .2rem;

                > .otitle {
                    color: $color-text-body;
                    font: $semi-bold 1.35rem/1.2 $font-body;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                > .odate { color: $color-text-weaker; font: $normal 1.05rem/1 $font-mono; }
            }

            @media (hover: hover) {
                &:hover { background: rgba(255, 255, 255, .04); }
            }
        }

        > .empty {
            padding: 2rem 0;
            text-align: center;
            color: $color-text-weak;
            font: $normal 1.3rem/1 $font-body;
        }
    }
}

@keyframes catchup-pop {
    from { transform: scale(.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}
</style>
