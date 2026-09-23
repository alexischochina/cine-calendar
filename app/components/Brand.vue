<template>
    <div class="brand flex -align-center">
        <Svg name="logo" class="logo" />
        <div class="name">Ciné<span class="accent">genda</span></div>
    </div>
</template>

<style lang="scss" scoped>
.brand {
    gap: 1.2rem;

    > .logo {
        width: 4.4rem;
        height: auto;

        @media #{$mobile} {
            width: 3.6rem;
        }
    }

    > .name {
        color: $color-text;
        letter-spacing: -.08rem;
        font: 800 2.6rem/1 $font-title;

        > .accent {
            color: $color-primary;
        }
    }
}
</style>
