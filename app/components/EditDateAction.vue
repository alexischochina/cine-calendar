<script setup>
const emits = defineEmits(['release-date-updated', 'done']);

const props = defineProps({
    id: {
        type: Number,
        required: true,
    },
    manualReleaseDate: {
        type: String,
        default: null,
    },
});

const client = useSupabaseClient();
const dateValue = ref(props.manualReleaseDate || '');

watch(() => props.manualReleaseDate, (val) => {
    dateValue.value = val || '';
});

const save = async (newDate) => {
    const { error } = await client
        .from('calendar')
        .update({ manual_release_date: newDate || null })
        .eq('id', props.id);
    if (!error) {
        emits('release-date-updated', { id: props.id, manual_release_date: newDate || null });
        emits('done');
    }
}

const onChange = (event) => {
    const value = event.target.value;
    dateValue.value = value;
    if (value) save(value);
}

const clear = () => {
    dateValue.value = '';
    save(null);
}
</script>

<template>
    <div class="edit-date-action">
        <input type="date" :value="dateValue" @change="onChange" class="date-input"/>
        <button v-if="manualReleaseDate" class="clear-btn" @click="clear">Effacer la date manuelle</button>
    </div>
</template>

<style lang="scss" scoped>
.edit-date-action {
    display: flex;
    flex-direction: column;
    gap: .5rem;
}

.date-input {
    background-color: $color-black;
    color: $color-white;
    border: 1px solid rgba($color-white, .2);
    border-radius: .25rem;
    padding: .5rem;
    font-family: inherit;
    font-size: 1.4rem;
    color-scheme: dark;
}

.clear-btn {
    background-color: transparent;
    color: rgba($color-white, .7);
    border: 1px solid rgba($color-white, .2);
    border-radius: .25rem;
    padding: .5rem;
    font-size: 1.2rem;
    cursor: pointer;
    transition: background-color .2s linear, color .2s linear;

    @media (hover: hover) {
        &:hover {
            background-color: rgba($color-white, .1);
            color: $color-white;
        }
    }
}
</style>
