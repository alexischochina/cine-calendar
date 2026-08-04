<script setup>
// Slider « Top 10 Letterboxd » : les films de l'année non encore vus et déjà sortis,
// classés par note Letterboxd décroissante (fallback note TMDB /2 quand elle manque).
// Pioche dans MA liste (calendar), pas un catalogue global. Clic carte → fiche Letterboxd.
const props = defineProps({
    movies: { type: Array, default: () => [] },
    year: { type: [Number, null], default: null },
});

// Note de tri/affichage : Letterboxd si dispo, sinon note TMDB (/10) ramenée sur /5.
const ratingOf = (m) => m.letterboxd_rating ?? (m.tmdb_vote != null ? m.tmdb_vote / 2 : null);

const top = computed(() => {
    if (props.year === null) return [];
    return props.movies
        .filter(m =>
            m.state !== 'seen' &&
            m.release_date &&
            m.release_date <= today() &&
            yearOf(m.release_date) === props.year
        )
        .sort((a, b) => (ratingOf(b) ?? -1) - (ratingOf(a) ?? -1) || (a.title || '').localeCompare(b.title || ''))
        .slice(0, 10);
});

const letterboxdUrl = (movieId) => `https://letterboxd.com/tmdb/${movieId}/`;
const fmtRating = (v) => v == null ? '—' : v.toFixed(1);
</script>

<template>
    <section class="stats-toprated card">
        <div class="head flex -align-center">
            <div class="label">Top 10 Letterboxd — pas encore vus</div>
        </div>

        <swiper-container v-if="top.length" class="strip" slides-per-view="auto" :space-between="12" free-mode="true">
            <swiper-slide v-for="(f, i) in top" :key="f.id" class="cell">
                <a :href="letterboxdUrl(f.movie_id)" target="_blank" rel="noopener" class="cardlink">
                    <div class="poster">
                        <NuxtImg v-if="posterUrl(f.poster_path)" :src="posterUrl(f.poster_path)"
                                 :alt="f.title ? `Affiche du film ${f.title}` : ''" class="img" loading="lazy" />
                        <div v-else class="img -placeholder" />
                        <span class="rank">{{ i + 1 }}</span>
                        <span class="note flex -align-center" :class="{ '-fallback': f.letterboxd_rating == null }">
                            <Svg v-if="f.letterboxd_rating != null" name="star" class="star" />
                            <span class="val">{{ fmtRating(ratingOf(f)) }}</span>
                        </span>
                    </div>
                    <div class="title">{{ f.title }}</div>
                </a>
            </swiper-slide>
        </swiper-container>

        <div v-else class="none">Tout est vu pour cette année.</div>
    </section>
</template>

<style lang="scss" scoped>
.stats-toprated {
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;
    min-width: 0;
    overflow: hidden;

    > .head {
        gap: 1rem;
        margin-bottom: 1.4rem;

        > .label {
            color: $color-text-weak;
            font: $bold 1.1rem/1 $font-body;
            letter-spacing: .12rem;
            text-transform: uppercase;
        }
    }

    > .strip {
        display: block;

        .cell { width: 9.6rem; }
    }

    .cardlink { display: block; }

    .poster {
        position: relative;
        width: 9.6rem;
        height: 14.4rem;
        border-radius: 1rem;
        overflow: hidden;
        background: $color-surface-4;

        > .img {
            width: 100%;
            height: 100%;
            object-fit: cover;

            &.-placeholder {
                background: linear-gradient(150deg, $color-surface-3, $color-surface-1);
            }
        }

        > .rank {
            position: absolute;
            top: .6rem;
            left: .6rem;
            display: grid;
            place-items: center;
            width: 2rem;
            height: 2rem;
            border-radius: .6rem;
            background: rgba(0, 0, 0, .62);
            color: $color-text;
            font: $bold 1.1rem/1 $font-mono;
        }

        > .note {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            gap: .4rem;
            padding: 1.8rem .6rem .6rem;
            background: linear-gradient(transparent, rgba(0, 0, 0, .85));
            color: $color-green;

            > .star { width: 1.1rem; height: 1.1rem; flex: none; }
            > .val { font: $bold 1.2rem/1 $font-mono; }

            // Fallback note TMDB : discrètement distingué (pas d'étoile, teinte atténuée).
            &.-fallback { color: $color-text-muted; }
        }
    }

    .title {
        margin-top: .6rem;
        color: $color-text-dim;
        font: $semi-bold 1.15rem/1.25 $font-body;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    > .none {
        color: $color-text-weak;
        font: $normal 1.25rem/1 $font-body;
    }
}
</style>
