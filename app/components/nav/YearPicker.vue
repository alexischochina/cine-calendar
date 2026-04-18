<script setup>
import {onClickOutside} from "@vueuse/core";

const currentYear = new Date().getFullYear();
const selectedYear = ref(currentYear);
const availableYears = ref([]);
const showYearPicker = ref(false);
const yearPickerRef = ref(null);

const sortedYears = computed(() => {
    const others = availableYears.value.filter(y => y !== selectedYear.value).sort((a, b) => a - b);
    return [...others, selectedYear.value];
});

const selectYear = (year) => {
    selectedYear.value = year;
    showYearPicker.value = false;
    window.dispatchEvent(new CustomEvent('scroll-to-year', { detail: { year } }));
}

const resetToCurrentYear = () => {
    selectedYear.value = currentYear;
    showYearPicker.value = false;
}

defineExpose({ resetToCurrentYear })

const onYearsUpdated = (event) => {
    availableYears.value = event.detail?.years ?? [];
}

onMounted(() => window.addEventListener('years-updated', onYearsUpdated))
onBeforeUnmount(() => window.removeEventListener('years-updated', onYearsUpdated))
onClickOutside(yearPickerRef, () => { showYearPicker.value = false; })
</script>

<template>
    <div ref="yearPickerRef" class="year-select" :class="{ '-open': showYearPicker }">
        <div class="year-options" v-if="availableYears.length > 1">
            <button v-for="year in sortedYears.slice(0, -1)" :key="year"
                    class="year-option input-body"
                    @click.stop="selectYear(year)">
                {{ year }}
            </button>
        </div>
        <button class="year-current input-body" @click.stop="showYearPicker = !showYearPicker">
            {{ selectedYear }}
        </button>
    </div>
</template>

<style lang="scss" scoped>
.year-select {
    position: relative;
}

.year-current {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 3.5rem;
    padding: 0 1rem;
    border-radius: .5rem;
    white-space: nowrap;
    color: $color-white;
    font-size: 2rem;
    transition: background-color .2s linear;

    .-open & {
        background-color: $color-dark-grey;
        border-radius: 0 0 .5rem .5rem;
    }
}

.year-options {
    position: absolute;
    bottom: 100%;
    left: 0;
    min-width: 100%;
    display: flex;
    flex-direction: column;
    background-color: $color-dark-grey;
    border-radius: .5rem .5rem 0 0;
    transform: scaleY(0);
    transform-origin: bottom center;
    transition: transform .2s $cubic-ease-out;
    z-index: 5;
    overflow: hidden;

    .-open & {
        transform: scaleY(1);
    }
}

.year-option {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 3.5rem;
    padding: 0 1rem;
    white-space: nowrap;
    color: $color-white;
    font-size: 2rem;
    transition: background-color .2s linear;
}

@media (hover: hover) {
    .year-current:hover {
        background-color: $color-dark-grey;
    }

    .year-option:hover {
        background-color: $color-grey;
    }
}
</style>
