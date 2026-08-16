<script setup>
// ⚠️ Import explicite : `@vueuse/nuxt` est en dépendance mais pas dans `modules` (nuxt.config.ts),
// donc rien de @vueuse n'est auto-importé. Même convention que `nav/FilterPanel.vue`.
import { useMediaQuery } from '@vueuse/core';

// Rail gauche desktop : titre, navigation groupée, puis un bloc de contexte qui dépend de la vue.
// Années + statuts ne servent qu'à Timeline / Stats ; sur Séances / Événements ils ne pilotaient
// rien et laissaient croire à un filtre année. Ces deux vues montrent les cinémas favoris à la place.
const props = defineProps({
    years: {
        type: Array,
        default: () => [],
    },
    activeYear: {
        type: [Number, null],
        default: null,
    },
    viewMode: {
        type: String,
        default: 'timeline',
    },
});

const emits = defineEmits(['select-year', 'select-view']);

// La règle vient de `useCalendarNav` (dérivée de `YEARLESS_VIEWS`), pas d'une liste réécrite ici.
const isLibrary = computed(() => isLibraryView(props.viewMode));
const isCity = computed(() => isYearlessView(props.viewMode));

const isActive = (y) => y.year === props.activeYear;

// Purement dérivé de `movies` : aucun réseau, donc tenable depuis un rail monté sur toutes les pages.
const { nbEvents } = useEventFilms();

const { cinemas, loadCinemas, toggleFavorite } = useCinemas();

// Le rail est masqué en CSS sous 1000 px mais reste **monté** : sans cette seconde condition,
// arriver sur /evenements depuis un téléphone lisait le référentiel salles pour un bloc invisible.
// Borne écrite en clair comme les `@media (max-width: 999px)` du projet.
const railVisible = useMediaQuery('(min-width: 1000px)');

watch(
    () => isCity.value && railVisible.value,
    // Non attendu : le rail se rend sans le référentiel et se remplit à son retour.
    (needed) => { if (needed) loadCinemas().catch(e => console.error('Référentiel salles illisible', e)); },
    { immediate: true }
);

// Même ordre que dans la vue Séances : arrondissement croissant, puis nom.
const favoriteCinemas = computed(() => Object.values(cinemas.value ?? {})
    .filter(c => c.favorite)
    .sort((a, b) => (a.arrondissement ?? 99) - (b.arrondissement ?? 99)
        || String(a.name).localeCompare(String(b.name))));
</script>

<template>
    <aside class="side-nav scr">
        <div class="brand">Ma cinémathèque</div>

        <NavViewTabs :view-mode="viewMode" :event-count="nbEvents"
                     @select-view="emits('select-view', $event)" />

        <div class="divider" />

        <template v-if="isLibrary">
            <div class="block">
                <div class="heading">Année</div>
                <nav class="years" aria-label="Aller à une année">
                    <button v-for="y in years" :key="y.label" class="year" :class="{ '-active': isActive(y) }"
                            type="button" @click="emits('select-year', y.year)">
                        <span class="label">{{ y.label }}</span>
                        <span class="count">{{ y.count }}</span>
                    </button>
                </nav>
            </div>

            <div class="legend">
                <div class="heading">Statuts</div>
                <span class="row"><span class="dot -green" />Vu au ciné</span>
                <span class="row"><span class="dot -amber" />Vu en streaming</span>
                <span class="row"><span class="dot -rose" />En salle</span>
                <span class="row"><span class="dot -grey" />À venir</span>
            </div>
        </template>

        <div v-else-if="isCity" class="favs">
            <div class="heading">Cinémas favoris</div>
            <ul v-if="favoriteCinemas.length" class="list">
                <li v-for="cinema in favoriteCinemas" :key="cinema.code" class="fav">
                    <button class="star" type="button" :aria-label="`Retirer ${cinema.name} des favoris`"
                            @click="toggleFavorite(cinema.code)">
                        <Svg name="star" class="ico" aria-hidden="true" />
                    </button>
                    <div class="info">
                        <div class="name">{{ cinema.name }}</div>
                        <div v-if="cinema.arrondissement" class="arr">{{ arrondissementLabel(cinema.arrondissement) }} arr.</div>
                    </div>
                </li>
            </ul>
            <p v-else class="empty">
                Étoile un cinéma dans la liste pour le retrouver ici et le remonter en tête.
            </p>
        </div>
    </aside>
</template>

<style lang="scss" scoped>
.side-nav {
    width: 22rem;
    flex: none;
    border-right: 1px solid $color-border-1;
    padding: 2.4rem 1.8rem;
    display: flex;
    flex-direction: column;
    gap: 1.8rem;
    overflow: auto;
}

.brand {
    color: $color-text;
    font: 800 2.1rem/1 $font-title;
    letter-spacing: -.05rem;
}

.block {
    display: flex;
    flex-direction: column;
    gap: .6rem;

    > .heading { @include railHeading(); }
}

.years {
    display: flex;
    flex-direction: column;
    gap: .2rem;

    > .year {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: .7rem 1rem;
        border-radius: .8rem;
        border-left: 3px solid transparent;
        color: $color-text-muted;
        font: $normal 1.3rem/1 $font-body;
        cursor: pointer;
        transition: background-color .15s linear, color .15s linear;
        @include focusRing();

        > .count {
            font: $normal 1rem/1 $font-mono;
            color: $color-text-weak;
        }

        &.-active {
            background: linear-gradient(90deg, rgba($color-primary, .16), transparent);
            border-left-color: $color-primary;
            color: $color-text;
            font-weight: $bold;

            > .count { color: $color-primary-light; }
        }

        @media (hover: hover) {
            &:not(.-active):hover { background: rgba($color-white, .04); }
        }
    }
}

.divider {
    height: 1px;
    background: $color-border-1;
}

.legend {
    display: flex;
    flex-direction: column;
    gap: .9rem;

    > .heading { @include railHeading(); }

    > .row {
        display: flex;
        align-items: center;
        gap: .8rem;
        color: $color-text-dim;
        font: $medium 1.2rem/1 $font-body;

        > .dot {
            width: 1rem;
            height: 1rem;
            border-radius: 3px;
            flex-shrink: 0;

            &.-green { background: $color-green; }
            &.-amber { background: $color-yellow; }
            &.-rose { background: $color-primary; }
            &.-grey { background: $color-status-grey; }
        }
    }
}

.favs {
    display: flex;
    flex-direction: column;
    gap: .9rem;

    > .heading { @include railHeading(); }

    > .list {
        display: flex;
        flex-direction: column;
        gap: .9rem;
    }

    .fav {
        display: flex;
        align-items: flex-start;
        gap: .7rem;

        > .star {
            flex: none;
            display: grid;
            place-items: center;
            padding-top: .1rem;
            color: $color-yellow;
            cursor: pointer;
            @include focusRing();

            > .ico { width: 1.2rem; height: 1.2rem; }
        }

        > .info {
            min-width: 0;

            > .name {
                color: $color-text-dim;
                font: $medium 1.2rem/1.2 $font-body;
            }

            > .arr {
                margin-top: .1rem;
                color: $color-text-weak;
                font: $normal 1rem/1 $font-mono;
            }
        }
    }

    > .empty {
        color: $color-text-weak;
        font: $normal 1.15rem/1.5 $font-body;
    }
}
</style>
