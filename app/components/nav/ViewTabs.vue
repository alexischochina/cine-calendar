<script setup>
// Navigation entre les vues, partagée entre le rail desktop (NavSideNav) et l'en-tête mobile
// (layouts/default.vue).
//
// Le regroupement n'est pas décoratif : c'est lui qui décide du contenu du reste du rail (années +
// statuts pour « Ma liste », cinémas favoris pour « À Paris »).
//
// Disposition `row` : une bande de pilules qui défile. C'est ce défilement qui rend le libellé aux
// onglets — un segmented à colonnes égales ne laisse que ~57 px de texte par onglet sur 375 px, d'où
// l'icône seule qu'il a fallu abandonner.
//
// ⚠️ Le nombre d'onglets n'est plus fixe : les listes partagées en ajoutent un par compte nommé.
const props = defineProps({
    viewMode: {
        type: String,
        default: 'timeline',
    },
    // ⚠️ `viewMode === 'shared'` ne suffit pas : plusieurs onglets partagés peuvent coexister.
    sharedSlug: {
        type: [String, null],
        default: null,
    },
    layout: {
        type: String,
        default: 'stack',
        validator: (v) => ['stack', 'row'].includes(v),
    },
    // Compteur de l'onglet Événements. Rail seul : sur mobile la pilule doit rester à la largeur de
    // son mot.
    eventCount: {
        type: Number,
        default: 0,
    },
});

const emit = defineEmits(['select-view', 'select-shared-list']);

// ⚠️ Le libellé du second groupe suit la ville de l'utilisateur. Il disait « À Paris » en dur, ce qui
// s'affichait tel quel à un compte troyen — le rail annonçait une ville, la vue en montrait une autre.
const { cityInfo } = useProfile();

// `sharedProfiles` vaut `null` tant que le chargement de fond n'est pas revenu : les onglets
// apparaissent après le premier rendu plutôt que de le retarder.
const { sharedProfiles, missingCountFor } = useSharedLists();

// Dans le groupe « Ma liste », comme la maquette. ⚠️ `key` et non `mode` comme identité : tous
// portent `'shared'`, et les confondre surlignerait tous les onglets partagés à la fois.
const SHARED_TABS = computed(() => (sharedProfiles.value ?? []).map(profile => ({
    key: `shared:${profile.slug}`,
    mode: 'shared',
    slug: profile.slug,
    initial: profile.initial,
    label: `Liste de ${profile.display_name}`,
    // Sur la bande mobile, le prénom seul : l'avatar porte déjà « c'est la liste de quelqu'un ».
    shortLabel: profile.display_name,
    // `null` tant qu'on ne peut pas répondre — un « 0 » affiché trop tôt serait faux.
    count: missingCountFor(profile.user_id),
    countLabel: 'films que tu n\'as pas',
})));

const GROUPS = computed(() => [
    {
        label: 'Ma liste',
        tabs: [
            { key: 'timeline', mode: 'timeline', icon: 'list', label: 'Timeline' },
            { key: 'stats', mode: 'stats', icon: 'chart', label: 'Stats' },
            ...SHARED_TABS.value,
        ],
    },
    {
        label: `À ${cityInfo.value.label}`,
        tabs: [
            { key: 'seances', mode: 'seances', icon: 'ticket', label: 'Séances' },
            {
                key: 'events', mode: 'events', icon: 'star', label: 'Événements',
                count: props.eventCount,
                countLabel: 'séances événement cette semaine',
            },
        ],
    },
]);

const TABS = computed(() => GROUPS.value.flatMap(g => g.tabs));

// Une liste partagée est active sur son **slug**, les autres vues sur leur mode.
const isActive = (tab) => tab.slug
    ? (props.viewMode === 'shared' && props.sharedSlug === tab.slug)
    : props.viewMode === tab.mode;

const onSelect = (tab) => tab.slug
    ? emit('select-shared-list', tab.slug)
    : emit('select-view', tab.mode);

// Recentrage de l'onglet actif : les quatre pilules demandent ~470 px pour 375 px d'écran, donc
// « Événements » démarre hors champ. Sans ça, arriver sur /evenements affiche une bande où aucun
// élément ne paraît actif.
const strip = ref(null);

const centerActive = (behavior) => {
    // `block: 'nearest'` empêche le recentrage horizontal d'entraîner un scroll vertical de la page.
    strip.value?.querySelector('.-active')
        ?.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
};

// Sans animation au montage (un glissement au chargement se lit comme un mouvement parasite), animé
// ensuite — sauf mouvement réduit, comme le reste des animations d'orchestration.
onMounted(() => centerActive('instant'));

watch(() => props.viewMode, () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    nextTick(() => centerActive(reduced ? 'instant' : 'smooth'));
});
</script>

