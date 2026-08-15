<script setup>
// Barre de filtres de la vue Événements : regroupement, puis type d'événement.
//
// Volontairement le décalque de `SeancesSeanceFilters` — même segment, même pilule, même menu, mêmes
// métriques. Les deux vues sont jumelles (des cartes dépliables sur la même matière, filtrées par la
// même barre) : leur donner deux grammaires de contrôles obligerait à réapprendre la seconde après
// avoir compris la première.
//
// Purement présentationnel : tous les filtres sont dérivés côté page, en changer ne déclenche jamais
// de requête.
import { onClickOutside } from '@vueuse/core';

const props = defineProps({
    group: { type: String, default: 'film' },
    kind: { type: String, default: 'all' },
    // Types réellement présents cette semaine. Le vocabulaire vient d'Allociné, pas d'une liste
    // figée : offrir un filtre qui ne trouve rien serait pire que ne pas l'offrir.
    kinds: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:group', 'update:kind']);

const GROUPS = [{ value: 'film', label: 'Par film' }, { value: 'day', label: 'Par jour' }];

const menuOpen = ref(false);
const menuEl = ref(null);

onClickOutside(menuEl, () => { menuOpen.value = false; });

// Le libellé du bouton fermé porte la valeur courante : afficher « Type » tout court obligerait à
// rouvrir le menu pour savoir ce qu'on filtre.
const kindLabel = computed(() => props.kind === 'all' ? 'Tous' : props.kind);

const pickKind = (value) => {
    menuOpen.value = false;
    emit('update:kind', value);
};
</script>

<template>
    <div class="events-filters">
        <div class="seg">
            <button v-for="option in GROUPS" :key="option.value" type="button" class="opt"
                    :class="{ '-on': group === option.value }" :aria-pressed="group === option.value"
                    @click="emit('update:group', option.value)">{{ option.label }}</button>
        </div>

        <div ref="menuEl" class="kind">
            <!-- Pas d'`aria-haspopup` : la valeur `true` équivaut par spec à « menu », alors que le
                 panneau n'a volontairement pas les rôles `menu`/`menuitem` (cf. plus bas). -->
            <button type="button" class="trigger" :class="{ '-on': kind !== 'all' }"
                    :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
                <span class="lbl">Type : <strong>{{ kindLabel }}</strong></span>
                <span class="chev" :class="{ '-up': menuOpen }" aria-hidden="true"><Svg name="chevron" /></span>
            </button>

            <!-- Boutons nus, sans `role="menu"` : le rôle ARIA promettrait une navigation aux flèches
                 qu'on n'implémente pas. Des boutons sont focusables et parcourus au Tab. -->
            <div v-if="menuOpen" class="menu">
                <button type="button" class="item" :class="{ '-on': kind === 'all' }"
                        :aria-pressed="kind === 'all'" @click="pickKind('all')">
                    <span class="name">Tous les types</span>
                </button>
                <button v-for="label in kinds" :key="label" type="button" class="item"
                        :class="{ '-on': kind === label }" :aria-pressed="kind === label"
                        @click="pickKind(label)">
                    <span class="name">{{ label }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// Le « pill » de la barre de filtres, identique à celui de la vue Séances.
@mixin pill {
    display: inline-flex;
    align-items: center;
    padding: .8rem 1.2rem;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1rem;
    color: $color-text-muted;
    font: $semi-bold 1.2rem/1 $font-body;
    cursor: pointer;
    transition: border-color .18s ease, color .18s ease;
}

// Le reset du projet coupe les contours (`html:not(.a11y) * { outline: none }`). Ces règles-ci sont
// plus spécifiques, donc le focus clavier reste visible sur les contrôles de la barre.
@mixin ring {
    &:focus-visible {
        outline: 2px solid $color-primary-light;
        outline-offset: 2px;
    }
}

.events-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;

    > .seg {
        display: flex;
        gap: .2rem;
        background: $color-surface-1;
        border: 1px solid $color-border-2;
        border-radius: 1rem;
        padding: .3rem;

        // Rose et non violet, comme dans la vue Séances : le violet dit « événement » dans toute
        // l'app, il ne peut pas dire aussi « option active » sur une page où tout est un événement.
        > .opt {
            @include ring;
            padding: .8rem 1.2rem;
            border-radius: .8rem;
            color: $color-text-muted;
            font: $semi-bold 1.2rem/1 $font-body;
            cursor: pointer;
            transition: background-color .18s ease, color .18s ease;

            &.-on {
                background: $color-primary;
                color: $color-white;
            }
        }
    }
}

.kind {
    position: relative;

    > .trigger {
        @include pill;
        @include ring;
        gap: .8rem;

        > .lbl > strong { color: $color-text; font-weight: $semi-bold; }

        // Le chevron de l'app pointe vers le bas au repos : fermé il ne tourne pas, ouvert il se
        // retourne.
        > .chev {
            display: grid;
            place-items: center;
            transition: transform .18s ease;

            > :deep(svg) { width: 1.4rem; height: 1.4rem; }

            &.-up { transform: rotate(180deg); }
        }

        &.-on { border-color: $color-primary; color: $color-text; }
    }

    > .menu {
        position: absolute;
        top: calc(100% + .6rem);
        left: 0;
        z-index: 30;
        min-width: 24rem;
        padding: .6rem;
        background: $color-surface-2;
        border: 1px solid $color-border-5;
        border-radius: 1.2rem;
        box-shadow: 0 18px 40px rgba(0, 0, 0, .5);

        > .item {
            @include ring;
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 1.2rem;
            width: 100%;
            padding: .8rem 1rem;
            border-radius: .8rem;
            text-align: left;
            cursor: pointer;
            transition: background-color .15s ease;

            > .name { color: $color-text-body; font: $semi-bold 1.25rem/1.2 $font-body; }

            &.-on > .name { color: $color-primary-light; }

            @media (hover: hover) {
                &:hover { background: $color-hover; }
            }
        }
    }
}
</style>
