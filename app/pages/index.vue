<script setup>
const containerRef = ref(null)
const slides = ref(Array.from({length: 10}))

const swiper = useSwiper(containerRef)

</script>

<template>
    <div class="home-wrapper wrapper -medium">
        <MovieListItem/>
    </div>
    <!--    <ClientOnly>
            <swiper-container ref="containerRef">
                <swiper-slide
                    v-for="(slide, idx) in slides"
                    :key="idx"
                    style="background-color: rgb(32, 233, 70); color: white;"
                    class="title-2"
                >
                    Slide {{ idx + 1 }}
                </swiper-slide>
            </swiper-container>
        </ClientOnly>-->
</template>

<style lang="scss">
.home-wrapper {
    margin-top: 20rem;
    height: 100vh;
}

swiper-slide {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 20vh;
}
</style>
