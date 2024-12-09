<script setup>

</script>

<template>
    <div class="nav-header flex">
        <button class="btn">
            <Svg name="add"/>
        </button>
        <button class="btn flex">
            <Svg name="search"/>
        </button>
    </div>
</template>

<style lang="scss" scoped>
.nav-header {
    z-index: 9999999;
    position: fixed;
    bottom: 5rem;
    left: 50%;
    transform: translateX(-50%);
    background-color: $color-grey;
    border-radius: 1rem;
    padding: 1rem;
    gap: .5rem;
}

.btn {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: .5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background-color .2s linear;

    > svg {
        width: 2rem;
        height: auto;
    }
}

@media (hover: hover) {
    .btn:hover {
        background-color: $color-dark-grey;
    }
}
</style>