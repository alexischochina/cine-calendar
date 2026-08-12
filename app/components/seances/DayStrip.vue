<script setup>
// Bande des 7 jours. Scroll horizontal natif + flèches, comme les autres bandes du projet
// (`stripScroll` / `useHorizontalStrip`), pour que le comportement mobile soit identique partout.
const props = defineProps({
    days: {
        type: Array,
        default: () => [],
    },
    activeIndex: {
        type: Number,
        default: 0,
    },
});

const emit = defineEmits(['select']);

const { stripEl, atStart, atEnd, nudge, updateEdges } = useHorizontalStrip(() => props.days.length, { step: 4 });

// Les trois lignes d'une cellule (« Auj. », « 12 », « AOÛ ») se lisent d'une traite au lecteur
// d'écran : « Auj.12AOÛ ». On lui donne la date en clair, le visuel restant compact.
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const dayLabel = (day) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.date ?? '');
    if (!parts) return day.dow;
    const spoken = `${Number(parts[3])} ${MONTHS_FR[Number(parts[2]) - 1]}`;
    return day.today ? `Aujourd'hui, ${spoken}` : spoken;
};
</script>

<template>
    <div class="seances-daystrip">
        <div ref="stripEl" class="strip" role="group" aria-label="Choisir le jour"
             @scroll.passive="updateEdges">
            <button v-for="day in days" :key="day.date" class="cell" type="button"
                    :class="{ '-active': day.index === activeIndex }"
                    :aria-pressed="day.index === activeIndex" :aria-label="dayLabel(day)"
                    @click="emit('select', day.index)">
                <span class="dow" aria-hidden="true">{{ day.dow }}</span>
                <span class="dd" aria-hidden="true">{{ day.dd }}</span>
                <span class="mon" aria-hidden="true">{{ day.month }}</span>
            </button>
        </div>

        <div class="nav">
            <button type="button" class="arrow -prev" aria-label="Jours précédents"
                    :disabled="atStart" @click="nudge(-1)"><Svg name="chevron" aria-hidden="true" /></button>
            <button type="button" class="arrow -next" aria-label="Jours suivants"
                    :disabled="atEnd" @click="nudge(1)"><Svg name="chevron" aria-hidden="true" /></button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.seances-daystrip {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 0;

    > .strip {
        flex: 1;
        min-width: 0;
        padding-bottom: .4rem;
        @include stripScroll(2.4rem, .8rem);

        > .cell {
            width: 6rem;
            padding: 1rem 0;
            background: $color-surface-1;
            border: 1px solid $color-border-2;
            border-radius: 1.2rem;
            text-align: center;
            cursor: pointer;
            transition: border-color .18s ease;

            > .dow {
                display: block;
                color: $color-text-quiet;
                font: $semi-bold 1.05rem/1 $font-body;
                letter-spacing: .06rem;
                text-transform: uppercase;
            }

            > .dd {
                display: block;
                margin-top: .2rem;
                color: $color-text-body;
                font: $bold 1.7rem/1 $font-mono;
            }

            > .mon {
                display: block;
                color: $color-text-quiet;
                font: $normal .95rem/1 $font-body;
            }

            &.-active {
                background: linear-gradient(145deg, $color-primary, $color-primary-warm);
                border-color: transparent;

                > .dow { color: rgba($color-white, .85); }
                > .dd { color: $color-white; }
                > .mon { color: rgba($color-white, .7); }
            }

            @media (hover: hover) {
                &:not(.-active):hover { border-color: $color-border-5; }
            }
        }
    }

    > .nav {
        display: flex;
        flex: none;
        @include stripArrows();
    }
}

// Les flèches ne servent à rien sans souris : le doigt fait défiler la bande directement.
@media (max-width: 999px) {
    .seances-daystrip > .nav { display: none; }
}
</style>
