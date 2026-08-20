// Navigation/scroll dans le calendrier. La timeline n'affiche qu'une année à la fois
// (filtrage façon maquette) : ces helpers trouvent le film cible (le parent décide de
// l'année à afficher), puis scrollent jusqu'à lui dans le conteneur `.timeline`.
//
// Le **choix** du film cible est une règle pure : `app/utils/movieSearch.js`, où les tests l'atteignent.
// Le **moment** où la ligne d'arrivée est marquée en est une autre : `app/utils/viewport.js`.

// Temps laissé au scroll `smooth` avant de marquer la ligne — sinon elle bat en traversant l'écran.
// Sauté quand la ligne est déjà sous les yeux : le scroll n'a alors rien à faire.
const FLASH_DELAY = 420;
// Bande haute/basse couverte par l'en-tête `sticky` et la nav flottante. Généreuse : se tromper coûte
// le délai, pas une erreur.
const FLASH_CLEARANCE = 120;

// Un seul flash en vol, tous appelants confondus : `useCalendarNav` est instancié dans le layout **et**
// dans la page Stats, un timer d'instance ne pourrait pas annuler celui de l'autre. Jamais posé ailleurs
// que sur interaction, donc jamais pendant un rendu serveur.
let pendingFlash = null;

export function useMovieScroll(moviesRef) {
    const list = () => moviesRef?.value ?? [];
    const { flashMovie } = useMovieHighlight();

    const scheduleFlash = (movieId, delay) => {
        clearTimeout(pendingFlash);
        pendingFlash = setTimeout(() => flashMovie(movieId), delay);
    };

    // Attend que l'élément soit monté (après bascule d'année), puis scrolle.
    //
    // `highlightId` : le film à marquer à l'arrivée, ou null. Un identifiant et pas un booléen — la
    // marque vit dans l'état partagé, pas sur l'élément qu'on tient ici.
    const scrollToSelector = (selector, { block = 'center', highlightId = null } = {}) => {
        let tries = 0;
        const attempt = () => {
            const el = document.querySelector(selector);
            if (el) setTimeout(() => {
                // Lu avant le scroll : c'est la position de départ qui dit s'il y aura un trajet.
                const settled = isFullyVisible(el.getBoundingClientRect(), window.innerHeight, FLASH_CLEARANCE);
                el.scrollIntoView({ behavior: 'smooth', block });
                if (highlightId !== null) scheduleFlash(highlightId, settled ? 0 : FLASH_DELAY);
            }, 120);
            else if (tries++ < 30) setTimeout(attempt, 80);
        };
        attempt();
    };

    // `Number(movieId)` : la valeur part dans un sélecteur CSS, où un identifiant non numérique ferait
    // lever `querySelector` — donc mourir la boucle de retry, sans message. `NaN` ne matche rien.
    const scrollToMovie = (movieId, { highlight = false } = {}) => {
        const id = Number(movieId);
        scrollToSelector(`.-id-${id}`, { highlightId: highlight ? id : null });
    };

    const scrollToTop = () => document.querySelector('.timeline')?.scrollTo({ top: 0 });

    const closestMovie = () => closestToToday(list());

    const searchMovie = (term) => bestSearchMatch(list(), term);

    return { closestMovie, searchMovie, scrollToMovie, scrollToTop }
}
