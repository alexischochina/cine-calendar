// Séances événement — règles pures, des deux côtés du même sujet :
//   - côté **séance** : la vue Séances marque les horaires événement et les compte par carte ;
//   - côté **film**   : le rail « Au ciné en ce moment » ouvre une rubrique « Événements à venir ».
//
// Les libellés ne sont pas fabriqués ici. Ils viennent d'Allociné, traduits **une seule fois** côté
// serveur (`showtimeEventLabels` dans `server/utils/allocine.js`) et transportés dans le payload de
// séances. Ce fichier ne connaît aucun tag : il lit du texte déjà prêt, et le lit avec méfiance.
//
// Fonctions pures, sans réactivité ni réseau, testées par `scripts/test-seances-rules.mjs`.

// --- Côté séance --------------------------------------------------------------------------------

// Lecture tolérante : `showtimes_cache` contient encore des payloads écrits avant cette
// fonctionnalité. Un `events` absent se lit comme vide et se corrige à la première expiration — le
// risque est de taire un événement, jamais d'en inventer un.
export const showtimeEvents = (showtime) => Array.isArray(showtime?.events) ? showtime.events : [];

export const isEventShowtime = (showtime) => showtimeEvents(showtime).length > 0;

// Nombre de séances événement dans un lot d'entrées (film, salle). On compte les **séances** et non
// les libellés : une séance à deux labels reste une séance, et c'est ce chiffre qu'annonce la carte.
export const countEvents = (entries) =>
    entries.reduce((n, entry) => n + entry.showtimes.filter(isEventShowtime).length, 0);

// Libellés distincts d'un lot de séances, dans l'ordre de première rencontre.
export const eventLabelsOf = (showtimes) => [...new Set(showtimes.flatMap(showtimeEvents))];

// « 1 ÉVÉNEMENT » / « 3 ÉVÉNEMENTS ». Le pluriel s'écrit sur le S final, majuscules comprises.
export const eventCountLabel = (n) => `${n} ÉVÉNEMENT${n > 1 ? 'S' : ''}`;

// --- Jointure de la seconde passe ---------------------------------------------------------------

// Greffe les libellés d'événement sur un payload de séances, **séance par séance**.
//
// `events` : `{ internalId: [libellés] }` · `seen` : les `internalId` réellement observés, événement
// ou pas · `previews` : ceux qui sont des avant-premières.
//
// ⚠️ L'invariant, asymétrique à dessein : on ne réécrit **que** les séances vues. L'endpoint par salle
// est creux, donc une séance absente n'est pas une séance sans événement, c'est une séance dont on ne
// sait rien. Une séance vue est réécrite sans condition, y compris en vide, pour qu'un événement
// déprogrammé disparaisse. Mesures et conséquences : README, « Séances événement ».
//
// `previews` voyage à part parce que c'est la seule qualification qui **décide** quelque chose en aval
// (`isCardEligible`) : un booléen se teste, un texte d'interface se reformule.
export const graftEvents = (payload, { events = {}, seen, previews = new Set() }) => ({
    ...payload,
    theaters: (payload?.theaters ?? []).map(theater => ({
        ...theater,
        showtimes: (theater.showtimes ?? []).map(showtime => seen.has(showtime.internalId)
            ? {
                ...showtime,
                events: events[showtime.internalId] ?? [],
                // `||` et non un remplacement sec : si la source finit par livrer `isPreview` sur
                // l'endpoint film, son verdict ne doit pas être effacé par une passe salle plus pauvre.
                isPreview: showtime.isPreview === true || previews.has(showtime.internalId),
            }
            : showtime),
    })),
});

// --- Côté film : les événements datés portés par la ligne `calendar` -----------------------------
//
// Une entrée = un couple (jour, salle). C'est la granularité que le rail affiche et la seule qui
// permette de trier par imminence — « un événement cette semaine » ne dit pas s'il faut y aller ce
// soir ou samedi.

// Entrées d'un film pour **une** journée. Plusieurs séances événement dans la même salle le même jour
// donnent une seule entrée, libellés fusionnés.
export const dayEventEntries = (payload, date) => {
    const out = [];
    for (const theater of payload?.theaters ?? []) {
        const showtimes = theater.showtimes ?? [];
        const labels = eventLabelsOf(showtimes);
        if (labels.length) out.push({ date, cinema: theater.name ?? null, labels, bookings: bookingsOf(showtimes) });
    }
    return out;
};

// URL de billetterie, dédoublonnées et bornées à 4 (la liste finit dans une URL de requête). Elles
// voyagent avec l'entrée parce qu'UGC s'y rapproche par identifiant de séance — la jointure la plus
// sûre du lot (cf. `server/utils/ugc.js`).
export const bookingsOf = (showtimes) =>
    [...new Set(showtimes.map(s => s?.booking).filter(Boolean))].slice(0, 4);

