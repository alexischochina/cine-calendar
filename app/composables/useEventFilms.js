// Les films de la liste qui ont une séance particulière devant eux, dérivés de `movies` seul
// (colonne `events`) : aucun réseau, aucune dépendance vers la chaîne de relevé.
//
// Extrait de `useEvents`, qui reste son seul autre appelant : le rail gauche ne veut qu'un compteur,
// et passer par `useEvents` lui faisait monter cinq composables de relevé sur *toutes* les pages.

export function useEventFilms() {
    const { movies, eventBounds } = useMovieCalendar();

    // ⚠️ Entrées rendues **brutes**, au grain (journée, salle), et non regroupées par journée : le
    // texte libre de l'exploitant est attaché à une salle précise, et fusionner la journée oblige à
    // n'en garder qu'un (cf. `groupEventsByDay`) — une avant-première dans trois UGC affichait alors
    // la précision de l'un des trois sur la ligne des trois. La page groupe ce qu'elle veut, elle ne
    // peut pas dégrouper ce qu'on lui a fondu.
    //
    // Un film y figure qu'il soit à l'affiche ou non : une avant-première a lieu *avant* la sortie.
    const films = computed(() => {
        const bounds = eventBounds();
        return movies.value
            .filter(m => hasUpcomingEvent(m, bounds))
            .map(m => ({ movie: m, entries: movieEvents(m, bounds) }))
            .sort((a, b) =>
                String(a.entries[0]?.date).localeCompare(String(b.entries[0]?.date))
                || String(a.movie.title).localeCompare(String(b.movie.title)));
    });

    const nbEvents = computed(() =>
        films.value.reduce((n, f) => n + f.entries.length, 0)
    );

    return { films, nbEvents };
}
