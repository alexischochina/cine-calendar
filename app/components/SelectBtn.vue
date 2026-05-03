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
</script>

<template>
    <ClientOnly>
        <div ref="container" class="select-btn flex -align-center -justify-center"
             :class="[{ [`-${props.type}`]: true, '-open': isOpen, [`-${props.openDirection}`]: true }]"
             @click.stop="handleToggle">
            <NuxtImg v-if="props.type === 'media'" class="selected-icon"
                     :class="[{ [`-${props.selected}`]: true, '-on-front': onFront }]"
                     :src="`/images/${props.selected}.png`" ref="selectedIcon"/>
            <Svg v-if="props.type === 'state'" :name="props.selected" class="selected-icon"
                 :class="[{ [`-${props.selected}`]: true, '-on-front': onFront }]" ref="selectedIcon"/>
            <div class="options flex -direction-column" :style="{ '--selected-index': selectedIndex }">
                <button class="option" :class="{'-selected' : option === props.selected}"
                        v-for="option in sortedOptions"
                        :key="option" ref="optionEls" @click.stop="handleOnClick(option)">
                    <NuxtImg v-if="props.type === 'media'" class="icon" :src="`/images/${option}.png`"/>
                    <Svg v-if="props.type === 'state'" :name="option" class="icon" :class="`-${option}`"/>
                </button>
            </div>
        </div>
    </ClientOnly>
</template>

<style lang="scss" scoped>
.select-btn {
    border-radius: .5rem;
    transition: background-color .2s linear;
    position: relative;
    padding: .5rem;
    z-index: 1;

    &.-open {
        z-index: 20;

        .options {
            transform: translateY(calc(var(--selected-pos) * -1)) scaleY(1);
        }
    }
}

.selected-icon {
    position: relative;
    width: 2.5rem;
    aspect-ratio: 1;
    object-fit: contain;
    z-index: 1;
    pointer-events: none;
    transition: color .2s linear;

    &.-seen {
        color: $color-yellow;
    }

    .-cinema &.-seen {
        color: $color-green;
    }

    &.-on-front {
        z-index: 10;
    }
}

.options {
    --selected-pos: calc(.5rem + var(--selected-index, 0) * 3.6rem + 1.25rem);
    gap: 1.1rem;
    padding: .5rem;
    position: absolute;
    top: 50%;
    left: 0;
    transform: translateY(calc(var(--selected-pos) * -1)) scaleY(0);
    transform-origin: 50% var(--selected-pos);
    background-color: $color-dark-grey;
    border-radius: .5rem;
    transition: transform .1s $cubic-ease-out;
    z-index: 5;
}

.option {
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
    display: block;
    width: 100%;
    height: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    transition: transform .2s $cubic-ease-out, opacity .2s linear;
    opacity: 0;
    transform: scale(.5);

    &.-seen {
        color: $color-yellow;
    }

    .-cinema &.-seen {
        color: $color-green;
    }
}

.-downloadAvailable {
    color: $color-orange;
}

.-inTheaters {
    color: #ec008b;
}

@media (hover: hover) {
    .select-btn:hover {
        background-color: $color-dark-grey;
    }

    .option:not(.-selected):hover > .icon {
        transform: scale(1.1);
    }
}
</style>