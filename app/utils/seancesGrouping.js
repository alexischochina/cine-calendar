// Règles de filtrage, de tri et de regroupement de la vue « Séances ».
//
// Extraites de `useSeances` pour deux raisons :
//   - ce sont des **fonctions pures** — mêmes entrées, mêmes sorties, aucune réactivité, aucun
//     accès réseau. Elles n'avaient rien à faire au milieu d'un composable qui gère de l'état, du
//     chargement et des effets ;
//   - elles portent les décisions métier les plus faciles à casser sans s'en rendre compte (le
//     filtre carte, l'ordre des salles). Ici, elles sont exécutables par un script de test
//     (`scripts/test-seances-rules.mjs`) sans monter Nuxt.
//
// Import explicite et non auto-import : ce fichier doit rester chargeable par le script de test, qui
// tourne hors de Nuxt. Même raison que `tmdbDates.js` côté serveur.
import { countEvents, isEventShowtime } from './seanceEvents.js';

// Séances qu'une carte UGC Illimité ne couvre pas, **dans la salle même où elle est acceptée**.
// Une seule constante, volontairement : ces exclusions sont amenées à s'enrichir à l'usage et
// éparpillées en conditions elles deviendraient introuvables.
//
// ⚠️ Limite assumée : la donnée Allociné ne décrit pas exhaustivement ce que la carte couvre. Le
// filtre est juste sur le gros (salle + avant-première + formats majorés), approximatif sur les
// cas exotiques (séances événement, festivals). Le lien billetterie reste l'arbitre final.
const CARD_EXCLUDED_FORMATS = [
    'IMAX',      // supplément systématique
    '4DX',       // idem
    'SCREENX',
    'ICE',       // Immersive Cinema Experience (CGR / Pathé)
    'DOLBY_CINEMA',
    'F_3D',      // majoration lunettes
];

// `isPreview` : les avant-premières sortent du cadre de la carte.
//
// ⚠️ Ce test était **inerte** jusqu'à la seconde passe par salle, et il ne l'est plus : l'endpoint que
// la production interroge ne sélectionne pas `isPreview` (cf. l'encadré « Deux endpoints, deux jeux de
// champs » dans `server/utils/allocine.js`), mais `graftEvents` le pose désormais à partir de ce que
// la passe salle a vu. C'est volontairement un **booléen** et non le libellé « Avant-première » qui
// arbitre ici : une règle métier adossée à un texte d'interface se casse au premier reformulage, et en
// silence.
//
// ⚠️ Conséquence à connaître, maintenant que le test mord : le pré-filtre carte étant actif par défaut,
// une avant-première est **masquée** à l'arrivée sur la page. C'est correct — la carte ne la couvre pas
// — et ce n'est pas silencieux : `hiddenEvents` la compte et la vue le dit en propres termes, avec sa
// porte de sortie. On ne bricolera pas ce filtre pour faire ressortir les événements, ce serait mentir
// sur ce que la carte paie.
export const isCardEligible = (showtime) => {
    if (showtime.isPreview) return false;
    return !(showtime.projection ?? []).some(format => CARD_EXCLUDED_FORMATS.includes(String(format).toUpperCase()));
};

// « 1er », « 6e ». Utilisé par les libellés de salle.
export const arrondissementLabel = (n) => n === 1 ? '1er' : `${n}e`;

// --- Plage horaire ------------------------------------------------------------------------------
//
// Le filtre qui remplace VO/VF et l'arrondissement : à Paris on ne choisit pas une séance par sa
// version ni par son arrondissement, on la choisit par l'heure à laquelle on est libre.
//
// Tout est compté en minutes depuis minuit — un entier se compare, s'interpole (le slider) et se
// teste sans se soucier des fuseaux, contrairement à une `Date`.

// Séances d'après minuit : Allociné les rattache au jour de la **soirée** (un « 00:20 » figure au
// mercredi, pas au jeudi). Comparées brutes, elles tomberaient dans le petit matin et sortiraient
// de « Soir » — alors que c'est bien le soir qu'on y va. On les projette donc au-delà de minuit :
// 00:20 → 1460. Le seuil est à 5 h : aucune salle parisienne ne programme entre 5 h et 8 h, une
// séance dans cette tranche est donc forcément une séance de nuit.
const NIGHT_UNTIL = 5 * 60;

export const DAY_END = 24 * 60;

export const minutesOfShowtime = (showtime) => {
    const parts = /^(\d{1,2}):(\d{2})/.exec(String(showtime?.time ?? ''));
    if (!parts) return null;

    const minutes = Number(parts[1]) * 60 + Number(parts[2]);
    return minutes < NIGHT_UNTIL ? minutes + DAY_END : minutes;
};

