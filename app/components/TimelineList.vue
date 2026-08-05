<script setup>
// Corps scrollable du calendrier : une année à la fois, groupée par mois → jour, ou la
// section « Sans date ». Chaque film est un MovieListItem. Le conteneur garde la classe
// `.timeline` : useMovieScroll cible `.timeline` / `.-id-<movieId>` en global (querySelector).
defineProps({
    selectedYear: { type: [Number, null], default: null },
    monthsOfYear: { type: [Object, null], default: null }, // { mois: { jour: [films] } }
    moviesWithoutDate: { type: Array, default: () => [] },
    hasContent: { type: Boolean, default: false },
});

const emit = defineEmits(['movie-deleted', 'release-date-updated', 'toggle-catchup']);

const monthCount = (days) => {
    const n = Object.values(days).reduce((acc, list) => acc + list.length, 0);
    return `${n} film${n > 1 ? 's' : ''}`;
};
</script>

<template>
    <div class="timeline scr">
        <template v-if="hasContent">
            <!-- Année datée : groupes de mois -->
            <template v-if="selectedYear !== null">
                <div class="month-group" v-for="(days, month) in monthsOfYear" :key="month">
                    <div class="month-head">
                        <span class="name">{{ month }}</span>
                        <span class="rule" />
                        <span class="count">{{ monthCount(days) }}</span>
                    </div>
                    <template v-for="(dayMovies, day) in days" :key="day">
                        <MovieListItem v-for="(movie, index) in dayMovies" :key="movie.id"
                                       :release-day="index === 0 ? String(day) : ''"
                                       :movie-id="movie.movie_id"
                                       :media="movie.media"
                                       :state="movie.state"
                                       :id="movie.id"
                                       :title="movie.title"
                                       :poster-path="movie.poster_path"
                                       :manual-release-date="movie.manual_release_date"
                                       :director="movie.director"
                                       :release-date="movie.release_date"
                                       :catchup="movie.catchup"
                                       @movie-deleted="emit('movie-deleted', $event)"
                                       @release-date-updated="emit('release-date-updated', $event)"
                                       @toggle-catchup="(id, value) => emit('toggle-catchup', id, value)" />
                    </template>
                </div>
            </template>

            <!-- Sans date -->
            <div class="month-group" v-else>
                <MovieListItem v-for="movie in moviesWithoutDate" :key="movie.id"
                               :release-day="''"
                               :movie-id="movie.movie_id"
                               :media="movie.media"
                               :state="movie.state"
                               :id="movie.id"
                               :title="movie.title"
                               :poster-path="movie.poster_path"
                               :manual-release-date="movie.manual_release_date"
                               :director="movie.director"
                               :release-date="movie.release_date"
                               :catchup="movie.catchup"
                               @movie-deleted="emit('movie-deleted', $event)"
                               @release-date-updated="emit('release-date-updated', $event)"
                               @toggle-catchup="(id, value) => emit('toggle-catchup', id, value)" />
            </div>
        </template>

        <div v-else class="empty">Aucun film ne correspond.</div>
    </div>
</template>

<style lang="scss" scoped>
.timeline {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: .8rem 0 11rem;
    margin-right: var(--rail-space, 0); // place pour le rail overlay (posé par le layout)
}

.empty {
    padding: 8rem 3rem;
    text-align: center;
    color: $color-text-weak;
    font: $normal 1.4rem/1 $font-body;
}

.month-head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: 1.6rem 2.4rem 1rem;
    background: rgba($color-bg, .92);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);

    > .name {
        color: $color-text;
        font: 800 1.7rem/1 $font-title;
        text-transform: capitalize;
    }

    > .rule {
        flex: 1;
        height: 1px;
        background: $color-border-2;
    }

    > .count {
        font: $normal 1.1rem/1 $font-mono;
        color: $color-text-weak;
    }
}

@media (max-width: 999px) {
    .timeline { padding: 0 0 11rem; margin-right: 0; } // le rail est masqué en mobile (bande à la place)

    .month-head {
        padding: 1.4rem 1.8rem .8rem;

        > .name { font-size: 1.5rem; }
    }
}
</style>
