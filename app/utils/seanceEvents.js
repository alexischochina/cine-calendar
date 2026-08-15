// Séances événement — règles pures, des deux côtés du même sujet :
//   - côté **séance** : la vue Séances marque les horaires événement et les compte par carte ;
//   - côté **film**   : le rail « Au ciné en ce moment » ouvre une rubrique « Événement à venir ».
//
// Les libellés ne sont pas fabriqués ici. Ils viennent d'Allociné, traduits **une seule fois** côté
// serveur (`showtimeEventLabels` dans `server/utils/allocine.js`) et transportés dans le payload de
// séances. Ce fichier ne connaît aucun tag : il lit du texte déjà prêt, et le lit avec méfiance.
//
// Fonctions pures, sans réactivité ni réseau, testées par `scripts/test-seances-rules.mjs` — même
// discipline que `seancesGrouping.js`, qui les importe.

// --- Côté séance --------------------------------------------------------------------------------

// ⚠️ Lecture tolérante, et ce n'est pas de la coquetterie : `showtimes_cache` contient encore des
// payloads écrits avant cette fonctionnalité. Un `events` absent se rend comme un `events` vide
// (aucun marqueur) et l'entrée se corrige d'elle-même à sa première expiration. Le seul risque est
// donc de **taire** un événement pendant quelques heures, jamais d'en inventer un — le bon sens de
// l'erreur pour un badge qui, sinon, enverrait vers une séance qui n'existe pas.
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
// `events`   : `{ internalId: [libellés] }` — les séances événement rapportées par la passe salle.
// `seen`     : `Set` des `internalId` que cette passe a réellement observés, événement ou pas.
// `previews` : `Set` des `internalId` qui sont des avant-premières.
//
// Pourquoi `previews` en plus des libellés : c'est la seule qualification qui **décide** quelque chose
// en aval (la carte UGC ne couvre pas les avant-premières, cf. `isCardEligible`). Elle voyage donc en
// booléen, sur le champ `isPreview` que la source aurait rempli si son endpoint film le sélectionnait.
// Faire trancher `isCardEligible` sur la chaîne « Avant-première » aurait adossé une règle métier à un
// texte d'interface — qui se reformule, et casse la règle sans que rien ne le dise.
//
// ⚠️ `seen` est le cœur de la fonction, pas un garde-fou décoratif. L'endpoint par salle est **creux**
// (`theater-C0159` rendait 1 jour sur 7 là où l'endpoint film en rendait 6 — mesuré le 13/08/2026, cf.
// `README-seances.md`). Une séance absente de sa réponse n'est donc pas une séance sans événement :
// c'est une séance dont on ne sait rien. La marquer « sans événement » serait le même faux positif que
// celui qui avait fait déclarer Les Halles muette par `check-seances.mjs`.
//
// D'où la règle, et elle est asymétrique à dessein :
//   - séance **vue** → réécrite sans condition, y compris en vide. C'est ce qui permet à un événement
//     retiré de la programmation de disparaître, et à une entrée de cache écrite avant cette
//     fonctionnalité de se corriger d'elle-même.
//   - séance **non vue** → on n'y touche pas. Elle garde ce qu'elle avait : `[]` si rien ne l'a jamais
//     qualifiée, ou le libellé greffé plus tôt dans la visite. La réécrire en vide ferait disparaître
//     un marqueur déjà affiché, ce qui se lirait comme « l'avant-première a été annulée » — une
//     information qu'on n'a pas.
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
// Une entrée = `{ date, cinema, labels }`, un couple (jour, salle). C'est la granularité que le rail
// affiche — « lun. 17 août · MK2 Bibliothèque · Avant-première » — et la seule qui permette de trier
// par imminence. Un simple tableau de libellés ne l'aurait pas permis : « il y a un événement cette
// semaine » ne dit pas s'il faut y aller ce soir ou samedi.

