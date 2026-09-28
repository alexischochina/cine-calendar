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

// '' | 'incomplete' | 'error'
const status = ref('');

const statusText = computed(() => ({
    incomplete: 'Saisissez une année à 4 chiffres : la date n\u2019est pas encore enregistrée.',
    error: 'Enregistrement impossible. Réessayez.',
})[status.value] || '');

watch(() => props.manualReleaseDate, (val) => {
    dateValue.value = val || '';
    status.value = '';
});

const save = async (newDate) => {
    const { error } = await client
        .from('calendar')
        .update({ manual_release_date: newDate || null })
        .eq('id', props.id);
    if (error) {
        status.value = 'error';
        return;
    }
    status.value = '';
    emits('release-date-updated', { id: props.id, manual_release_date: newDate || null });
    emits('done');
}

const onChange = (event) => {
    const value = event.target.value;
    dateValue.value = value;
    if (isCompleteDateInput(value)) {
        save(value);
    } else {
        status.value = value ? 'incomplete' : '';
    }
}

const clear = () => {
    dateValue.value = '';
    save(null);
}
</script>

<template>
    <div class="edit-date-action">
        <label class="field-label" :for="`edit-date-${id}`">Date de sortie</label>
        <input :id="`edit-date-${id}`" type="date" :value="dateValue" @change="onChange"
               class="date-input" :class="{ '-pending': status === 'incomplete', '-error': status === 'error' }"
               :aria-describedby="statusText ? `edit-date-status-${id}` : undefined"/>
        <p :id="`edit-date-status-${id}`" class="status" :class="{ '-error': status === 'error' }"
           role="status">{{ statusText }}</p>
        <button v-if="manualReleaseDate" class="clear-btn" @click="clear">Effacer la date manuelle</button>
    </div>
</template>

<style lang="scss" scoped>
.edit-date-action {
    display: flex;
    flex-direction: column;
    gap: .5rem;
}

// ⚠️ Pas $color-text-quiet : donné AA sur $color-surface-1, il retombe à 4,33:1 sur le
// $color-surface-2 du popover.
.field-label {
    color: $color-text-muted;
    font-size: 1.1rem;
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

    &.-pending {
        border-color: rgba($color-primary-light, .5);
    }

    &.-error {
        border-color: $color-primary-light;
    }
}

// Hauteur réservée même vide : le message ne doit pas décaler l'input sous le curseur.
.status {
    min-height: 1.4rem;
    color: $color-text-muted;
    font-size: 1.1rem;
    line-height: 1.3;

    &.-error {
        color: $color-primary-light;
    }
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
