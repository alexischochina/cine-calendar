<script setup>
// L'en-tête de la liste d'un autre compte.
//
// Posé **dans le scroller** de `TimelineList` : il est `sticky`, comme les en-têtes de mois, et les
// deux s'empilent. ⚠️ Sa hauteur vit dans `--shared-head-h`, déclarée par `TimelineList`, qui s'en
// sert aussi pour décaler les en-têtes de mois et dimensionner `.headmask` — un chiffre en dur ici
// ferait glisser un `sticky` sous l'autre.
defineProps({
    name: {
        type: String,
        default: '',
    },
    initial: {
        type: String,
        default: '?',
    },
    // « 34 films · 12 que tu n'as pas », calculé par `sharedListStat`.
    stat: {
        type: String,
        default: '',
    },
    onlyMissing: {
        type: Boolean,
        default: false,
    },
    // Ma liste est-elle chargée ? Sans elle, la bascule filtrerait sur « je n'ai rien ».
    ready: {
        type: Boolean,
        default: true,
    },
});

defineEmits(['toggle-missing']);
</script>

<template>
    <div class="shared-list-header">
        <span class="avatar" aria-hidden="true">{{ initial }}</span>

        <div class="who">
            <h2 class="name">Liste de {{ name }}</h2>
            <p class="stat">{{ stat }}</p>
        </div>

        <!-- `role="switch"` : c'est le seul contrôle de la vue, il doit s'annoncer comme un
             interrupteur et s'atteindre au clavier. -->
        <button class="toggle" :class="{ '-on': onlyMissing }" type="button"
                role="switch" :aria-checked="onlyMissing" :disabled="!ready"
                @click="$emit('toggle-missing')">
            <span class="box" aria-hidden="true">
                <Svg v-if="onlyMissing" name="check" class="ico" />
            </span>
            Seulement ceux que je n'ai pas
        </button>
    </div>
</template>

<style lang="scss" scoped>
.shared-list-header {
    position: sticky;
    top: 0;
    // Au-dessus des en-têtes de mois (z-index 2), qui viennent se coller dessous.
    z-index: 3;
    height: var(--shared-head-h);
    // Annule le padding haut du scroller, pour que le bandeau parte vraiment du bord.
    margin-top: -.8rem;
    padding: 0 2.4rem;
    display: flex;
    align-items: center;
    gap: 1.4rem;
    // ⚠️ Fond **plein**, sans `backdrop-filter`, contrairement à la maquette : sur un `sticky`, le
    // flou empêche le compositeur de suivre l'élément au scroll. Le projet l'a déjà retiré de
    // `.month-head` pour cette raison.
    background: $color-bg;
    border-bottom: 1px solid $color-border-1;

    > .avatar {
        flex: none;
        width: 4rem;
        height: 4rem;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: $color-shared;
        color: $color-white;
        font: 800 1.6rem/1 $font-title;
    }

    > .who {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: .4rem;

        > .name {
            color: $color-text;
            font: 800 2.2rem/1 $font-title;
            letter-spacing: -.05rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        > .stat {
            color: $color-text-weaker;
            font: $normal 1.1rem/1 $font-mono;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }

    > .toggle {
        flex: none;
        display: flex;
        align-items: center;
        gap: .9rem;
        padding: .9rem 1.4rem;
        border-radius: 999px;
        background: $color-surface-1;
        border: 1px solid $color-border-3;
        color: $color-text-dim;
        font: $semi-bold 1.3rem/1 $font-body;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color .15s linear, border-color .15s linear, color .15s linear;
        @include focusRing();

        > .box {
            flex: none;
            width: 1.5rem;
            height: 1.5rem;
            display: grid;
            place-items: center;
            border-radius: 4px;
            border: 1.5px solid $color-status-grey;
            color: $color-white;

            > .ico { width: 1rem; height: 1rem; }
        }

        &.-on {
            background: rgba($color-primary, .12);
            border-color: $color-primary;
            color: $color-text;

            > .box {
                background: $color-primary;
                border-color: $color-primary;
            }
        }

        // Visible mais inerte : le retirer ferait sauter la mise en page.
        &:disabled {
            opacity: .45;
            cursor: default;
        }

        @media (hover: hover) {
            &:not(:disabled):hover { border-color: $color-primary; }
        }
    }
}

// Sous 1000 px la bascule passe à la ligne plutôt que de comprimer le nom : c'est lui qui dit chez
// qui on est.
@media (max-width: 999px) {
    .shared-list-header {
        flex-wrap: wrap;
        align-content: center;
        row-gap: 1rem;
        padding: 0 1.8rem;
        margin-top: 0;

        > .avatar {
            width: 3.4rem;
            height: 3.4rem;
            font-size: 1.4rem;
        }

        > .who > .name { font-size: 1.8rem; }

        // Pleine largeur : la pilule fait ~26rem, un téléphone en fait 34.
        > .toggle {
            width: 100%;
            justify-content: center;
            font-size: 1.25rem;
        }
    }
}
</style>