<template>
    <div v-if="layout === 'stack'" class="view-tabs -stack">
        <div v-for="group in GROUPS" :key="group.label" class="group">
            <div class="heading">{{ group.label }}</div>
            <div class="items">
                <button v-for="tab in group.tabs" :key="tab.key" class="tab" type="button"
                        :class="{ '-active': isActive(tab) }"
                        :aria-current="isActive(tab) ? 'page' : undefined"
                        @click="onSelect(tab)">
                    <span v-if="tab.initial" class="avatar" aria-hidden="true">{{ tab.initial }}</span>
                    <Svg v-else :name="tab.icon" class="ico" aria-hidden="true" />
                    <span class="txt">{{ tab.label }}</span>
                    <span v-if="tab.count" class="count">
                        {{ tab.count }}<span class="sr-only"> {{ tab.countLabel }}</span>
                    </span>
                </button>
            </div>
        </div>
    </div>

    <div v-else ref="strip" class="view-tabs -row">
        <button v-for="tab in TABS" :key="tab.key" class="tab" type="button"
                :class="{ '-active': isActive(tab) }"
                :aria-current="isActive(tab) ? 'page' : undefined"
                @click="onSelect(tab)">
            <span v-if="tab.initial" class="avatar" aria-hidden="true">{{ tab.initial }}</span>
            <Svg v-else :name="tab.icon" class="ico" aria-hidden="true" />{{ tab.shortLabel ?? tab.label }}
        </button>
    </div>
</template>

<style lang="scss" scoped>
.view-tabs {
    .tab {
        display: flex;
        align-items: center;
        color: $color-text-muted;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color .15s linear, color .15s linear;
        // Le reset coupe les contours du document : sans ce mixin la navigation se parcourt au
        // clavier sans repère visible (WCAG 2.4.7).
        @include focusRing();

        > .ico { flex: none; }
    }

    // Taille alignée sur le picto qu'elle remplace, sinon les onglets ne s'alignent plus.
    .avatar {
        flex: none;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: $color-shared;
        color: $color-white;
        font: 800 .9rem/1 $font-body;
    }

    .sr-only { @include srOnly; }
}

.view-tabs.-stack {
    display: flex;
    flex-direction: column;
    gap: 1.8rem;

    > .group {
        display: flex;
        flex-direction: column;
        gap: .6rem;

        > .heading { @include railHeading(); }

        > .items {
            display: flex;
            flex-direction: column;
            gap: .3rem;

            > .tab {
                gap: 1rem;
                padding: .9rem 1.1rem;
                border-radius: .9rem;
                font: $semi-bold 1.3rem/1 $font-body;

                > .ico,
                > .avatar { width: 1.6rem; height: 1.6rem; }

                // `min-width: 0` : sans lui le libellé en nowrap impose sa largeur et
                // « Événements » pousse le compteur hors du rail (22rem, pas un pixel de marge).
                > .txt {
                    flex: 1;
                    min-width: 0;
                    text-align: left;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                > .count {
                    color: $color-primary-light;
                    font: $bold 1rem/1 $font-mono;
                }

                // Sur le fond rose, le rose clair ne tient plus.
                &.-active > .count { color: inherit; }

                @media (hover: hover) {
                    &:not(.-active):hover { background: $color-surface-3; }
                }
            }
        }
    }
}

// ⚠️ Le débord négatif vaut le padding latéral de `.shell-mobilehead` (1.8rem) : les deux doivent
// bouger ensemble, sinon la bande ne s'aligne plus sur le titre au-dessus.
.view-tabs.-row {
    display: flex;
    gap: .7rem;
    margin: 0 -1.8rem;
    padding: .2rem 1.8rem .4rem;
    overflow-x: auto;
    @include hideScrollbar();

    > .tab {
        flex: none;
        gap: .7rem;
        padding: .8rem 1.4rem;
        border-radius: 999px;
        font: $semi-bold 1.25rem/1 $font-body;
        border: 1px solid transparent;

        > .ico,
        > .avatar { width: 1.4rem; height: 1.4rem; }

        // ⚠️ `:not(.-active)` et non un fond posé sur toutes les pilules : ce fond aurait la même
        // spécificité que la règle de l'onglet actif plus bas, et seul l'ordre du fichier aurait
        // tranché. C'est ce qui avait rendu les pilules actives grises.
        &:not(.-active) {
            background: $color-surface-1;
            border-color: $color-border-2;
        }
    }
}

.view-tabs .tab.-active {
    background: $color-primary;
    color: $color-white;

    // Sur le fond rose, l'indigo ne tient plus — même constat que pour le compteur.
    > .avatar {
        background: rgba($color-white, .26);
        color: $color-white;
    }
}
</style>
