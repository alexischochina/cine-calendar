// Lecture d'une date `YYYY-MM-DD` **en heure locale**.
//
// ⚠️ `new Date('2026-08-17')` est interprété en **UTC** par la spec : sur un fuseau à offset négatif,
// la `Date` retombe la veille et un événement du 17 s'affiche « 16 août ». Le pattern était déjà banni
// ailleurs, mais trois copies l'avaient réintroduit.
//
// `parseYMD` de `useYearStats.js` n'est pas la même fonction malgré son nom (elle rend `{ year, month }`
// pour du regroupement) — d'où un nom distinct plutôt qu'une fusion forcée.

// `YYYY-MM-DD` → `Date` locale à minuit, ou `null` si la chaîne n'est pas une date.
export const parseLocalDate = (value) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
};

// Écart en jours pleins entre deux `YYYY-MM-DD`. Passe par des `Date` locales à minuit, donc
// insensible aux changements d'heure (qui décaleraient un calcul fait sur des millisecondes brutes).
export const daysBetween = (from, to) => {
    const [a, b] = [parseLocalDate(from), parseLocalDate(to)];
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
};
