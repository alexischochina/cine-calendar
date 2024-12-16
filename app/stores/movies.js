const client = useSupabaseClient();
export const useMoviesStore = defineStore('movies', {state: () => ({
        movies: [],
    }),
    getters: {

    },
    actions: {
        async getMovies() {
            const {data, error} = await client
                .from('calendar')
                .select('*');

            if (!error) {
                this.movies = data;

                for (const movie of this.movies) {
                    const releaseDate = await getReleaseDateFromId(movie.movie_id);
                    movie['release_date'] = releaseDate
                }

                sortMovies(movies.value)
            }
        }
    },
})