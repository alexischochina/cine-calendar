<script setup>
// Rail gauche desktop : titre, toggle Timeline|Stats (Stats = placeholder inactif),
// liste des années avec compteur + surlignage de l'année active, légende STATUTS.
const props = defineProps({
    years: {
        type: Array,
        default: () => [],
    },
    activeYear: {
        type: [Number, null],
        default: null,
    },
});

const emits = defineEmits(['select-year']);

const isActive = (y) => y.year === props.activeYear;
</script>

<template>
    <aside class="side-nav scr">
        <div class="brand">Ma cinémathèque</div>

        <div class="tabs">
            <button class="tab -active" type="button">
                <Svg name="list" class="ico" />Timeline
            </button>
            <button class="tab -disabled" type="button" disabled aria-disabled="true" title="Bientôt disponible">
                <Svg name="chart" class="ico" />Stats
            </button>
        </div>

        <nav class="years" aria-label="Aller à une année">
            <button v-for="y in years" :key="y.label" class="year" :class="{ '-active': isActive(y) }"
                    type="button" @click="emits('select-year', y.year)">
                <span class="label">{{ y.label }}</span>
                <span class="count">{{ y.count }}</span>
            </button>
        </nav>

        <div class="divider" />

        <div class="legend">
            <div class="heading">Statuts</div>
            <span class="row"><span class="dot -green" />Vu au ciné</span>
            <span class="row"><span class="dot -amber" />Vu en streaming</span>
            <span class="row"><span class="dot -rose" />En salle</span>
            <span class="row"><span class="dot -grey" />À venir</span>
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

.tabs {
    display: flex;
    gap: .4rem;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.1rem;
    padding: .4rem;

    > .tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .6rem;
        padding: .8rem;
        border-radius: .8rem;
        color: $color-text-muted;
        font: $semi-bold 1.25rem/1 $font-body;
        cursor: pointer;
        transition: background-color .15s linear, color .15s linear;

        > .ico { width: 1.5rem; height: 1.5rem; }

        &.-active {
            background: $color-primary;
            color: $color-white;
        }

        &.-disabled {
            cursor: default;
            opacity: .55;
        }
    }
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

    > .heading {
        color: $color-text-weak;
        font: $bold 1rem/1 $font-body;
        letter-spacing: .13rem;
        text-transform: uppercase;
    }

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
</style>
