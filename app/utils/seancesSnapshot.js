// Instantané persistant du cache de séances — la règle pure, testée par
// `scripts/test-seances-rules.mjs`. Le branchement (lecture, écriture, quota) vit dans
// `useShowtimes`.
//
// Le L1 est un `useState`, donc une mémoire de **visite** : un F5 ou un retour depuis Timeline et la
// page repartait d'un écran vide. Cet instantané garde le dernier état connu dans `localStorage` pour
// l'afficher pendant que la vraie donnée se recharge.
//
// ⚠️ **Un instantané ne décide de rien.** Tout ce qui écrit en base ou sort sur le réseau lit le L1 via
// `livePayloadFor` — sans quoi une donnée d'hier servirait de preuve pour écrire aujourd'hui.

// Le suffixe de version est ce qui permet de changer la forme des payloads sans traîner un instantané
// illisible : on incrémente, les anciennes clés deviennent orphelines et le navigateur les oublie.
export const SNAPSHOT_KEY = 'seances:snapshot:v1';

// ~7 journées × une vingtaine de films. La place ne manque pas (~5 Mo disponibles, ~80 Ko par
// journée) : c'est un garde-fou de dernier recours, le filtre de périmètre de `useShowtimes` faisant
// déjà le gros du tri.
export const SNAPSHOT_MAX_ENTRIES = 160;

const KEY_RE = /^(\d+):(\d{4}-\d{2}-\d{2})$/;

// Élague un instantané. Trois motifs de rejet :
//
//   - **journée passée** : elle ne sera plus affichée, et la garder ferait parler la page d'hier ;
//   - **relevé d'avant le dernier mercredi** : les salles ont renouvelé leur programmation depuis ;
//   - **clé illisible ou payload sans horodatage** : un instantané sans âge est pire qu'une absence
//     d'instantané, la ligne de provenance ne pouvant plus dire d'où il sort.
//
// Le plafond garde les journées les plus proches et, à date égale, les relevés les plus récents.
export const pruneSnapshot = (entries, { today, freshSince, max = SNAPSHOT_MAX_ENTRIES } = {}) => {
    const kept = [];

    for (const [key, payload] of Object.entries(entries ?? {})) {
        const match = KEY_RE.exec(key);
        if (!match) continue;

        const date = match[2];
        if (date < today) continue;

        const written = Date.parse(payload?.fetchedAt ?? '');
        if (!Number.isFinite(written) || written < freshSince) continue;

        kept.push([key, payload, date, written]);
    }

    kept.sort((a, b) => a[2].localeCompare(b[2]) || b[3] - a[3]);

    return Object.fromEntries(kept.slice(0, max).map(([key, payload]) => [key, payload]));
};

// Horodatage d'affichage, à lire derrière le mot « relevé ». Rend **toujours** sa préposition
// (« à 21:34 », « hier à 21:34 », « le 15/08 à 21:34 »), les trois formes n'ayant pas la même.
//
// ⚠️ Pas un `HH:MM` nu : la page s'ouvrant sur le relevé de la visite précédente, il se lirait
// « il y a un instant » au moment précis où l'utilisateur doit savoir que ça date.
export const stampForDisplay = (iso, now = new Date()) => {
    const d = new Date(iso);
    if (isNaN(d)) return null;

    const deuxChiffres = (n) => String(n).padStart(2, '0');
    const hhmm = `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
    const jour = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;

    if (jour(d) === jour(now)) return `à ${hhmm}`;

    const hier = new Date(now);
    hier.setDate(hier.getDate() - 1);
    if (jour(d) === jour(hier)) return `hier à ${hhmm}`;

    return `le ${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)} à ${hhmm}`;
};
