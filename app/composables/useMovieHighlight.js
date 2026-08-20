// La ligne d'arrivée d'une recherche : sa marque visuelle (deux pulsations) et son équivalent parlé.
//
// ⚠️ L'état vit dans un `useState` partagé, **jamais** dans une classe posée à la main sur le DOM :
// `MovieListItem` lie son `class` à ses props et `useInTheatersSync` écrit `state` de l'extérieur, donc
// une classe ajoutée hors de Vue serait effacée au premier patch d'attribut.
//
// La **durée** n'existe qu'en CSS (`MovieListItem`, `&.-flash`) : la ligne retire la marque elle-même
// à la fin de l'animation (`@animationend.self`), pas de `setTimeout` à garder en phase avec elle.
export function useMovieHighlight() {
    const highlightedMovieId = useState('highlightedMovieId', () => null)
    // Texte de la région `role="status"` du layout : la marque est une couleur, elle ne dit rien à un
    // lecteur d'écran.
    const highlightMessage = useState('highlightMessage', () => '')

    // Deux frames, pas une : un seul `requestAnimationFrame` s'exécute avant le recalcul de style de la
    // frame en cours, donc la classe serait retirée puis remise sans qu'aucun style intermédiaire soit
    // calculé — rien ne redémarrerait. Même `nextFrame` que `<Transition>` de Vue, pour la même raison.
    const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    // Rejouable : chercher deux fois de suite le même titre doit reclignoter.
    const flashMovie = async (movieId) => {
        const id = Number(movieId)
        if (!Number.isFinite(id)) return
        if (highlightedMovieId.value !== null) {
            highlightedMovieId.value = null
            await nextFrame()
        }
        highlightedMovieId.value = id
    }

    // Appelé par la ligne à la fin de son animation. Comparaison ciblée : sans elle, une ligne qui
    // termine effacerait la marque d'une autre, posée entre-temps.
    const clearMovieFlash = (movieId) => {
        if (highlightedMovieId.value === Number(movieId)) highlightedMovieId.value = null
    }

    // Changer d'année pendant l'animation démonte la ligne avant son `animationend` (il part un
    // `animationcancel`) : sans ce balai l'état resterait posé, et revenir sur l'année ferait reclignoter
    // la ligne sans que personne n'ait rien demandé.
    const clearHighlight = () => { highlightedMovieId.value = null }

    // Passage par '' avant le texte : une région live n'annonce que ce qui **change**, donc chercher
    // deux fois le même titre resterait muet la seconde fois.
    const announceMovie = async (message) => {
        highlightMessage.value = ''
        await nextTick()
        highlightMessage.value = message
    }

    return { highlightedMovieId, highlightMessage, flashMovie, clearMovieFlash, clearHighlight, announceMovie }
}