// « 14:00 », et « 24:00 » pour la borne de fin de journée (que `minutesOfShowtime` n'émet jamais,
// mais que le slider atteint).
export const timeLabel = (minutes) => {
    const h = Math.floor(minutes / 60);
    return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

export const rangeLabel = (range) => range ? `${timeLabel(range[0])} – ${timeLabel(range[1])}` : 'Toutes';

// Créneaux proposés dans le menu. `hint` est le libellé secondaire (« 8h – 12h »), affiché à côté de
// l'option pour que le découpage soit lisible sans l'avoir appris.
//
// ⚠️ « Matin » part de **minuit** et non de 8 h, alors que son libellé annonce 8 h. Les trois
// créneaux doivent partitionner la journée entière : avec une borne à 8 h, une séance à 07:30 ne
// tombait dans **aucun** créneau nommé et ne réapparaissait que sous « Toutes » — une disparition
// silencieuse, exactement ce que le reste de la vue s'interdit. Le libellé reste « 8h – 12h » : il
// décrit ce qu'on y trouve en pratique, la borne technique couvre ce qu'on n'a pas prévu.
export const TIME_SLOTS = [
    { value: 'all', label: 'Toutes', hint: null, range: null },
    { value: 'morning', label: 'Matin', hint: '8h – 12h', range: [0, 12 * 60] },
    { value: 'afternoon', label: 'Après-midi', hint: '12h – 18h', range: [12 * 60, 18 * 60] },
    { value: 'evening', label: 'Soir', hint: '18h – 00h', range: [18 * 60, DAY_END] },
];

// Bornes et pas du slider « Choisir plage… ». 8 h → minuit : avant 8 h il n'y a pas de séance, et
// laisser choisir 3 h du matin ne servirait qu'à produire des écrans vides.
export const RANGE_MIN = 8 * 60;
export const RANGE_MAX = DAY_END;
export const RANGE_STEP = 30;

// Une plage libre est la **seule** entrée de forme libre de la chaîne de filtres : elle survit en
// `useState` à travers la navigation, donc rien ne garantit au moment de l'appliquer qu'elle a
// encore la forme qu'on lui a donnée. Un `NaN` glissé dedans désactiverait le filtre en silence
// (toute comparaison devenant fausse), un couple inversé viderait la page sans explication. On la
// valide donc au seuil, une fois, plutôt que de faire confiance à chaque lecture.
export const sanitizeRange = (range) => {
    if (!Array.isArray(range) || range.length !== 2) return null;

    const [from, to] = range.map(Number);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

    const start = Math.max(0, Math.min(Math.round(from), DAY_END));
    const end = Math.max(0, Math.min(Math.round(to), DAY_END));
    return end > start ? [start, end] : null;
};

// Plage effective d'un choix de filtre. `custom` n'est lu que pour `slot === 'custom'` — un
// créneau nommé garde sa plage même si une plage libre a été choisie avant lui.
export const slotRange = (slot, custom = null) => {
    if (slot === 'custom') return sanitizeRange(custom);
    return TIME_SLOTS.find(s => s.value === slot)?.range ?? null;
};

// Borne basse incluse, borne haute exclue : 12:00 appartient à « Après-midi » et non au matin,
// sinon une séance de midi serait comptée deux fois selon le filtre choisi.
export const inTimeRange = (showtime, range) => {
    if (!range) return true;

    const minutes = minutesOfShowtime(showtime);
    // Horaire illisible : on garde. Écarter sur une donnée qu'on n'a pas su lire ferait disparaître
    // une séance qui existe — le contraire de ce que fait un filtre.
    if (minutes == null) return true;

    const [from, to] = range;
    // Une borne haute posée sur minuit se lit « jusqu'à la fin de la soirée » : les séances de nuit
    // (projetées au-delà de 1440) restent dedans, sinon « Soir » perdrait justement les plus
    // tardives, celles qu'on cherche quand on filtre le soir.
    return minutes >= from && (to >= DAY_END || minutes < to);
};

// Arrondissement de repli tant que `scripts/geocode-cinemas.mjs` n'est pas passé : le référentiel
// le tient de `properties.district` (fiable), mais le code postal suffit à faire tourner le filtre
// dès la première visite.
// ⚠️ Deux familles de codes postaux parisiens cohabitent : `750xx` (le cas courant) et `751xx`
// (75116 pour Passy, notamment). Ne reconnaître que la première faisait disparaître la salle du
// filtre par arrondissement.
export const arrondissementFromZip = (zip) => {
    const match = /^75[01](\d{2})$/.exec(String(zip ?? ''));
    if (!match) return null;
    const n = Number(match[1]);
    return n >= 1 && n <= 20 ? n : null;
};

export const countShowtimes = (list) => list.reduce((n, e) => n + e.showtimes.length, 0);

// Combien de séances passeraient ces filtres. `countShowtimes(applyFilters(…))` donnait la même
// réponse, au prix d'une entrée reconstruite et d'un tableau d'horaires alloués **par salle** — pour
// n'en garder qu'un entier. Les décomptes « ce que le filtre masque » n'ont besoin que du nombre.
//
// `only` restreint le comptage à un sous-ensemble de séances (les séances événement, en pratique).
// Paramètre plutôt que fonction jumelle : la chaîne de filtres est la même, seul le dénombrement
// change, et deux copies auraient divergé au premier filtre ajouté.
export const countMatching = (list, { card, range = null }, only = null) => {
    let n = 0;
    for (const entry of list) {
        if (card && !entry.cinema.acceptsUgc) continue;
        for (const showtime of entry.showtimes) {
            if (!inTimeRange(showtime, range)) continue;
            if (card && !isCardEligible(showtime)) continue;
            if (only && !only(showtime)) continue;
            n++;
        }
    }
    return n;
};

// Combien de séances **événement** passeraient ces filtres.
export const countMatchingEvents = (list, filters) => countMatching(list, filters, isEventShowtime);

// Filtres — purement dérivés, aucun fetch. Le filtre carte agit à deux niveaux : la salle
// (référentiel curé) et la séance (cf. `isCardEligible`).
// `card` est paramétrable pour pouvoir répondre à « et si j'ouvrais à tout Paris ? » sans dupliquer
// la chaîne de filtres. `range` vaut `null` quand aucune plage horaire n'est demandée.
export const applyFilters = (list, { card, range = null }) =>
    list
        .filter(entry => !card || entry.cinema.acceptsUgc)
        .map(entry => ({
            ...entry,
            showtimes: entry.showtimes
                .filter(s => inTimeRange(s, range))
                .filter(s => !card || isCardEligible(s)),
        }))
        .filter(entry => entry.showtimes.length);

// Ordre entre deux salles : les favorites d'abord, puis l'arrondissement, puis le nom.
// Un seul comparateur pour les deux regroupements — c'est la même intention (« mes salles
// d'abord »), vue par un bout ou par l'autre, et la dupliquer les ferait diverger.
export const byFavoriteThenPlace = (a, b) =>
    (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
    || (a.arrondissement ?? 99) - (b.arrondissement ?? 99)
    || String(a.name).localeCompare(String(b.name));

// Regroupement « Par film » : l'ordre des films suit le rail, les salles remontent selon le même
// ordre — une salle favorite se trouve donc en haut de chaque film.
export const groupByFilm = (entries) => {
    const buckets = new Map();
    for (const entry of entries) {
        if (!buckets.has(entry.movie.id)) buckets.set(entry.movie.id, { key: `f${entry.movie.id}`, movie: entry.movie, entries: [] });
        buckets.get(entry.movie.id).entries.push(entry);
    }
    return [...buckets.values()].map(bucket => ({
        ...bucket,
        entries: bucket.entries.sort((a, b) => byFavoriteThenPlace(a.cinema, b.cinema)),
        nbSeances: countShowtimes(bucket.entries),
        // Compté **après filtrage** (les entrées arrivent déjà filtrées) : la carte annonce les
        // événements qu'on peut effectivement voir dans la liste dépliée, pas ceux que le pré-filtre
        // carte ou la plage horaire viennent d'écarter. Un compteur qui promet trois événements pour
        // n'en montrer qu'un serait pire que pas de compteur.
        nbEvents: countEvents(bucket.entries),
    }));
};

// Regroupement « Par cinéma » : favoris en tête, puis arrondissement croissant.
export const groupByCinema = (entries) => {
    const buckets = new Map();
    for (const entry of entries) {
        if (!buckets.has(entry.cinema.code)) buckets.set(entry.cinema.code, { key: `c${entry.cinema.code}`, cinema: entry.cinema, entries: [] });
        buckets.get(entry.cinema.code).entries.push(entry);
    }
    return [...buckets.values()]
        .map(bucket => ({
            ...bucket,
            nbSeances: countShowtimes(bucket.entries),
            nbEvents: countEvents(bucket.entries),
        }))
        .sort((a, b) => byFavoriteThenPlace(a.cinema, b.cinema));
};
