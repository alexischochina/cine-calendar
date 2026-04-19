<script setup>
const props = defineProps({
    movies: { type: Array, required: true },
    year: { type: [Number, String], required: true },
});

const stats = computed(() => {
    const y = Number(props.year);
    return props.movies.reduce((acc, m) => {
        if (!m.release_date || isNaN(new Date(m.release_date))) return acc;
        if (new Date(m.release_date).getFullYear() !== y) return acc;
        acc.total++;
        if (m.state === 'seen') acc.seen++;
        if (m.media === 'cinema' && m.state === 'seen') acc.cinema++;
        return acc;
    }, { total: 0, seen: 0, cinema: 0 });
});
</script>

<template>
    <div class="year-stats flex -align-center">
        <div class="stat">
            <span class="stat-value">{{ stats.total }}</span>
            <span class="stat-label">films</span>
        </div>
        <div class="stat">
            <Svg name="seen" class="stat-icon -seen" />
            <span class="stat-value">{{ stats.seen }}</span>
        </div>
        <div class="stat" v-if="stats.cinema">
            <NuxtImg src="/images/cinema.png" class="stat-icon" />
            <span class="stat-value">{{ stats.cinema }}</span>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.year-stats {
    gap: 1.25rem;
}

.stat {
    display: flex;
    align-items: center;
    gap: .4rem;
    opacity: .45;

    .stat-icon {
        width: 1.5rem;
        height: 1.5rem;
        object-fit: contain;
        flex-shrink: 0;

        &.-seen { color: $color-green; }
    }

    .stat-value {
        font-size: 1.4rem;
        font-family: $font-futura;
        font-weight: $medium;
    }

    .stat-label {
        font-size: 1.2rem;
        font-family: $font-futura;
        text-transform: uppercase;
        letter-spacing: .04em;
    }
}
</style>
