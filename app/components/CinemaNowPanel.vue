<script setup>
// « Au ciné en ce moment » : films state === 'inTheaters'.
//  - variant 'rail'  : colonne de droite (desktop)
//  - variant 'band'  : bande horizontale repliable en haut de la timeline (mobile)
// Clic sur un item → scroll vers la ligne du film.
const props = defineProps({
    movies: {
        type: Array,
        default: () => [],
    },
    variant: {
        type: String,
        default: 'rail',
        validator: (v) => ['rail', 'band'].includes(v),
    },
});

const emits = defineEmits(['select-movie']);

const open = ref(true);

const MSHORT = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'];
const dateShort = (dateStr) => {
    if (!dateStr) return 'Sans date';
    const d = new Date(dateStr);
    if (isNaN(d)) return 'Sans date';
    return `${String(d.getDate()).padStart(2, '0')} ${MSHORT[d.getMonth()]}`;
};

const posterUrl = (path) => path ? `https://image.tmdb.org/t/p/w342${path}` : null;
</script>

<template>
    <section class="cinema-now" :class="[`-${variant}`, { scr: variant === 'rail' }]" v-if="movies.length">
        <component :is="variant === 'band' ? 'button' : 'div'" class="header"
                   :class="{ '-clickable': variant === 'band' }"
                   :type="variant === 'band' ? 'button' : undefined"
                   :aria-expanded="variant === 'band' ? open : undefined"
                   @click="variant === 'band' && (open = !open)">
            <span class="pulse" aria-hidden="true" />
            <span class="label">Au ciné en ce moment</span>
            <template v-if="variant === 'band'">
                <span class="count">{{ movies.length }}</span>
                <span class="spacer" />
                <span class="chevron" :class="{ '-collapsed': !open }" aria-hidden="true"><Svg name="chevron" /></span>
            </template>
        </component>

        <div class="list" :class="{ '-hidden': variant === 'band' && !open }">
            <button v-for="m in movies" :key="m.id" class="item" type="button"
                    @click="emits('select-movie', m.movie_id)">
                <NuxtImg v-if="posterUrl(m.poster_path)" :src="posterUrl(m.poster_path)"
                         :alt="m.title ? `Affiche du film ${m.title}` : ''" class="poster" loading="lazy" />
                <span v-else class="poster -placeholder" />
                <span class="infos">
                    <span class="title">{{ m.title }}</span>
                    <span class="date">{{ dateShort(m.release_date) }}</span>
                </span>
            </button>
        </div>
    </section>
</template>

<style lang="scss" scoped>
.cinema-now {
    .header {
        display: flex;
        align-items: center;
        gap: .7rem;
        width: 100%;
        background: none;
        border: 0;
        text-align: left;
        color: inherit;
        font: inherit;

        > .pulse {
            width: .7rem;
            height: .7rem;
            border-radius: 50%;
            background: $color-primary;
            flex-shrink: 0;
            animation: rosepulse 2s infinite;
        }

        > .label {
            color: $color-primary-light;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .14rem;
            text-transform: uppercase;
        }

        > .count {
            font: $normal 1.05rem/1 $font-mono;
            color: $color-text-weak;
        }

        > .spacer { flex: 1; }

        > .chevron {
            display: grid;
            place-items: center;
            color: $color-text-muted;
            transition: transform .2s ease;

            > :deep(svg) { width: 1.8rem; height: 1.8rem; }

            &.-collapsed { transform: rotate(-90deg); }
        }
    }

    .item {
        display: flex;
        cursor: pointer;
        text-align: left;

        .poster {
            border-radius: .8rem;
            border: 1.5px solid $color-primary;
            flex: none;
            object-fit: cover;

            &.-placeholder { background: $color-surface-1; }
        }

        .title {
            display: block;
            color: $color-text;
            font: $semi-bold 1.3rem/1.2 $font-body;
        }

        .date {
            display: block;
            font: $normal 1.1rem/1 $font-mono;
            color: $color-text-weaker;
            margin-top: .3rem;
        }
    }

    // Rail (desktop) : colonne verticale.
    &.-rail {
        width: 26.4rem;
        flex: none;
        border-left: 1px solid $color-border-1;
        padding: 2.4rem 2rem;
        overflow: auto;

        > .header { margin-bottom: 1.4rem; }

        > .list {
            display: flex;
            flex-direction: column;
            gap: 1.3rem;
        }

        .item {
            gap: 1.1rem;
            align-items: flex-start;

            .poster { width: 5.2rem; height: 7.8rem; }
            .infos { min-width: 0; }
        }
    }

    // Bande (mobile) : posters en rangée scrollable.
    &.-band {
        padding: 1rem 1.8rem 0;
        border-bottom: 1px solid $color-border-1;
        background: $color-bg;

        > .header {
            padding-bottom: 1.1rem;

            &.-clickable { cursor: pointer; }
        }

        > .list {
            display: flex;
            gap: 1.1rem;
            overflow-x: auto;
            padding-bottom: 1.2rem;
            scrollbar-width: none;

            &::-webkit-scrollbar { height: 0; }
            &.-hidden { display: none; }
        }

        .item {
            flex: none;
            width: 8.6rem;
            flex-direction: column;

            .poster {
                width: 8.6rem;
                height: 12.8rem;
                border-radius: 1rem;
                box-shadow: 0 0 0 3px rgba($color-primary, .16);
            }

            .infos { margin-top: .6rem; }

            .title {
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                font-size: 1.15rem;
                color: $color-text-body;
            }

            .date { font-size: 1rem; }
        }
    }
}

@keyframes rosepulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba($color-primary, .5); }
    50% { box-shadow: 0 0 0 5px rgba($color-primary, 0); }
}
</style>
