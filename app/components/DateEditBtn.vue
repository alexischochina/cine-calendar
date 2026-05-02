<script setup>
import { onClickOutside } from '@vueuse/core';

const emits = defineEmits(['release-date-updated', 'open', 'close']);

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
const isOpen = ref(false);
const container = ref(null);
const dateValue = ref(props.manualReleaseDate || '');

watch(() => props.manualReleaseDate, (val) => {
    dateValue.value = val || '';
});

watch(isOpen, (val) => {
    emits(val ? 'open' : 'close');
});

const toggle = () => {
    isOpen.value = !isOpen.value;
}

const save = async (newDate) => {
    const { error } = await client
        .from('calendar')
        .update({ manual_release_date: newDate || null })
        .eq('id', props.id);
    if (!error) {
        emits('release-date-updated', { id: props.id, manual_release_date: newDate || null });
        isOpen.value = false;
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

onClickOutside(container, () => {
    isOpen.value = false;
});
</script>

<template>
    <div class="date-edit-btn-wrapper" ref="container">
        <button class="date-edit-btn" :class="{ '-active': !!manualReleaseDate }" @click.stop="toggle" title="Modifier la date de sortie">
            <Svg name="calendar"/>
        </button>
        <div v-if="isOpen" class="date-popover" @click.stop>
            <input type="date" :value="dateValue" @change="onChange" class="date-input"/>
            <button v-if="manualReleaseDate" class="clear-btn" @click="clear">Effacer</button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.date-edit-btn-wrapper {
    position: relative;
    flex-shrink: 0;
}

.date-edit-btn {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear, color .2s linear;
    color: rgba($color-white, .6);

    > svg {
        width: 1.6rem;
        height: auto;
    }

    &.-active {
        color: #ec008b;
    }

    @media (hover: hover) {
        &:hover {
            background-color: $color-dark-grey;
            color: $color-white;
        }

        &.-active:hover {
            color: #ec008b;
        }
    }
}

.date-popover {
    position: absolute;
    top: calc(100% + .5rem);
    right: 0;
    background-color: $color-dark-grey;
    border-radius: .5rem;
    padding: .75rem;
    display: flex;
    flex-direction: column;
    gap: .5rem;
    z-index: 20;
    box-shadow: 0 4px 12px rgba(0, 0, 0, .4);
    min-width: 18rem;
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
