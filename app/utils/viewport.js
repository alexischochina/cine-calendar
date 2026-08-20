// « Cet élément est-il déjà entièrement à l'écran ? » — règle pure, sortie ici pour être testable.
// Elle décide quand marquer la ligne d'arrivée d'une recherche (cf. `useMovieScroll`).
//
// `margin` : la bande où un élément est visible en coordonnées mais couvert en pratique (en-tête de
// mois `sticky`, nav flottante). Entrées absentes ou non finies → `false` : l'appelant retombe sur son
// délai, jamais sur une exception.
export const isFullyVisible = (rect, viewportHeight, margin = 0) => {
    if (!rect || !Number.isFinite(viewportHeight)) return false;
    const { top, bottom } = rect;
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return false;
    return top >= margin && bottom <= viewportHeight - margin;
};
