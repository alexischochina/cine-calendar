// Bande de cartes scrollable horizontalement. Le scroll reste natif (molette, trackpad,
// drag) ; ce composable n'ajoute que le pilotage par flèches et l'état des bornes.
//
//   const { stripEl, atStart, atEnd, nudge, updateEdges } = useHorizontalStrip(() => items.length)
//   <div ref="stripEl" class="strip" @scroll.passive="updateEdges">…</div>
export function useHorizontalStrip(count, { cellSelector = '.cell', step = 3 } = {}) {
    const stripEl = ref(null);
    const atStart = ref(true);
    const atEnd = ref(true);

    // Les trois lectures forcent un recalcul de layout, et l'événement scroll peut tirer à
    // chaque frame : on les coalesce à une mesure par frame.
    let frame = null;
    const measure = () => {
        frame = null;
        const el = stripEl.value;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        atStart.value = el.scrollLeft <= 1;
        atEnd.value = max <= 1 || el.scrollLeft >= max - 1;
    };
    const updateEdges = () => {
        if (frame === null) frame = requestAnimationFrame(measure);
    };

    // dir = -1 (gauche) | 1 (droite). Le gap est lu sur l'élément pour ne pas dupliquer ici
    // la valeur du mixin `stripScroll`.
    const nudge = (dir) => {
        const el = stripEl.value;
        if (!el) return;
        const cell = el.querySelector(cellSelector);
        const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
        const amount = cell ? (cell.offsetWidth + gap) * step : el.clientWidth;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollBy({ left: dir * amount, behavior: reduced ? 'auto' : 'smooth' });
    };

    onMounted(() => {
        measure();
        window.addEventListener('resize', updateEdges, { passive: true });
    });
    onBeforeUnmount(() => {
        window.removeEventListener('resize', updateEdges);
        if (frame !== null) cancelAnimationFrame(frame);
    });
    watch(count, () => nextTick(measure));

    return { stripEl, atStart, atEnd, nudge, updateEdges };
}
