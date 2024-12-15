<script setup>

definePageMeta({
    middleware: ['auth'],
})

const client = useSupabaseClient()
const sortedMovies = ref({});
const movies = ref([])
const moviesWithDates = ref([]);
const containerRef = ref(null)
//const slides = ref(Array.from({length: 10}))
//const swiper = useSwiper(containerRef)

async function getMovies() {
    const { data, error } = await client
        .from('calendar')
        .select('*');

    if (!error) {
        movies.value = data;

        for (const movie of movies.value) {
            const releaseDate = await getReleaseDateFromId(movie.movie_id);
            movie['release_date'] = releaseDate
        }

        sortMovies(movies.value)
    }
}

const getReleaseDateFromId = async (id) => {
    try {
        const {data: dates} = await useFetch(`/api/movies/${id}/release_dates`);
        const frenchDates = ref(null)
        const frenchDate = ref('');
        dates.value.results.forEach((lang) => {
            if (lang.iso_3166_1 === 'FR') {
                frenchDates.value = lang.release_dates;
            }
        })
        frenchDates.value.forEach((date) => {
            if (date.note === '' || /CNC/i.test(date.note) || date.note === 'Netflix' || date.note === 'Amazon' || date.note === 'Disney+') {
                frenchDate.value = date.release_date
            }
        })

        return formateDate(frenchDate.value);

        // TODO
        /*if (frenchRelease && frenchRelease.release_dates.length > 0) {
            frenchReleaseYear.value = new Date(
                frenchRelease.release_dates[0].release_date
            ).getFullYear();
        } else {
            frenchReleaseYear.value = 'Non dispo';
        }*/
    } catch (error) {
        console.error('Erreur de récupération des dates', error);
    }
};

const formateDate = ((fullDate) => {
    const date = new Date(fullDate)
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}, ${month.toString().padStart(2, '0')}, ${day.toString().padStart(2, '0')}`;
})

const sortMovies = ((movies) => {
    const sorted = {};

    movies.forEach((movie) => {
        const date = new Date(movie.release_date);
        const year = date.getFullYear();
        const month = new Intl.DateTimeFormat('fr-FR', {month: 'short'}).format(date);
        const day = date.getDate();

        if (!sorted[year]) {
            sorted[year] = {};
        }
        if (!sorted[year][month]) {
            sorted[year][month] = {};
        }
        if (!sorted[year][month][day]) {
            sorted[year][month][day] = [];
        }

        sorted[year][month][day].push(movie);
    });

    sortedMovies.value = sorted;
})


onMounted(() => {
    window.addEventListener('movie-added', handleMovieAdded)
    getMovies()
})

onBeforeUnmount(() => {
    window.removeEventListener('movie-added', handleMovieAdded)
})

const handleMovieAdded = () => {
    getMovies();
}
</script>

<template>
    <div class="home-wrapper wrapper -large -padded">
        <div class="year-container" v-for="(months, year) in sortedMovies" :key="year">
            <div class="title-4">{{ year }}</div>
            <div class="month-container" v-for="(days, month) in months" :key="month">
                <div class="month-title title-2">{{ month }}</div>
                <div class="days-container">
                    <div class="day" v-for="(movies, day) in days" :key="day">
                        <MovieListItem v-for="(movie, index) in movies"
                                       :release-day="index === 0 ? day : ''"
                                       :movie-id="movie.movie_id"
                                       :media="movie.media"
                                       :state="movie.state"
                                       :id="movie.id"
                        />
                    </div>
                </div>
            </div>
        </div>
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
    padding: 13rem 0;
    min-height: 100vh;
}

.month-container {
    display: grid;
    grid-template-columns: 15rem auto;
    border-top: 1px solid $color-white;
}

.month-title {
    padding-top: 2rem;
    text-align: center;
    text-transform: capitalize;
}

swiper-slide {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 20vh;
}

.day:not(:last-child) {
    border-bottom: solid 1px $color-white;
}
</style>
