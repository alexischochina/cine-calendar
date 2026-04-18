<script setup>

definePageMeta({
    middleware: ['auth'],
})

const client = useSupabaseClient()
const sortedMovies = ref({});
const movies = ref([])
const moviesWithDates = ref([]);
const moviesWithoutDate = ref([]);
const containerRef = ref(null)
//const slides = ref(Array.from({length: 10}))
//const swiper = useSwiper(containerRef)

async function getMovies() {
    const { data, error } = await client
        .from('calendar')
        .select('*');

    if (!error) {
        const withDates = await Promise.all(
            data.map(async (movie) => ({
                ...movie,
                release_date: await getReleaseDateFromId(movie.movie_id),
            }))
        );
        movies.value = withDates;
        sortMovies(withDates);
    }
}

const getReleaseDateFromId = async (id) => {
    try {
        const dates = await $fetch(`/api/movies/${id}/release_dates`);
        const frenchDates = ref(null)
        const frenchDate = ref('');
        dates.results.forEach((lang) => {
            if (lang.iso_3166_1 === 'FR') {
                frenchDates.value = lang.release_dates;
            }
        })
        frenchDates.value?.forEach((date) => {
            if (date.note === '' || /CNC/i.test(date.note) || date.note === 'Netflix' || date.note === 'Amazon' || date.note === 'Disney+') {
                frenchDate.value = date.release_date
            }
        })

        return frenchDate.value ? formateDate(frenchDate.value) : null;

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

const sortMovies = (movies) => {
    const sorted = {};

    moviesWithoutDate.value = movies.filter(m => !m.release_date || isNaN(new Date(m.release_date)));

    const byDate = [...movies]
        .filter(m => m.release_date && !isNaN(new Date(m.release_date)))
        .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    byDate.forEach((movie) => {
        const date = new Date(movie.release_date);
        const year = date.getFullYear();
        const month = new Intl.DateTimeFormat('fr-FR', {month: 'short'}).format(date).replace('.', '');
        const day = date.getDate();

        if (!sorted[year]) sorted[year] = {};
        if (!sorted[year][month]) sorted[year][month] = {};
        if (!sorted[year][month][day]) sorted[year][month][day] = [];

        sorted[year][month][day].push(movie);
    });

    sortedMovies.value = sorted;
}


const scrollToClosestDate = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attempt = () => {
        const dayEls = [...document.querySelectorAll('[data-date]')];
        if (!dayEls.length) {
            setTimeout(attempt, 100);
            return;
        }

        let target = null;
        let closestDiff = Infinity;

        for (const el of dayEls) {
            const date = new Date(el.dataset.date);
            date.setHours(0, 0, 0, 0);
            const diff = today - date;
            if (diff >= 0 && diff < closestDiff) {
                closestDiff = diff;
                target = el;
            }
        }

        if (target) {
            setTimeout(() => {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    };

    attempt();
}

onMounted(async () => {
    window.addEventListener('movie-added', handleMovieAdded)
    window.addEventListener('movie-exists', handleMovieExists)
    window.addEventListener('scroll-to-today', scrollToClosestDate)
    window.addEventListener('search-movie', handleSearchMovie)
    await getMovies()
    scrollToClosestDate()
})

onBeforeUnmount(() => {
    window.removeEventListener('movie-added', handleMovieAdded)
    window.removeEventListener('movie-exists', handleMovieExists)
    window.removeEventListener('scroll-to-today', scrollToClosestDate)
    window.removeEventListener('search-movie', handleSearchMovie)
})

const scrollToMovie = (movieId) => {
    const attempt = () => {
        const el = document.querySelector(`.-id-${movieId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            setTimeout(attempt, 100);
        }
    };
    attempt();
}

const handleMovieAdded = async (event) => {
    const newEntry = event.detail?.newEntry;
    if (!newEntry) return;
    const release_date = await getReleaseDateFromId(newEntry.movie_id);
    movies.value = [...movies.value, { ...newEntry, release_date }];
    sortMovies(movies.value);
    await nextTick();
    scrollToMovie(newEntry.movie_id);
}

const handleMovieExists = (event) => {
    const { movieId } = event.detail;
    if (movieId) scrollToMovie(movieId);
}

const handleMovieDeleted = (id) => {
    movies.value = movies.value.filter(m => m.id !== id);
    sortMovies(movies.value);
}


const handleSearchMovie = (event) => {
    const term = event.detail?.term?.toLowerCase();
    if (!term) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const links = [...document.querySelectorAll('.movie-link')];
    const matches = links
        .filter(el => el.textContent.trim().toLowerCase().includes(term))
        .map(el => {
            const dayEl = el.closest('[data-date]');
            return { el, date: dayEl ? new Date(dayEl.dataset.date) : null };
        })
        .filter(m => m.date);

    if (!matches.length) return;

    matches.sort((a, b) => {
        const aFuture = a.date >= today;
        const bFuture = b.date >= today;
        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;
        if (aFuture && bFuture) return a.date - b.date;
        return b.date - a.date;
    });

    matches[0].el.closest('[data-date]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
</script>

<template>
    <div class="home-wrapper wrapper -large -padded">
        <div class="year-container" v-for="(months, year) in sortedMovies" :key="year">
            <div class="title-4">{{ year }}</div>
            <div class="month-container" v-for="(days, month) in months" :key="month">
                <div class="month-title title-2">{{ month }}</div>
                <div class="days-container">
                    <div class="day" v-for="(movies, day) in days" :key="day" :data-date="movies[0].release_date">
                        <MovieListItem v-for="(movie, index) in movies"
                                       :release-day="index === 0 ? day : ''"
                                       :movie-id="movie.movie_id"
                                       :media="movie.media"
                                       :state="movie.state"
                                       :id="movie.id"
                                       :style="new Date(movie.release_date) > new Date() ? { opacity: 0.5 } : {}"
                                       @movie-deleted="handleMovieDeleted"
                        />
                    </div>
                </div>
            </div>
        </div>

        <div class="no-date-section" v-if="moviesWithoutDate.length">
            <div class="title-4">Sans date</div>
            <MovieListItem v-for="movie in moviesWithoutDate"
                           :key="movie.id"
                           :release-day="''"
                           :movie-id="movie.movie_id"
                           :media="movie.media"
                           :state="movie.state"
                           :id="movie.id"
                           :style="{ opacity: 0.5 }"
                           @movie-deleted="handleMovieDeleted"
            />
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

.no-date-section {
    margin-top: 4rem;
    border-top: 1px solid $color-white;
    padding-top: 2rem;
}
</style>
