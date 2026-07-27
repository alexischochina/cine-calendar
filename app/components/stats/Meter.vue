<script setup>
// Barre de ratio à deux segments contigus + légende (vu/à-voir, ciné/streaming).
// `segments` = 2 entrées { variant, width, label, value } ; `variant` pilote la couleur
// (seen|cinema = vert, towatch = gris, streaming = jaune). `headline` = accroche
// optionnelle alignée à droite du label (ex. « 34% vu »). `wide` = 2 colonnes de grille.
defineProps({
    label: { type: String, required: true },
    segments: { type: Array, required: true },
    ariaLabel: { type: String, required: true },
    headline: { type: String, default: null },
    wide: { type: Boolean, default: false },
});
</script>

<template>
    <section class="card" :class="{ '-wide': wide }">
        <div v-if="headline" class="ratio-head">
            <span class="label">{{ label }}</span>
            <span class="pct">{{ headline }}</span>
        </div>
        <div v-else class="label">{{ label }}</div>

        <div class="meter" role="img" :aria-label="ariaLabel">
            <span v-for="s in segments" :key="s.variant" class="seg" :class="`-${s.variant}`"
                  :style="{ width: s.width + '%' }" />
        </div>
        <div class="legend">
            <span v-for="s in segments" :key="s.variant" class="key">
                <span class="dot" :class="`-${s.variant}`" />{{ s.label }} <b>{{ s.value }}</b>
            </span>
        </div>
    </section>
</template>

<style lang="scss" scoped>
.card {
    grid-column: span 1;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;

    &.-wide { grid-column: span 2; }
}

.label {
    color: $color-text-weak;
    font: $bold 1.1rem/1 $font-body;
    letter-spacing: .12rem;
    text-transform: uppercase;
    margin-bottom: 1.2rem;
}

.ratio-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.4rem;

    > .label { margin-bottom: 0; }

    > .pct {
        color: $color-green;
        font: $bold 1.4rem/1 $font-mono;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }
}

// Segments contigus, radius 8px (cf. maquette).
.meter {
    display: flex;
    height: 1.6rem;
    border-radius: .8rem;
    overflow: hidden;
    margin-bottom: 1.2rem;

    > .seg {
        height: 100%;
        transition: width .3s ease;

        &.-seen, &.-cinema { background: $color-green; }
        &.-towatch { background: $color-status-grey; }
        &.-streaming { background: $color-yellow; }
    }
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

        > b { color: $color-text; font-weight: $bold; font-variant-numeric: tabular-nums; }

        > .dot {
            width: 1rem;
            height: 1rem;
            border-radius: 3px;
            flex-shrink: 0;

            &.-seen, &.-cinema { background: $color-green; }
            &.-towatch { background: $color-status-grey; }
            &.-streaming { background: $color-yellow; }
        }
    }
}

@media (max-width: 999px) {
    .card.-wide { grid-column: span 2; }
}

@media (max-width: 560px) {
    .card, .card.-wide { grid-column: span 1; }
}
</style>
