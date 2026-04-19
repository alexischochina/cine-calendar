export function useMovieScroll() {
    const dispatchExpandYear = (el) => {
        const yearContainer = el?.closest('[data-year]');
        if (yearContainer) {
            window.dispatchEvent(new CustomEvent('expand-year', {
                detail: { year: Number(yearContainer.dataset.year) }
            }));
        }
    };

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

            if (target) {
                dispatchExpandYear(target);
                setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
            }
        };

        attempt();
    }

    const scrollToMovie = (movieId) => {
        const attempt = () => {
            const el = document.querySelector(`.-id-${movieId}`);
            if (el) {
                dispatchExpandYear(el);
                setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
            }
            else setTimeout(attempt, 100);
        };
        attempt();
    }

    const handleScrollToYear = (event) => {
        const year = event.detail?.year;
        if (!year) return;
        window.dispatchEvent(new CustomEvent('expand-year', { detail: { year: Number(year) } }));
        setTimeout(() => {
            document.querySelector(`[data-year="${year}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
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

        const targetDayEl = matches[0].el.closest('[data-date]');
        if (targetDayEl) {
            dispatchExpandYear(targetDayEl);
            setTimeout(() => targetDayEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
        }
    }

    return { scrollToClosestDate, scrollToMovie, handleScrollToYear, handleSearchMovie }
}
