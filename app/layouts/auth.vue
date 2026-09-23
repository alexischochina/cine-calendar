<script setup>
// Layout et non composant : Nuxt le garde monté d'une route à l'autre, donc le marquee ne se
// remonte pas entre `/login` et `/register` et seule la colonne de droite est reprise par la
// transition.
</script>

<template>
    <div class="auth-layout flex">
        <div class="art flex -direction-column -justify-space-between">
            <Brand class="brand" />

            <AuthMarquee />

            <div class="tagline">
                <div class="kicker">Ton agenda de cinéma</div>
                <div class="claim">Les films à voir, ceux déjà vus, et ce qui passe près de chez toi.</div>
            </div>
        </div>

        <div class="content flex -align-center -justify-center">
            <div class="inner">
                <slot />
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.auth-layout {
    min-height: 100dvh;
    background-color: $color-bg;
    color: $color-text-body;

    > .art {
        position: relative;
        flex: 1.1;
        // ⚠️ Le marquee déborde volontairement du panneau : sans `overflow`, il ouvre une barre de
        // défilement horizontale sur toute la page.
        overflow: hidden;
        padding: 4.8rem;
        background-color: $color-surface-4;
        border-right: 1px solid $color-border-1;
        border-bottom: 1px solid $color-border-1;

        &::before,
        &::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            height: 14px;
            background: repeating-linear-gradient(90deg, transparent 0 10px, $color-border-1 10px 22px);
            opacity: .9;
        }

        &::before {
            top: 0;
        }

        &::after {
            bottom: 0;
        }

        > .brand {
            // Devant le marquee, qui est en absolu au milieu du panneau.
            position: relative;
            z-index: 2;
        }

        > .tagline {
            position: relative;
            z-index: 2;
            max-width: 44rem;

            > .kicker {
                margin-bottom: 1.6rem;
                color: $color-primary-light;
                text-transform: uppercase;
                letter-spacing: .16rem;
                font: $bold 1.1rem/1 $font-mono;
            }

            > .claim {
                color: $color-text;
                text-wrap: pretty;
                letter-spacing: -.1rem;
                font: 800 3.4rem/1.08 $font-title;
            }
        }
    }

    > .content {
        flex: 1;
        padding: 4.8rem;

        > .inner {
            width: 100%;
            max-width: 40rem;
        }
    }

    // ⚠️ Bascule à 960px et non aux 860px de la maquette : `$tablet-portrait` est le seuil le plus
    // proche parmi ceux du projet, et la colonne de formulaire est déjà à l'étroit sur cette plage.
    // Pas de `-no-flex-*` ici — ces modifiers passent en `display: block`, on veut rester en flex.
    @media #{$tablet-portrait} {
        flex-direction: column;

        > .art {
            flex: none;
            height: 18rem;
            padding: 3rem 2.4rem;

            > .tagline {
                display: none;
            }
        }

        > .content {
            padding: 3.2rem 2.4rem 4.8rem;
        }
    }
}
</style>
