export const useMoviesStore = defineStore('movies', {
    state: () => ({
        movies: [],
        filters: {
            state: null,
            media: null,
        }
    }),
})
