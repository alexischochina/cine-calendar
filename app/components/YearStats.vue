<script setup>
// `stat` est précalculé une seule fois par le parent (cf. index.vue) pour éviter
// de re-itérer toute la liste des films pour chaque année affichée.
const props = defineProps({
    stat: {
        type: Object,
        default: () => ({ total: 0, seen: 0, cinema: 0 }),
    },
});

const stats = computed(() => props.stat ?? { total: 0, seen: 0, cinema: 0 });
</script>

<template>
    <div class="year-stats flex -align-center">
        <div class="stat">
            <span class="stat-value">{{ stats.total }}</span>
            <span class="stat-label">films</span>
        </div>
        <div class="stat" title="Films vus">
            <Svg name="seen" class="stat-icon -seen" aria-hidden="true" />
            <span class="stat-value">{{ stats.seen }}</span>
        </div>
        <div class="stat" v-if="stats.cinema" title="Vus au cinéma">
            <NuxtImg src="/images/cinema.png" class="stat-icon" alt="" />
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
