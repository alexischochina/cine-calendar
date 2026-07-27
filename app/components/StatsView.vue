<script setup>
// Vue Statistiques de l'année sélectionnée. Consomme useYearStats et compose la grille
// de cartes. Chaque type de carte est un sous-composant autonome de `stats/` :
//   - StatsMeter        : ratio vu/à-voir et ratio ciné/streaming
//   - StatsTopList      : top genres / top pays (accordéon dépliant les films)
//   - StatsMonthlyChart : graphe bâtons mensuel + bulle de survol
// La carte « total » (chiffre hero) reste ici, triviale. L'état « un seul panneau ouvert »
// des deux TopList est porté ici pour rester unique tous blocs confondus (cf. maquette).
const props = defineProps({
    movies: {
        type: Array,
        default: () => [],
    },
    year: {
        type: [Number, null],
        default: null,
    },
});

const {
    total, seen, toWatch, seenRatio,
    cinema, streaming, cinemaRatio,
    topGenres, topCountries, countryMap, maxSeen, monthly,
} = useYearStats(() => props.movies, () => props.year);

const yearLabel = computed(() => props.year === null ? 'Sans date' : String(props.year));
const hasData = computed(() => total.value > 0);

// Segments des deux barres de ratio (variant → couleur côté StatsMeter).
const seenSegments = computed(() => [
    { variant: 'seen', width: seenRatio.value, label: 'Vu', value: seen.value },
    { variant: 'towatch', width: 100 - seenRatio.value, label: 'À voir', value: toWatch.value },
]);
const mediaSegments = computed(() => [
    { variant: 'cinema', width: cinemaRatio.value, label: 'Cinéma', value: cinema.value },
    { variant: 'streaming', width: 100 - cinemaRatio.value, label: 'Streaming', value: streaming.value },
]);

// Accordéon top genres / pays : un seul panneau ouvert à la fois, tous blocs confondus.
// `id` = `<kind>:<label>`, émis par StatsTopList. On referme au changement d'année.
const openStat = ref(null);
const toggleStat = (id) => { openStat.value = openStat.value === id ? null : id; };
watch(() => props.year, () => { openStat.value = null; });
</script>

<template>
    <div class="stats scr">
        <div class="head">
            <h1 class="title">Statistiques</h1>
            <span class="year">{{ yearLabel }}</span>
        </div>

        <div v-if="!hasData" class="empty">Aucun film pour cette période.</div>

        <div v-else class="grid">
            <!-- 1. Total films (hero number) -->
            <section class="card -total">
                <div class="label">Films sur l'année</div>
                <div class="hero">{{ total }}</div>
            </section>

            <!-- 2. Ratio vu / à voir -->
            <StatsMeter wide label="Vu / à voir" :headline="`${seenRatio}% vu`" :segments="seenSegments"
                        :aria-label="`${seen} vus, ${toWatch} à voir`" />

            <!-- 3. Ratio ciné / streaming -->
            <StatsMeter label="Cinéma / streaming" :segments="mediaSegments"
                        :aria-label="`${cinema} au cinéma, ${streaming} en streaming`" />

            <!-- 4. Top genres -->
            <StatsTopList label="Top genres" kind="genre" :items="topGenres" color="#B57BD6"
                          empty-text="Aucun genre renseigné." :open-id="openStat" @toggle="toggleStat" />

            <!-- 5. Top pays -->
            <StatsTopList label="Top pays" kind="country" :items="topCountries" color="#4B9FD0"
                          empty-text="Aucun pays renseigné." :open-id="openStat" @toggle="toggleStat" />

            <!-- 6. Graphe bâtons mensuel -->
            <StatsMonthlyChart :monthly="monthly" />

            <!-- 7. Carte du monde — pleine largeur, client-only (carto hors SSR/prerender) -->
            <ClientOnly>
                <StatsWorldMap class="worldmap" :country-map="countryMap" :max-seen="maxSeen" />
            </ClientOnly>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.stats {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.6rem 2.4rem 11rem;
}

.head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 2rem;

    > .title {
        color: $color-text;
        font: 800 2.6rem/1 $font-title;
        letter-spacing: -.06rem;
    }

    > .year {
        font: $normal 1.3rem/1 $font-mono;
        color: $color-primary-light;
    }
}

.empty {
    padding: 8rem 3rem;
    text-align: center;
    color: $color-text-weak;
    font: $normal 1.4rem/1 $font-body;
}

.grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.4rem;

    // Carte du monde : pleine largeur, en dernière position.
    > .worldmap { grid-column: 1 / -1; }
}

// Carte total (hero) — les autres cartes portent leur propre chrome dans leur composant.
.card.-total {
    grid-column: span 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: $color-surface-1;
    border: 1px solid $color-border-2;
    border-radius: 1.6rem;
    padding: 2rem;

    > .label {
        color: $color-text-weak;
        font: $bold 1.1rem/1 $font-body;
        letter-spacing: .12rem;
        text-transform: uppercase;
        margin-bottom: 1.2rem;
    }

    > .hero {
        color: $color-text;
        font: 800 3.4rem/1 $font-title;
        letter-spacing: -.1rem;
    }
}

@media (max-width: 999px) {
    .stats { padding: 1.4rem 1.4rem 11rem; }
    .grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
    .card.-total { grid-column: span 1; }
}
</style>
