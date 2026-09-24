<script setup>
// Corps scrollable du calendrier : une année à la fois, groupée par mois → jour, ou la
// section « Sans date ». Chaque film est un MovieListItem. Le conteneur garde la classe
// `.timeline` : useMovieScroll cible `.timeline` / `.-id-<movieId>` en global (querySelector), d'où
// l'ancre réservée à ma liste (cf. `MovieListItem`).
//
// Sert **deux** listes : la mienne, et celle d'un autre compte — `shared` le dit une fois ici et le
// propage à chaque ligne.
defineProps({
    selectedYear: { type: [Number, null], default: null },
    monthsOfYear: { type: [Object, null], default: null }, // { mois: { jour: [films] } }
    moviesWithoutDate: { type: Array, default: () => [] },
    hasContent: { type: Boolean, default: false },
    shared: { type: Boolean, default: false },
    // Les films que j'ai déjà, par `movie_id`. Un `Set` : le gabarit l'interroge une fois par ligne.
    ownedIds: { type: Object, default: () => new Set() },
    emptyMessage: { type: String, default: 'Aucun film ne correspond.' },
});

const emit = defineEmits(['movie-deleted', 'release-date-updated', 'toggle-catchup', 'add-to-list']);

const monthCount = (days) => {
    const n = Object.values(days).reduce((acc, list) => acc + list.length, 0);
    return `${n} film${n > 1 ? 's' : ''}`;
};
</script>

<template>
    <div class="timeline-list" :class="{ '-shared': shared }">
        <!-- Bouche la bande que l'en-tête de mois laisse voir quand son `sticky` décroche pendant un
             scroll rapide. Hors du scroller, donc jamais en retard. « Sans date » n'a pas d'en-tête. -->
        <div v-if="hasContent && selectedYear !== null" class="headmask" aria-hidden="true" />

        <div class="timeline scr">
            <!-- ⚠️ **Avant** le `v-if** : l'en-tête porte la bascule, qui disparaîtrait exactement
                 quand elle vide la liste — sans aucun moyen de la décocher. -->
            <slot name="header" />

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
                                           :letterboxd-directors="movie.letterboxd_directors"
                                           :release-date="movie.release_date"
                                           :catchup="movie.catchup"
                                           :shared="shared"
                                           :already-mine="ownedIds.has(Number(movie.movie_id))"
                                           @movie-deleted="emit('movie-deleted', $event)"
                                           @release-date-updated="emit('release-date-updated', $event)"
                                           @toggle-catchup="(id, value) => emit('toggle-catchup', id, value)"
                                           @add-to-list="emit('add-to-list', movie)" />
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
                                   :letterboxd-directors="movie.letterboxd_directors"
                                   :release-date="movie.release_date"
                                   :catchup="movie.catchup"
                                   :shared="shared"
                                   :already-mine="ownedIds.has(Number(movie.movie_id))"
                                   @movie-deleted="emit('movie-deleted', $event)"
                                   @release-date-updated="emit('release-date-updated', $event)"
                                   @toggle-catchup="(id, value) => emit('toggle-catchup', id, value)"
                                   @add-to-list="emit('add-to-list', movie)" />
                </div>
            </template>

            <div v-else class="empty">{{ emptyMessage }}</div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// Enveloppe non scrollable : elle ancre la plaque hors du flux scrollé.
.timeline-list {
    // Géométrie de l'en-tête, écrite une fois : la plaque doit valoir exactement sa hauteur, sinon
    // elle déborde sur le premier film ou laisse un filet.
    --head-pad-y: 1.6rem;
    --head-line: 1.7rem;
    --head-pad-b: 1rem;
    --head-h: calc(var(--head-pad-y) + var(--head-line) + var(--head-pad-b));
    // Hauteur du bandeau d'une liste partagée, 0 sur ma timeline. ⚠️ Consommée par le bandeau, les
    // en-têtes de mois et la plaque : trois endroits qui doivent bouger ensemble.
    --shared-head-h: 0px;
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
}

.timeline {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: .8rem 0 11rem;
    margin-right: var(--rail-space, 0); // place pour le rail overlay (posé par le layout)
}

// `z-index: 1` : au-dessus des films, sous les en-têtes (z-index 2). `pointer-events: none`, sinon
// la plaque avalerait la molette du scroller.
.headmask {
    position: absolute;
    top: 0;
    left: 0;
    right: var(--rail-space, 0);
    z-index: 1;
    height: calc(var(--shared-head-h) + var(--head-h));
    background: $color-bg;
    pointer-events: none;
}

.empty {
    padding: 8rem 3rem;
    text-align: center;
    color: $color-text-weak;
    font: $normal 1.4rem/1 $font-body;
}

.month-head {
    position: sticky;
    // Sous le bandeau de liste partagée quand il y en a un, en haut du scroller sinon.
    top: var(--shared-head-h);
    z-index: 2;
    min-height: var(--head-h); // garde-fou : l'en-tête ne peut pas devenir plus court que la plaque
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: var(--head-pad-y) 2.4rem var(--head-pad-b);
    // Sans `backdrop-filter` : le flou sur un `sticky` interdit au compositeur de le suivre pendant
    // le scroll, et c'est ce décrochage qui laissait voir les films au-dessus.
    background: $color-bg;

    > .name {
        color: $color-text;
        font: 800 var(--head-line)/1 $font-title;
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

.timeline-list.-shared { --shared-head-h: 7.2rem; }

@media (max-width: 999px) {
    .timeline-list {
        --head-pad-y: 1.4rem;
        --head-line: 1.5rem;
        --head-pad-b: .8rem;
    }

    // La bascule passe sous le nom : deux rangées, donc un bandeau plus haut.
    .timeline-list.-shared { --shared-head-h: 10rem; }

    // le rail est masqué en mobile (bande à la place)
    .timeline { padding: 0 0 11rem; margin-right: 0; }
    .headmask { right: 0; }

    .month-head { padding-inline: 1.8rem; }
}
</style>
