<script setup>
const emits = defineEmits(['movie-deleted']);

const props = defineProps({
    id: {
        type: Number,
        required: true,
    },
});

const client = useSupabaseClient();

const deleteMovie = async () => {
    const { error } = await client.from('calendar').delete().eq('id', props.id);
    if (!error) emits('movie-deleted', props.id);
}
</script>

<template>
    <button class="menu-item -danger" @click="deleteMovie">
        <span class="ico-box"><Svg name="trash"/></span>
        <span class="label">Supprimer</span>
    </button>
</template>

<style lang="scss" scoped>
.menu-item {
    background-color: transparent;
    border: none;
    border-radius: .9rem;
    padding: .9rem 1.1rem;
    font: $semi-bold 1.3rem/1 $font-body;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 1.1rem;
    transition: background-color .2s linear;

    > .ico-box {
        display: grid;
        place-items: center;
        width: 2.4rem;
        height: 2.4rem;
        border-radius: 7px;
        flex-shrink: 0;

        > :deep(svg) { width: 1.5rem; height: 1.5rem; }
    }

    &.-danger {
        color: $color-primary-light;

        > .ico-box {
            background: $color-danger-bg;
            color: $color-primary-light;
        }
    }

    @media (hover: hover) {
        &:hover {
            background-color: $color-hover-strong;
        }
    }
}
</style>
