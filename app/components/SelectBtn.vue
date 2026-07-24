<script setup>
import { onClickOutside } from '@vueuse/core';

const props = defineProps({
    type: {
        type: String,
        validator: value => ['media', 'state'].includes(value)
    },
    selected: {
        type: String,
        default: 'unknown',
        validator: value => ['cinema', 'unknown', 'netflix', 'primeVideo', 'disney+', 'vod', 'unseen', 'seen', 'downloadAvailable', 'inTheaters'].includes(value)
    },
    openDirection: {
        type: String,
        default: 'center',
        validator: value => ['center', 'bottom'].includes(value)
    }
})
const options = ref([]);
const isOpen = ref(false);
const optionEls = ref([]);
const emits = defineEmits(['option-selected']);
const selectedIcon = ref([]);
const onFront = ref(false);
const container = ref(null);

if (props.type === 'media') {
    options.value = ['cinema', 'vod', 'primeVideo', 'disney+', 'netflix'];
} else if (props.type === 'state') {
    options.value = ['unseen', 'seen', 'downloadAvailable', 'inTheaters'];
}

const handleOpen = () => {
    isOpen.value = true;
    onFront.value = true;
    setTimeout(() => {
        optionEls.value.forEach((op) => op.classList.add('-show'))
    }, 150)
}

const handleClose = () => {
    optionEls.value.forEach((op) => op.classList.remove('-show'))
    isOpen.value = false;
    setTimeout(() => {
        onFront.value = false;
    }, 150)
}

const handleToggle = () => {
    isOpen.value ? handleClose() : handleOpen();
}

const handleOnClick = (option) => {
    handleClose();
    emits('option-selected', option)
}

onClickOutside(container, handleClose)

const sortedOptions = computed(() => {
    if (!options.value.includes(props.selected)) {
        return options.value;
    }
    const newOptions = options.value.filter(option => option !== props.selected);

    if (props.openDirection === 'center') {
        const middleIndex = Math.floor(newOptions.length / 2);
        newOptions.splice(middleIndex, 0, props.selected);
    } else if (props.openDirection === 'bottom') {
        newOptions.splice(newOptions.length, 0, props.selected);
    }
    return newOptions;
});

const selectedIndex = computed(() => sortedOptions.value.indexOf(props.selected));

const MEDIA_LABELS = { cinema: 'Cinéma', vod: 'VOD', primeVideo: 'Prime Video', 'disney+': 'Disney+', netflix: 'Netflix' };
const STATE_LABELS = { unseen: 'Non vu', seen: 'Vu', downloadAvailable: 'Téléchargeable', inTheaters: 'En salle', unknown: 'Inconnu' };
const labelFor = (value) => (props.type === 'media' ? MEDIA_LABELS : STATE_LABELS)[value] ?? value;
const groupLabel = computed(() => props.type === 'media' ? 'Type de média' : 'État de visionnage');
const optionId = (value) => `sb-${props.type}-${value}`;
</script>

<template>
    <ClientOnly>
        <div ref="container" class="select-btn flex -align-center -justify-center"
             :class="[{ [`-${props.type}`]: true, '-open': isOpen, [`-${props.openDirection}`]: true }]"
             role="listbox" tabindex="0" :aria-label="`${groupLabel} : ${labelFor(props.selected)}`"
             :aria-activedescendant="optionId(props.selected)" @click.stop="handleToggle"
             @keydown.enter.prevent="handleToggle" @keydown.space.prevent="handleToggle"
             @keydown.escape="handleClose">
            <MediaBadge v-if="props.type === 'media'" :media="props.selected" class="selected-icon"
                        :class="{ '-on-front': onFront }" ref="selectedIcon"/>
            <Svg v-if="props.type === 'state'" :name="props.selected" class="selected-icon"
                 :class="[{ [`-${props.selected}`]: true, '-on-front': onFront }]" ref="selectedIcon"/>
            <div class="options flex -direction-column" :style="{ '--selected-index': selectedIndex }">
                <button class="option" :class="{'-selected' : option === props.selected}"
                        v-for="option in sortedOptions" role="option" :id="optionId(option)"
                        :aria-selected="option === props.selected" :aria-label="labelFor(option)"
                        :key="option" ref="optionEls" @click.stop="handleOnClick(option)">
                    <MediaBadge v-if="props.type === 'media'" :media="option" class="icon"/>
                    <Svg v-if="props.type === 'state'" :name="option" class="icon" :class="`-${option}`"/>
                </button>
            </div>
        </div>
    </ClientOnly>
</template>

<style lang="scss" scoped>
.select-btn {
    position: relative;
    display: grid;
    place-items: center;
    border-radius: 7px;
    cursor: pointer;
    z-index: 1;
    transition: background-color .15s linear;

    &.-media { width: 2.4rem; height: 2.4rem; }
    &.-state { width: 2.6rem; height: 2.6rem; color: $color-text-weak; }

    &.-open {
        z-index: 20;

        .options {
            transform: translateY(calc(var(--selected-pos) * -1)) scaleY(1);
        }
    }
}

.selected-icon {
    position: relative;
    z-index: 1;
    pointer-events: none;
    transition: color .2s linear;

    &.-on-front { z-index: 10; }
}

// Couleurs des icônes d'état (sélection + options). Le vert « vu au ciné » vient
// du parent `.-cinema` (classe posée sur `.movie-list-item`).
.-state {
    .selected-icon, .icon {
        &.-unseen { color: $color-text-weak; }
        &.-seen { color: $color-yellow; }
        &.-downloadAvailable { color: $color-text-muted; }
        &.-inTheaters { color: $color-primary; }
    }

    .selected-icon { width: 1.9rem; height: 1.9rem; }
}

.-cinema {
    .-state .selected-icon.-seen,
    .-state .icon.-seen { color: $color-green; }
}

.options {
    --selected-pos: calc(.5rem + var(--selected-index, 0) * 3.6rem + 1.25rem);
    gap: 1.1rem;
    padding: .5rem;
    position: absolute;
    top: 50%;
    left: 50%;
    margin-left: -1.75rem;
    transform: translateY(calc(var(--selected-pos) * -1)) scaleY(0);
    transform-origin: 50% var(--selected-pos);
    background-color: $color-surface-2;
    border: 1px solid $color-border-5;
    border-radius: .8rem;
    transition: transform .1s $cubic-ease-out;
    z-index: 5;
}

.option {
    display: grid;
    place-items: center;
    transition: transform .1s $cubic-ease-in;
    width: 2.5rem;
    height: 2.5rem;
    cursor: pointer;

    &.-selected {
        pointer-events: none;
        cursor: default;
    }

    &:not(.-selected).-show > .icon {
        opacity: 1;
        transform: scale(1);
    }
}

.icon {
    transition: transform .2s $cubic-ease-out, opacity .2s linear;
    opacity: 0;
    transform: scale(.5);
}

.-state .icon { width: 1.9rem; height: 1.9rem; }

@media (hover: hover) {
    .select-btn.-state:hover { background-color: $color-hover; }

    .option:not(.-selected):hover > .icon {
        transform: scale(1.1);
    }
}
</style>