// Entrées d'événement lues dans le payload d'un film pour **une** journée. Une salle qui a plusieurs
// séances événement le même jour donne une seule entrée, libellés fusionnés : c'est la salle et le
// jour qu'on va noter dans son agenda, pas chaque horaire.
export const dayEventEntries = (payload, date) => {
    const out = [];
    for (const theater of payload?.theaters ?? []) {
        const showtimes = theater.showtimes ?? [];
        const labels = eventLabelsOf(showtimes);
        if (labels.length) out.push({ date, cinema: theater.name ?? null, labels, bookings: bookingsOf(showtimes) });
    }
    return out;
};

// URL de billetterie des séances, dédoublonnées et bornées. Elles voyagent avec l'entrée parce que
// **UGC s'y rapproche par identifiant de séance** (`reservationSeances.html?id=…`), là où Dulac et MK2
// passent par (titre, date, salle). C'est la jointure la plus sûre du lot, autant lui donner ce qu'il
// lui faut.
//
// Bornées à 4 : une entrée couvre un couple (jour, salle), donc une poignée de séances, et la liste
// finit dans une URL de requête.
export const bookingsOf = (showtimes) =>
    [...new Set(showtimes.map(s => s?.booking).filter(Boolean))].slice(0, 4);

const entryKey = (entry) => `${entry.date}|${entry.cinema ?? ''}`;

// Fusionne les entrées connues et celles qu'on vient de trouver, en **élaguant le passé**.
//
// Deux raisons de fusionner plutôt que remplacer. D'abord chaque passage ne voit qu'une poignée de
// journées (souvent une seule) : remplacer ferait clignoter la rubrique au rythme de la navigation.
// Ensuite l'élagage par la date rend l'accumulation sûre — une avant-première jouée hier sort d'
// elle-même, sans dépendre d'un horodatage. C'est plus juste que l'ancienne borne à la semaine ciné :
// un événement de mardi ne survit plus jusqu'au mercredi suivant.
//
// `dates` : les journées que l'appelant vient de **lire**. Les entrées connues qui tombent sur l'une
// d'elles sont remplacées par ce qu'on vient de voir (un événement déprogrammé disparaît donc) ; les
// autres sont conservées telles quelles, faute d'information fraîche à leur sujet.
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

// Événements retenus pour une ligne `calendar` : à venir, et pas trop vieux dans leur relevé.
//
// Deux gardes, qui ne disent pas la même chose :
//   - `today`      élague les événements **passés**. Une avant-première jouée mise en avant est pire
//                  qu'une rubrique vide : elle envoie à une séance qui n'existe plus.
//   - `freshSince` élague les **relevés** périmés. Des entrées écrites avant le renouvellement des
//                  grilles ne disent plus rien de la programmation, même si leurs dates sont futures.
//
// Les deux sont des paramètres et non des appels internes à `isoDay()` / `lastWednesday()` : la
// fonction reste pure, donc testable sans figer l'horloge.
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
// ⚠️ Explicitement structurelle, et pas un `JSON.stringify` du tableau : celui-ci dépend de **l'ordre
// des clés**, un invariant que rien n'écrit ni ne garantit. Les entrées viennent de trois chemins
// différents (relevé du jour, repli par les dates, relecture depuis la base après aller-retour JSON) —
// il suffirait qu'un seul construise ses objets dans un autre ordre pour que deux lots identiques se
// déclarent différents, et l'app réécrirait la colonne à chaque chargement sans que rien ne le montre.
export const entriesKey = (entries) => (entries ?? [])
    .map(e => [e.date, e.cinema ?? '', [...(e.labels ?? [])].sort().join(','), e.detail ?? ''].join('|'))
    .sort()
    .join('\n');

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

// Film à faire remonter dans la rubrique « Événement à venir » : un événement devant lui, et un film
// pas encore vu.
//
// La seconde condition n'est **pas** redondante ici, contrairement à ce qu'elle était quand la
// rubrique n'existait pas : elle couvre désormais des films qui ne sont pas `inTheaters` du tout (une
// avant-première a lieu *avant* la sortie — c'est le cas qui a motivé la rubrique). Rien ne garantit
// donc plus que l'état exclue `'seen'`.
export const hasUpcomingEvent = (movie, bounds) =>
    movie?.state !== 'seen' && movieEvents(movie, bounds).length > 0;
