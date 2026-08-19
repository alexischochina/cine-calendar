// Navigation/scroll dans le calendrier. La timeline n'affiche qu'une année à la fois
// (filtrage façon maquette) : ces helpers trouvent le film cible (le parent décide de
// l'année à afficher), puis scrollent jusqu'à lui dans le conteneur `.timeline`.
//
// Le **choix** du film cible est une règle pure : `app/utils/movieSearch.js`, où les tests l'atteignent.
export function useMovieScroll(moviesRef) {
    const list = () => moviesRef?.value ?? [];

    // Attend que l'élément soit monté (après bascule d'année), puis scrolle.
    const scrollToSelector = (selector, block = 'center') => {
        let tries = 0;
        const attempt = () => {
            const el = document.querySelector(selector);
            if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block }), 120);
            else if (tries++ < 30) setTimeout(attempt, 80);
        };
        attempt();
    };

    const scrollToMovie = (movieId) => scrollToSelector(`.-id-${movieId}`);

    const scrollToTop = () => document.querySelector('.timeline')?.scrollTo({ top: 0 });

    const closestMovie = () => closestToToday(list());

    const searchMovie = (term) => bestSearchMatch(list(), term);

    return { closestMovie, searchMovie, scrollToMovie, scrollToTop }
}
