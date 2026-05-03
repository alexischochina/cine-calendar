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
        <Svg name="close"/>
        <span>Supprimer</span>
    </button>
</template>

<style lang="scss" scoped>
.menu-item {
    background-color: transparent;
    color: $color-white;
    border: none;
    border-radius: .25rem;
    padding: .75rem 1rem;
    font-family: inherit;
    font-size: 1.4rem;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: .75rem;
    transition: background-color .2s linear, color .2s linear;

    > :deep(svg) {
        width: 1.4rem;
        height: 1.4rem;
        flex-shrink: 0;
    }

    @media (hover: hover) {
        &:hover {
            background-color: rgba($color-white, .08);
        }

        &.-danger:hover {
            color: #ec008b;
        }
    }
}
</style>
