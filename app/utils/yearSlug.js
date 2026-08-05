// Mapping URL ↔ état : année « Sans date » = null en interne, slug `undated` en URL.
export const UNDATED_SLUG = 'undated';

// `undated` → null, `"2024"` → 2024, sinon undefined (invalide).
export function parseYearParam(param) {
    if (param === UNDATED_SLUG) return null;
    if (typeof param === 'string' && /^\d{4}$/.test(param)) return Number(param);
    return undefined;
}

export function yearToSlug(year) {
    return year === null ? UNDATED_SLUG : String(year);
}
