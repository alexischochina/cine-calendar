<script setup>
// ⚠️ Ni layout ni middleware : c'est une sortie de secours, elle doit s'afficher quand le reste ne
// le peut pas — d'où le décor refait ici.
//
// ⚠️ La maquette ne couvre que le 404, mais ce fichier reçoit **toutes** les erreurs : le chiffre
// et le texte suivent le code réel. Un 500 annoncé « Cette bobine est introuvable » serait faux.
const props = defineProps({
    error: { type: Object, default: () => ({}) },
});

const code = computed(() => String(props.error?.statusCode ?? 500));
const isNotFound = computed(() => code.value === '404');

const digits = computed(() => {
    const value = code.value;
    const middle = Math.floor(value.length / 2);
    return [...value].map((char, i) => ({ char, accent: i === middle }));
});

const title = computed(() => (isNotFound.value
    ? 'Cette bobine est introuvable.'
    : 'La séance a été interrompue.'));

const text = computed(() => (isNotFound.value
    ? 'La page que tu cherches n\'existe pas ou a été déplacée.'
    : 'Une erreur est survenue de notre côté. Réessaie dans un instant.'));

useHead({ title: () => (isNotFound.value ? 'Page introuvable' : 'Erreur') });

// ⚠️ `clearError` et pas un lien : sans vidage de l'état d'erreur, on reste coincé sur cet écran.
const goHome = () => clearError({ redirect: '/' });
</script>

<template>
    <div class="error-page flex -direction-column">
        <AuthMarquee class="-muted" />
        <!-- Sans ce voile, les titres du marquee rendent le texte illisible. -->
        <div class="veil" aria-hidden="true" />

        <Brand class="head" />

        <div class="body flex -align-center -justify-center">
            <div class="inner flex -direction-column -align-center">
                <div class="code">
                    <span v-for="(digit, i) in digits" :key="i" :class="{ accent: digit.accent }">{{ digit.char }}</span>
                </div>

                <h1 class="title">{{ title }}</h1>
                <p class="text">{{ text }}</p>

                <AuthSubmitBtn class="back" type="button" label="Retour à la timeline" @click="goHome" />
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.error-page {
    position: relative;
    min-height: 100dvh;
    // ⚠️ Le marquee déborde : sans `overflow`, une barre de défilement horizontale apparaît.
    overflow: hidden;
    background-color: $color-bg;
    color: $color-text-body;

    &::before,
    &::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 14px;
        background: repeating-linear-gradient(90deg, transparent 0 10px, $color-border-1 10px 22px);
        z-index: 1;
    }

    &::before {
        top: 0;
    }

    &::after {
        bottom: 0;
    }

    > .veil {
        position: absolute;
        inset: 0;
        background: radial-gradient(ellipse at center,
            rgba($color-bg, .96) 0%,
            rgba($color-bg, .85) 38%,
            rgba($color-bg, 0) 75%);
        pointer-events: none;
    }

    > .head {
        position: relative;
        z-index: 2;
        padding: 4rem 4.8rem 0;

        @media #{$mobile} {
            padding: 3rem 2.4rem 0;
        }
    }

    > .body {
        position: relative;
        z-index: 2;
        flex: 1;
        padding: 4rem 2.4rem 6.4rem;

        > .inner {
            gap: 2.4rem;
            max-width: 52rem;
            text-align: center;
            animation: error-pop .4s ease both;

            > .code {
                color: $color-text;
                letter-spacing: -.8rem;
                font: 800 clamp(12rem, 24vw, 22rem)/.85 $font-title;

                .accent {
                    color: $color-primary;
                }

                @media #{$mobile} {
                    letter-spacing: -.5rem;
                }
            }

            > .title {
                color: $color-text;
                text-wrap: pretty;
                letter-spacing: -.1rem;
                font: 800 clamp(2.8rem, 5vw, 3.8rem)/1.05 $font-title;
            }

            > .text {
                max-width: 42rem;
                color: $color-text-muted;
                text-wrap: pretty;
                font: $normal 1.6rem/1.55 $font-body;
            }

            // Dimensionné sur son libellé ici, pleine largeur dans les formulaires : le placement
            // appartient au parent (`f-rscss` §5).
            > .back {
                width: auto;
                margin-top: .8rem;
                padding: 0 2.4rem;

                @media #{$mobile} {
                    width: 100%;
                }
            }
        }
    }
}

@keyframes error-pop {
    from { transform: translateY(8px); opacity: 0; }
    to { transform: none; opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .error-page > .body > .inner {
        animation: none;
    }
}
</style>
