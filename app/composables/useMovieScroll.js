// Navigation/scroll dans le calendrier. La timeline n'affiche qu'une année à la fois
// (filtrage façon maquette) : ces helpers trouvent le film cible (le parent décide de
// l'année à afficher), puis scrollent jusqu'à lui dans le conteneur `.timeline`.
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

    // Film daté le plus proche d'aujourd'hui (passé le plus récent, sinon futur le plus proche).
    const closestMovie = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dated = list().filter(m => m.release_date && !isNaN(new Date(m.release_date)));
        if (!dated.length) return null;

        let target = null;
        let closestDiff = Infinity;
        for (const m of dated) {
            const date = new Date(m.release_date);
            date.setHours(0, 0, 0, 0);
            const diff = today - date;
            if (diff >= 0 && diff < closestDiff) { closestDiff = diff; target = m; }
        }
        if (!target) {
            target = dated.reduce((a, b) => new Date(a.release_date) <= new Date(b.release_date) ? a : b);
        }
        return target;
    };

    // Meilleur film correspondant à un terme de recherche (futur le plus proche prioritaire).
    const searchMovie = (term) => {
        const q = term?.toLowerCase();
        if (!q) return null;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const matches = list()
            .filter(m => m.title && m.title.toLowerCase().includes(q) && m.release_date && !isNaN(new Date(m.release_date)))
            .map(m => ({ movie: m, date: new Date(m.release_date) }));

        if (!matches.length) return null;

        matches.sort((a, b) => {
            const aFuture = a.date >= today;
            const bFuture = b.date >= today;
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            if (aFuture && bFuture) return a.date - b.date;
            return b.date - a.date;
        });

        return matches[0].movie;
    };

    return { closestMovie, searchMovie, scrollToMovie, scrollToTop }
}