// Identité d'une entrée : un couple (journée, salle). Exportée parce que `useSeanceEvents` s'en sert
// aussi pour retrouver le libellé déjà connu d'une entrée — deux définitions de la même clé, dans deux
// fichiers qui collaborent, auraient divergé sans que rien ne le signale.
export const entryKey = (entry) => `${entry.date}|${entry.cinema ?? ''}`;

// Fusionne les entrées connues et celles qu'on vient de trouver, en **élaguant le passé**. On fusionne
// plutôt qu'on ne remplace parce que chaque passage ne voit qu'une poignée de journées : remplacer
// ferait clignoter la rubrique au rythme de la navigation. L'élagage par la date rend l'accumulation
// sûre — une avant-première jouée hier sort d'elle-même.
//
// `dates` : les journées que l'appelant vient de **lire**, donc les seules dont on remplace les
// entrées. Ailleurs on n'a rien vu, on ne défait rien.
export const mergeEventEntries = (known, found, { dates, today }) => {
    const reread = new Set(dates);
    const merged = new Map();

    for (const entry of known ?? []) {
        if (!entry?.date || entry.date < today) continue;
        if (reread.has(entry.date)) continue;
        merged.set(entryKey(entry), entry);
    }
    for (const entry of found ?? []) {
        if (!entry?.date || entry.date < today) continue;
        merged.set(entryKey(entry), entry);
    }

    return [...merged.values()].sort((a, b) =>
        a.date.localeCompare(b.date) || String(a.cinema).localeCompare(String(b.cinema)));
};

// Événements retenus pour une ligne `calendar`. Deux gardes distinctes : `today` élague les événements
// **passés** (une avant-première jouée envoie à une séance qui n'existe plus), `freshSince` élague les
// **relevés** périmés (des entrées d'avant le renouvellement des grilles ne disent plus rien, même
// datées du futur). Paramètres et non appels internes, pour que la fonction reste testable.
export const movieEvents = (movie, { freshSince, today }) => {
    const entries = movie?.events;
    if (!Array.isArray(entries) || !entries.length) return [];

    const checkedAt = Date.parse(movie?.events_checked_at ?? '');
    if (!Number.isFinite(checkedAt) || checkedAt < freshSince) return [];

    return entries
        .filter(e => e?.date && e.date >= today && Array.isArray(e.labels) && e.labels.length)
        .sort((a, b) => a.date.localeCompare(b.date));
};

export const nextMovieEvent = (movie, bounds) => movieEvents(movie, bounds)[0] ?? null;

// Empreinte comparable de deux lots d'entrées, pour décider s'il y a lieu d'écrire.
//
// ⚠️ Structurelle et pas un `JSON.stringify` : celui-ci dépend de l'ordre des clés, que rien ne
// garantit — les entrées viennent de trois chemins différents, et l'app réécrirait la colonne à chaque
// chargement sans que rien ne le montre.
//
// ⚠️⚠️ `bookings` en fait partie. Cette empreinte sert aussi de **clé de regroupement** des écritures
// (`update … in (ids)`), donc deux lots confondus reçoivent le même patch. Sans les bookings, deux
// avant-premières le même soir dans la même salle se déclaraient identiques et le second film héritait
// des URL du premier — puis, par la jointure UGC sur numéro de séance, du **libellé** du premier. Le
// coût de la correction est une écriture de plus quand seules les URL ont bougé : bon échange.
export const entriesKey = (entries) => (entries ?? [])
    .map(e => [
        e.date,
        e.cinema ?? '',
        [...(e.labels ?? [])].sort().join(','),
        e.detail ?? '',
        [...(e.bookings ?? [])].sort().join(','),
    ].join('|'))
    .sort()
    .join('\n');

// --- Ce qui va dans la pastille ------------------------------------------------------------------
//
// Le vocabulaire d'Allociné est fermé : affiché tel quel, il donne une page où toutes les pastilles
// disent « Avant-première » — vrai, et inutile. Le particulier vient de l'exploitant (`detail`), sous
// deux formes : un **libellé** (« Avant-première avec équipe »), qui remplace le mot d'Allociné dans la
// pastille, ou une **phrase**, qui reste en toutes lettres dessous. Cette fonction tranche entre les
// deux et dédoublonne.

// Au-delà, ce n'est plus un libellé mais une description : elle irait à la ligne dans la pastille et
// pousserait tout le reste hors de l'écran.
const CHIP_MAX = 48;

