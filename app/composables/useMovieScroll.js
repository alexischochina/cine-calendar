// Navigation/scroll dans le calendrier. Data-driven : depuis le passage des années
// repliées en `v-if` (montage paresseux), les items d'une année repliée ne sont pas
// dans le DOM. On déduit donc l'année cible depuis les données `movies`, on déplie
// (event `expand-year`), puis on scrolle une fois l'item monté.
export function useMovieScroll(moviesRef) {
    const list = () => moviesRef?.value ?? [];

    const yearOf = (dateStr) => {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        return isNaN(d) ? null : d.getFullYear();
    };

    const expandYear = (year) => {
        if (year) window.dispatchEvent(new CustomEvent('expand-year', { detail: { year: Number(year) } }));
    };

    // Attend que l'élément (potentiellement monté après dépliage) apparaisse, puis scrolle.
    const scrollToSelector = (selector, block = 'center') => {
        let tries = 0;
        const attempt = () => {
            const el = document.querySelector(selector);
            if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block }), 150);
            else if (tries++ < 30) setTimeout(attempt, 100);
        };
        attempt();
    };

    const scrollToClosestDate = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dated = list().filter(m => m.release_date && !isNaN(new Date(m.release_date)));
        if (!dated.length) return;

        let target = null;
        let closestDiff = Infinity;
        for (const m of dated) {
            const date = new Date(m.release_date);
            date.setHours(0, 0, 0, 0);
            const diff = today - date;
            if (diff >= 0 && diff < closestDiff) { closestDiff = diff; target = m; }
        }
        // Aucune date passée → prendre la sortie future la plus proche.
        if (!target) {
            target = dated.reduce((a, b) => new Date(a.release_date) <= new Date(b.release_date) ? a : b);
        }

        expandYear(yearOf(target.release_date));
        scrollToSelector(`.-id-${target.movie_id}`);
    };

    const scrollToMovie = (movieId) => {
        const movie = list().find(m => m.movie_id === Number(movieId));
        expandYear(movie ? yearOf(movie.release_date) : null);
        scrollToSelector(`.-id-${movieId}`);
    };

    const handleScrollToYear = (event) => {
        const year = event.detail?.year;
        if (!year) return;
        expandYear(year);
        // Le header d'année (`[data-year]`) est toujours rendu, même repliée.
        scrollToSelector(`[data-year="${year}"]`, 'start');
    };

    const handleSearchMovie = (event) => {
        const term = event.detail?.term?.toLowerCase();
        if (!term) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const matches = list()
            .filter(m => m.title && m.title.toLowerCase().includes(term) && m.release_date && !isNaN(new Date(m.release_date)))
            .map(m => ({ movie: m, date: new Date(m.release_date) }));

        if (!matches.length) return;

        matches.sort((a, b) => {
            const aFuture = a.date >= today;
            const bFuture = b.date >= today;
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            if (aFuture && bFuture) return a.date - b.date;
            return b.date - a.date;
        });

        const best = matches[0].movie;
        expandYear(yearOf(best.release_date));
        scrollToSelector(`.-id-${best.movie_id}`);
    };

    return { scrollToClosestDate, scrollToMovie, handleScrollToYear, handleSearchMovie }
}
