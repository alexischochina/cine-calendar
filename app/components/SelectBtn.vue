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
})
const options = ref([])
const isOpen = ref(false)
const option = ref([])

if (props.type === 'media') {
    options.value = ['cinema', 'vod', 'primeVideo', 'disney+', 'netflix'];
} else if (props.type === 'state') {
    options.value = ['unseen', 'seen', 'downloadAvailable'];
}

options.value = options.value.filter(option => option !== props.selected)
options.value.splice(options.value.length / 2, 0, props.selected)

const handleOpen = (() => {
    isOpen.value = true;
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
    setTimeout(() => {
        isOpen.value = false;
    }, 300)
})
</script>

<template>
    <div class="select flex -align-center -justify-center" :class="[{ [`-${props.type}`]: true, '-open': isOpen }]"
         @mouseenter="handleOpen" @mouseleave="handleClose">
        <NuxtImg class="selected-icon" :src="`/images/${props.selected}.png`"/>
        <div class="options flex -direction-column">
            <button class="option" v-for="option in options" ref="option">
                <NuxtImg class="icon" :src="`/images/${option}.png`"/>
            </button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.select {
    border-radius: .5rem;
    transition: background-color .2s linear;
    cursor: pointer;
    position: relative;
    padding: .8rem;

    &.-open .options {
        transform: translateY(-50%) scaleY(1);
    }
}

.selected-icon {
    position: relative;
    width: 3.5rem;
    aspect-ratio: 1;
    object-fit: contain;
    z-index: 10;
    pointer-events: none;
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

    &.-show > .icon {
        transform: scale(1);
        //opacity: 1;
    }
}

.icon {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    transition: transform .3s $cubic-ease-out;
    transform: scale(0);
    //opacity: 0;
}

@media (hover: hover) {
    .select:hover {
        background-color: $color-dark-grey;
    }

    .option:hover > .icon {
        transform: scale(1.2);
    }
}
</style>