// Forme de comparaison : accents dépliés, casse et ponctuation neutralisées. Sans ça
// « Avant-Première » et « avant premiere » se déclareraient différents et la pastille se dédoublerait.
const fold = (value) => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// `{ chips, note }` pour une entrée `{ labels, detail, url }`.
//
// `chips` : `{ text, url }` — l'URL n'est portée que par une pastille venue de l'exploitant, qui est
// alors un lien vers la fiche de la salle. Les libellés d'Allociné ne mènent nulle part.
// `note`  : la phrase de l'exploitant, ou `null` si elle est déjà dans une pastille.
export const eventChips = ({ labels = [], detail = null, url = null } = {}) => {
    const raw = String(detail ?? '').trim();
    // Le point final se retire avant l'arbitrage : « Avant-première. » est un libellé ponctué, pas une
    // phrase. Un point **suivi d'autre chose**, lui, prouve qu'on a bien un texte rédigé.
    const text = raw.replace(/\s*[.!?…]+$/, '').trim();
    const multiSentence = /[.!?]\s/.test(raw);
    const truncated = /…$/.test(raw);

    const promoted = Boolean(text) && !multiSentence && !truncated && text.length <= CHIP_MAX;
    if (!promoted) {
        return { chips: labels.map(text => ({ text, url: null })), note: raw ? { text: raw, url } : null };
    }

    // Le libellé d'Allociné disparaît quand la pastille promue le contient déjà : « Avant-première
    // avec équipe » **est** l'avant-première, l'afficher deux fois ne dit rien de plus.
    const folded = fold(text);
    const kept = labels.filter(label => !folded.includes(fold(label)));

    return { chips: [{ text, url }, ...kept.map(text => ({ text, url: null }))], note: null };
};

// Valeurs sur lesquelles une entrée est **filtrable**, dans la vue Événements.
//
// ⚠️ Dérivée de `eventChips` : une pastille affichée sans filtre correspondant est une incohérence que
// rien ne signale. Une seule fonction décide ce qui s'affiche, les filtres en découlent.
//
// L'union et non les seules pastilles : quand le mot de l'exploitant absorbe celui d'Allociné, la
// **famille** doit rester filtrable. La phrase rédigée (`note`) en est exclue — elle décrit une séance
// au lieu de la qualifier, et ferait autant de filtres que de séances.
//
// Dédoublonnage sur `fold` : « Avant-première » et « AVANT PREMIERE » sont le même type. La première
// forme gagne, donc celle d'Allociné, proprement accentuée.
export const entryKinds = (entry) => {
    const seen = new Set();
    const out = [];

    for (const text of [...(entry?.labels ?? []), ...eventChips(entry).chips.map(chip => chip.text)]) {
        const key = fold(text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
    }
    return out;
};

// Regroupe les entrées par **journée**, pour l'affichage : un film a souvent plusieurs
// avant-premières, et plusieurs salles le même soir. « dim. 16 août — Avant-première · UGC Maillot,
// UGC Gobelins » se lit d'un coup d'œil là où trois lignes séparées pour le même jour se répètent.
//
// Les libellés d'une journée sont fusionnés et dédoublonnés ; les salles gardent l'ordre alphabétique
// que `mergeEventEntries` leur a donné. `detail` / `url` remontent tels quels — c'est la précision de
// l'exploitant (« en présence du réalisateur »), que le vocabulaire d'Allociné ne peut pas donner.
export const groupEventsByDay = (entries) => {
    const byDay = new Map();

    for (const entry of entries) {
        if (!byDay.has(entry.date)) byDay.set(entry.date, { date: entry.date, labels: [], cinemas: [] });
        const day = byDay.get(entry.date);
        for (const label of entry.labels) if (!day.labels.includes(label)) day.labels.push(label);
        if (entry.cinema && !day.cinemas.includes(entry.cinema)) day.cinemas.push(entry.cinema);

        // Texte libre de l'exploitant, quand une des entrées du jour en porte un. Le premier gagne : il
        // n'y en a qu'un en pratique (une avant-première n'a lieu que dans une salle), et deux phrases
        // concaténées seraient illisibles.
        if (entry.detail && !day.detail) {
            day.detail = entry.detail;
            day.url = entry.url ?? null;
        }
    }

    return [...byDay.values()];
};

// Rubrique « Événements à venir » : la règle nue de `shared/utils/seanceScope.js`, **plus** la garde
// de fraîcheur du relevé qu'applique `movieEvents`. C'est cette garde, et elle seule, qui sépare le
// périmètre de la vue de celui du préchauffage.
export const hasUpcomingEvent = (movie, bounds) =>
    hasDatedEventFrom(movie, bounds.today) && movieEvents(movie, bounds).length > 0;
