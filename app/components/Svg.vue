<script setup>
const props = defineProps({
    name: {
        type: String,
        required: true,
    },
});

const nameRef = ref(props.name);
const svg = useLoadSvg(nameRef);

watch(() => props.name, (newName) => {
    nameRef.value = newName;
});
</script>

<template>
    <component v-if="svg" :is="svg"/>
</template>
