<script setup>
const props = defineProps({
    type: {
        type: String,
        validator: value => ['media', 'state'].includes(value)
    },
    selected: {
        type: String,
        default: 'unknown',
        validator: value => ['cinema', 'unknown', 'netflix', 'primeVideo', 'disney+', 'vod', 'unseen', 'seen', 'downloadAvailable'].includes(value)
    },
    openDirection: {
        type: String,
        default: 'center',
        validator: value => ['center', 'bottom'].includes(value)
    }
})
const options = ref([]);
const isOpen = ref(false);
const option = ref([]);
const emits = defineEmits(['option-selected']);
const selectedIcon = ref([]);
const onFront = ref(false)

if (props.type === 'media') {
    options.value = ['cinema', 'vod', 'primeVideo', 'disney+', 'netflix'];
} else if (props.type === 'state') {
    options.value = ['unseen', 'seen', 'downloadAvailable'];
}

const handleOpen = (() => {
    isOpen.value = true;
    onFront.value = true;
    setTimeout(() => {
        option.value.forEach((op, index) => {
            op.classList.add('-show')
        })
    }, 400)
})

const handleClose = (() => {
    option.value.forEach((op, index) => {
        op.classList.remove('-show')
    })
    isOpen.value = false;
    setTimeout(() => {
        onFront.value = false;
    }, 400)
})

const handleOnClick = ((option) => {
    handleClose();
    emits('option-selected', option)
})

const sortedOptions = computed(() => {
    if (!options.value.includes(props.selected)) {
        return options.value;
    }
    const newOptions = options.value.filter(option => option !== props.selected);

    if (props.openDirection === 'center') {
        const middleIndex = Math.floor(newOptions.length / 2);
        newOptions.splice(middleIndex, 0, props.selected);
    } else if (props.openDirection === 'bottom') {
        newOptions.splice(options.value.length, 0, props.selected);
    }
    return newOptions;
});
</script>

<template>
    <ClientOnly>
        <div class="select flex -align-center -justify-center"
             :class="[{ [`-${props.type}`]: true, '-open': isOpen, [`-${props.openDirection}`]: true }]"
             @mouseenter="handleOpen" @mouseleave="handleClose">
            <NuxtImg v-if="props.type === 'media'" class="selected-icon"
                     :class="[{ [`-${props.selected}`]: true, '-on-front': onFront }]"
                     :src="`/images/${props.selected}.png`" ref="selectedIcon"/>
            <Svg v-if="props.type === 'state'" :name="props.selected" class="selected-icon"
                 :class="[{ [`-${props.selected}`]: true, '-on-front': onFront }]" ref="selectedIcon"/>
            <div class="options flex -direction-column">
                <button class="option" :class="{'-selected' : option === props.selected}"
                        v-for="option in sortedOptions"
                        :key="option" ref="option" @click="handleOnClick(option)">
                    <NuxtImg v-if="props.type === 'media'" class="icon" :src="`/images/${option}.png`"/>
                    <Svg v-if="props.type === 'state'" :name="option" class="icon" :class="`-${option}`"/>
                </button>
            </div>
        </div>
    </ClientOnly>
</template>

<style lang="scss" scoped>
.select {
    border-radius: .5rem;
    transition: background-color .2s linear;
    position: relative;
    padding: .8rem;

    &.-open {
        .options {
            transform: translateY(-50%) scaleY(1);
        }

        &.-bottom {
            .options {
                transform: translateY(0) scaleY(1);
            }
        }
    }

    &.-bottom {
        .options {
            transform: translateY(0) scaleY(0);
            top: auto;
            bottom: 0;
            transform-origin: bottom;
        }
    }
}

.selected-icon {
    position: relative;
    width: 3.5rem;
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
    gap: 1.1rem;
    padding: .8rem;
    position: absolute;
    top: 50%;
    left: 0;
    transform: translateY(-50%) scaleY(0);
    background-color: $color-dark-grey;
    border-radius: .5rem;
    overflow: hidden;
    transition: transform .2s $cubic-ease-out .2s;
    z-index: 5;
}

.option {
    transition: transform .2s $cubic-ease-in;
    width: 3.5rem;
    height: 3.5rem;
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
    width: 100%;
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

@media (hover: hover) {
    .select:hover {
        background-color: $color-dark-grey;
    }

    .option:not(.-selected):hover > .icon {
        transform: scale(1.2);
    }
}
</style>