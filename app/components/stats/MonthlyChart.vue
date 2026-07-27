<script setup>
// Graphe bâtons mensuel : 12 colonnes, empilement (haut → bas) à voir (gris) ·
// streaming (jaune) · ciné (vert). Bulle de détail qui suit la souris (survol) ou se
// cale en haut de la colonne (focus clavier). Palette = tokens du projet ; identité
// portée par position + légende, jamais par la couleur seule (cf. dataviz, CVD).
const props = defineProps({
    monthly: { type: Array, default: () => [] }, // [{ label, total, cinemaSeen, streamingSeen, notSeen }]
});

// Échelle : max des totaux mensuels (vus + non vus), min 1 (division par 0).
const monthlyMax = computed(() => Math.max(1, ...props.monthly.map(m => m.total)));
const pct = (n) => monthlyMax.value ? Math.round((n / monthlyMax.value) * 100) : 0;

// Bulle de survol : suit la souris, ou se cale sur la colonne au focus clavier.
const hoverMonth = ref(null);
const tipPos = ref({ x: 0, y: 0 });
const onColEnter = (m) => { hoverMonth.value = m; };
const onColMove = (e) => { tipPos.value = { x: e.clientX, y: e.clientY }; };
const onColLeave = () => { hoverMonth.value = null; };
const onColFocus = (m, e) => {
    hoverMonth.value = m;
    const r = e.currentTarget.getBoundingClientRect();
    tipPos.value = { x: r.left + r.width / 2, y: r.top };
};

// Libellé lecteur d'écran d'une colonne : le détail chiffré complet.
const monthAria = (m) =>
    `${m.label} : ${m.total} film${m.total > 1 ? 's' : ''} — cinéma ${m.cinemaSeen}, streaming ${m.streamingSeen}, à voir ${m.notSeen}`;
</script>

<template>
    <section class="card -chart">
        <div class="chart-head">
            <div class="label">Films par mois</div>
            <div class="legend">
                <span class="key"><span class="dot -cinema" />Cinéma</span>
                <span class="key"><span class="dot -reste" />Streaming</span>
                <span class="key"><span class="dot -notseen" />À voir</span>
            </div>
        </div>
        <div class="columns" role="group" aria-label="Films par mois : vus au cinéma, en streaming, et à voir">
            <div v-for="m in monthly" :key="m.label" class="col"
                 tabindex="0" :aria-label="monthAria(m)"
                 @mouseenter="onColEnter(m)" @mousemove="onColMove" @mouseleave="onColLeave"
                 @focus="onColFocus(m, $event)" @blur="onColLeave">
                <span class="track">
                    <span v-if="m.notSeen > 0" class="fill -notseen"
                          :style="{ height: pct(m.notSeen) + '%' }" />
                    <span v-if="m.streamingSeen > 0" class="fill -reste"
                          :class="{ '-tip': m.notSeen === 0 }"
                          :style="{ height: pct(m.streamingSeen) + '%' }" />
                    <span v-if="m.cinemaSeen > 0" class="fill -cinema"
                          :class="{ '-tip': m.notSeen === 0 && m.streamingSeen === 0 }"
                          :style="{ height: pct(m.cinemaSeen) + '%' }" />
                </span>
                <span class="mlabel">{{ m.label }}</span>
            </div>
        </div>

        <!-- Bulle de survol (suit la souris) -->
        <div v-if="hoverMonth" class="chart-tip" :style="{ left: tipPos.x + 'px', top: tipPos.y + 'px' }">
            <div class="tip-head">{{ hoverMonth.label }} — {{ hoverMonth.total }} film{{ hoverMonth.total > 1 ? 's' : '' }}</div>
            <div class="tip-row"><span class="dot -cinema" />Cinéma <b>{{ hoverMonth.cinemaSeen }}</b></div>
            <div class="tip-row"><span class="dot -reste" />Streaming <b>{{ hoverMonth.streamingSeen }}</b></div>
            <div class="tip-row"><span class="dot -notseen" />À voir <b>{{ hoverMonth.notSeen }}</b></div>
        </div>
    </section>
</template>

<style lang="scss" scoped>
.card {
    grid-column: span 4;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;
}

.label {
    color: $color-text-weak;
    font: $bold 1.1rem/1 $font-body;
    letter-spacing: .12rem;
    text-transform: uppercase;
}

.chart-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.2rem;
}

.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 1.4rem;

    > .key {
        display: flex;
        align-items: center;
        gap: .6rem;
        color: $color-text-dim;
        font: $medium 1.2rem/1 $font-body;

        > .dot {
            width: 1rem;
            height: 1rem;
            border-radius: 3px;
            flex-shrink: 0;

            &.-cinema { background: $color-green; }
            &.-notseen { background: $color-status-grey; }
            &.-reste { background: $color-yellow; }
        }
    }
}

.columns {
    display: flex;
    align-items: flex-end;
    gap: 2%;
    height: 22rem;

    > .col {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: .8rem;
        outline: none;

        &:focus-visible {
            outline: 2px solid $color-primary;
            outline-offset: 3px;
            border-radius: .4rem;
        }

        > .track {
            width: 100%;
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            border-radius: .5rem;
            overflow: hidden;

            > .fill {
                width: 100%;
                transition: height .3s ease;

                // tip du bâton = coins arrondis 5px (maquette) ; base carrée.
                // Empilement (haut → bas) : à voir (gris) · streaming (jaune) · ciné (vert).
                &.-notseen { background: $color-status-grey; border-radius: .5rem .5rem 0 0; }
                &.-reste { background: $color-yellow; border-radius: 0; }
                &.-reste.-tip { border-radius: .5rem .5rem 0 0; } // pas de « à voir » au-dessus
                &.-cinema { background: $color-green; border-radius: 0; }
                &.-cinema.-tip { border-radius: .5rem .5rem 0 0; } // ciné seul → il porte le tip
            }
        }

        > .mlabel {
            font: $medium 1rem/1 $font-mono;
            color: $color-text-weak;
            text-transform: uppercase;
        }
    }
}

// Bulle de survol du graphe mensuel
.chart-tip {
    position: fixed;
    z-index: 100;
    transform: translate(1.4rem, 1.2rem); // décalage par rapport au curseur
    pointer-events: none;
    background: $color-surface-3;
    border: 1px solid $color-border-4;
    border-radius: .8rem;
    padding: .8rem 1rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
    white-space: nowrap;

    > .tip-head {
        color: $color-text;
        font: $bold 1.2rem/1 $font-body;
        margin-bottom: .6rem;
    }

    > .tip-row {
        display: flex;
        align-items: center;
        gap: .6rem;
        color: $color-text-dim;
        font: $medium 1.2rem/1.4 $font-body;

        > b { color: $color-text; font-weight: $bold; font-variant-numeric: tabular-nums; }

        > .dot {
            width: 1rem;
            height: 1rem;
            border-radius: 3px;
            flex-shrink: 0;

            &.-cinema { background: $color-green; }
            &.-reste { background: $color-yellow; }
            &.-notseen { background: $color-status-grey; }
        }
    }
}

@media (max-width: 999px) {
    .card { grid-column: span 2; }
    .columns { gap: .3rem; height: 18rem; }
}

@media (max-width: 560px) {
    .card { grid-column: span 1; }
    .columns > .col > .mlabel { font-size: .85rem; }
}
</style>
