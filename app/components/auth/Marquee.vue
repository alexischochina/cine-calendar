<script setup>
// Liste en dur, et qui le restera : ces écrans s'affichent avant toute session, il n'y a aucune
// liste d'utilisateur à lire.
//
// ⚠️ Chaque rangée est rendue **deux fois** : le défilement va de 0 à -50% de la largeur, donc la
// seconde moitié prend la place de la première quand la boucle repart. Dupliquer autrement (ou
// changer le -50%) fait sauter la boucle.
const ROWS = [
    ['In the Mood for Love', 'Stalker', 'La Haine', 'Aftersun', 'Le Mépris', 'Parasite'],
    ['Mulholland Drive', 'Perfect Days', 'Anatomie d’une chute', 'Chungking Express', 'Paris, Texas'],
    ['Portrait de la jeune fille en feu', 'Tár', 'Le Samouraï', 'Past Lives', 'Playtime'],
    ['Cléo de 5 à 7', 'Drive My Car', 'Beau travail', 'Moonlight', 'Les Parapluies de Cherbourg'],
];

// ⚠️ La couleur se calcule sur la position dans la liste **d'origine** (`j % row.length`), jamais
// sur celle de la liste dupliquée : sinon un titre rose dans la première moitié est un contour dans
// la seconde, et change d'apparence sous les yeux du visiteur au moment où la boucle repart.
const rows = ROWS.map((row, i) => [...row, ...row].map((title, j) => ({
    title,
    hot: (i + (j % row.length)) % 4 === 1,
})));
</script>

<template>
    <!-- `aria-hidden` : purement décoratif. Sans lui, un lecteur d'écran annoncerait 44 titres de
         films avant d'atteindre le formulaire. -->
    <div class="auth-marquee flex -direction-column" aria-hidden="true">
        <div v-for="(row, i) in rows" :key="i" class="row flex" :class="{ '-reverse': i % 2 === 1 }"
             :style="{ '--row': i }">
            <span v-for="(item, j) in row" :key="j" class="item flex -align-center">
                <span class="title" :class="{ '-hot': item.hot }">{{ item.title }}</span>
                <span class="dot" />
            </span>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.auth-marquee {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%) rotate(-4deg);
    gap: 1.6rem;
    // Sans ça, il volerait les clics de la marque et de l'accroche, posées au-dessus de lui.
    pointer-events: none;

    // Variante de fond (page d'erreur) : en retrait, sans titre accentué.
    //
    // ⚠️ La neutralisation du rose reprend **toute la chaîne** `> .row > .item > .title` : en
    // raccourci (`.title.-hot`) elle est moins spécifique que la règle qu'elle annule, donc inerte.
    &.-muted {
        opacity: .55;

        > .row > .item > .title.-hot {
            color: transparent;
            -webkit-text-stroke: 1.2px $color-border-5;
        }
    }

    > .row {
        // La largeur de ses 2 × N titres, pas celle du panneau : c'est la matière à faire défiler.
        width: max-content;
        // Plusieurs milliers de pixels qui bougent en permanence — `contain` évite au navigateur de
        // rejouer le layout de la page à chaque frame.
        contain: layout paint;
        gap: 2.4rem;
        animation: marquee-left calc(60s + var(--row) * 12s) linear infinite;

        &.-reverse {
            animation-name: marquee-right;
        }

        > .item {
            gap: 2.4rem;

            > .title {
                white-space: nowrap;
                color: transparent;
                -webkit-text-stroke: 1.2px $color-border-5;
                letter-spacing: -.15rem;
                font: 800 6.4rem/1 $font-title;

                &.-hot {
                    color: $color-primary;
                    -webkit-text-stroke: 0;
                }
            }

            > .dot {
                // Sans `flex: none`, la pastille se fait écraser par les titres.
                flex: none;
                width: 12px;
                height: 12px;
                border-radius: 3px;
                background-color: $color-border-2;
            }
        }
    }

    @media #{$tablet-portrait} {
        gap: 1rem;

        > .row {
            gap: 1.6rem;

            > .item {
                gap: 1.6rem;

                > .title {
                    font-size: 3.4rem;

                    // ⚠️ Aucun titre en rose sous ce seuil (maquette v2). En CSS et non via un état
                    // lié à `window.innerWidth`, qui divergerait entre rendu serveur et client.
                    &.-hot {
                        color: transparent;
                        -webkit-text-stroke: 1.2px $color-border-5;
                    }
                }

                > .dot {
                    width: 8px;
                    height: 8px;
                }
            }
        }
    }
}

@keyframes marquee-left {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
}

@keyframes marquee-right {
    from { transform: translateX(-50%); }
    to { transform: translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
    .auth-marquee > .row {
        animation: none;
    }
}
</style>
