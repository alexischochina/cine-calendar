<script setup>
definePageMeta({
    middleware: ['auth'],
})

const containerRef = ref(null)
//const slides = ref(Array.from({length: 10}))
//const swiper = useSwiper(containerRef)

const client = useSupabaseClient()

const movies = ref([])
async function getMovies() {
    const {data, error} = await client.from('calendar').select('*').order('created_at');
    if (!error) {
        movies.value = data
    }
}

onMounted(() => {
    getMovies()
})

</script>

<template>
    <div class="home-wrapper wrapper -medium">
        <MovieListItem v-for="movie in movies"
                       :title="movie.title"
                       :media="movie.media"
                       :state="movie.state"
                       :id="movie.id"
        />
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
    padding-top: 20rem;
    height: 100vh;
}

swiper-slide {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 20vh;
}
</style>
