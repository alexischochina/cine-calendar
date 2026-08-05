// Pont NavHeader → CustomEvents window, partagé par les layouts default + bare.
export function useNavEvents() {
    const dispatchMovieAdded = (newEntry) => window.dispatchEvent(new CustomEvent('movie-added', { detail: { newEntry } }))
    const dispatchMovieExists = (movieId) => window.dispatchEvent(new CustomEvent('movie-exists', { detail: { movieId } }))
    const dispatchScrollToToday = () => window.dispatchEvent(new CustomEvent('scroll-to-today'))
    const dispatchSearchMovie = (term) => window.dispatchEvent(new CustomEvent('search-movie', { detail: { term } }))
    return { dispatchMovieAdded, dispatchMovieExists, dispatchScrollToToday, dispatchSearchMovie }
}
