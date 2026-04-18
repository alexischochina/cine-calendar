export function useMovieScroll() {
    const scrollToClosestDate = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attempt = () => {
            const dayEls = [...document.querySelectorAll('[data-date]')];
            if (!dayEls.length) { setTimeout(attempt, 100); return; }

            let target = null;
            let closestDiff = Infinity;

            for (const el of dayEls) {
                const date = new Date(el.dataset.date);
                date.setHours(0, 0, 0, 0);
                const diff = today - date;
                if (diff >= 0 && diff < closestDiff) {
                    closestDiff = diff;
                    target = el;
                }
            }

            if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
        };

        attempt();
    }

    const scrollToMovie = (movieId) => {
        const attempt = () => {
            const el = document.querySelector(`.-id-${movieId}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else setTimeout(attempt, 100);
        };
        attempt();
    }

    const handleScrollToYear = (event) => {
        const year = event.detail?.year;
        if (!year) return;
        document.querySelector(`[data-year="${year}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const handleSearchMovie = (event) => {
        const term = event.detail?.term?.toLowerCase();
        if (!term) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const matches = [...document.querySelectorAll('.movie-link')]
            .filter(el => el.textContent.trim().toLowerCase().includes(term))
            .map(el => {
                const dayEl = el.closest('[data-date]');
                return { el, date: dayEl ? new Date(dayEl.dataset.date) : null };
            })
            .filter(m => m.date);

        if (!matches.length) return;

        matches.sort((a, b) => {
            const aFuture = a.date >= today;
            const bFuture = b.date >= today;
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            if (aFuture && bFuture) return a.date - b.date;
            return b.date - a.date;
        });

        matches[0].el.closest('[data-date]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return { scrollToClosestDate, scrollToMovie, handleScrollToYear, handleSearchMovie }
}
