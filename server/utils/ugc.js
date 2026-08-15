// Libellés d'événement des salles UGC parisiennes, et **la plus fiable des trois sources** : là où
// Dulac et MK2 se rapprochent par (titre, date, salle), UGC publie le numéro de séance de sa
// billetterie dans chaque tuile (`reservationSeances.html?id=330171840281`) — le même qu'Allociné livre
// dans l'URL de réservation. Le rapprochement est une **égalité d'identifiants** : rien ne peut dériver.
//
// ⚠️ Le paramètre qui change tout : `cinemaId`. Sans lui, l'endpoint rend une grille d'affiches sans
// date ni libellé, ce qui fait conclure à tort qu'UGC ne publie rien. Aucune session ni cookie requis.
//
// robots.txt : `Disallow: /AjaxAction!` est un **préfixe** et ne couvre pas `/actusAjaxAction!…`, qui
// est donc autorisé. Les horaires (`/AjaxAction!` tout court) sont fermés — on n'y touche pas.

import { normalize } from './exhibitorText.js';

const UGC_ORIGIN = 'https://www.ugc.fr';
// ⚠️ User-Agent **honnête**, jamais une chaîne de navigateur — cf. `allocine.js`.
const USER_AGENT = 'cine-calendar/1.0';
const TIMEOUT = 8000;

// Les 11 salles UGC de Paris intra-muros, relevées dans leur propre liste
// (`cinemasQuickFilterAjaxAction!getAllList.action`, `id="quickAccessCinema_<id>"`). La banlieue est
// écartée : la vue ne montre que Paris intra-muros.
export const UGC_PARIS_CINEMAS = [
    { id: 10, name: 'UGC Ciné Cité Les Halles' },
    { id: 12, name: 'UGC Ciné Cité Bercy' },
    { id: 7, name: 'UGC Ciné Cité Maillot' },
    { id: 14, name: 'UGC Montparnasse' },
    { id: 15, name: 'UGC Rotonde' },
    { id: 13, name: 'UGC Odéon' },
    { id: 4, name: 'UGC Danton' },
    { id: 11, name: 'UGC Lyon Bastille' },
    { id: 5, name: 'UGC Gobelins' },
    { id: 9, name: 'UGC Opéra' },
    { id: 37, name: 'UGC Ciné Cité Paris 19' },
];

// Numéro de séance dans une URL de billetterie UGC. C'est la clé de jointure, des deux côtés.
export const ugcSessionId = (url) => {
    const found = /reservationSeances\.html\?id=(\d+)/.exec(String(url ?? ''));
    return found ? found[1] : null;
};

// Entités HTML des libellés UGC. Table courte à dessein : ce sont des titres de rubrique produits par
// leur CMS, pas du texte libre — on n'y croise que les accents français.
const ENTITIES = {
    eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç',
    ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë',
    amp: '&', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
};

const decode = (str) => String(str ?? '')
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();

// Tuiles événement d'une page de salle → `{ sessionId, label }`. Découpage sur le marqueur de tuile
// plutôt qu'un parseur d'arbre : un changement de gabarit fait rendre zéro tuile, donc le connecteur se
// tait au lieu de mentir.
//
// ⚠️ Seules les tuiles qui portent **les deux** sont retenues : sans `film-tag` c'est un film ordinaire,
// sans lien de réservation il n'y a aucune séance à laquelle s'accrocher.
export const parseUgcTiles = (html) => {
    const out = [];

    for (const block of String(html ?? '').split('<!-- Component: tile -->')) {
        const tag = /class="film-tag[^"]*"[^>]*>\s*([^<]+)</.exec(block);
        const sessionId = ugcSessionId(block);
        if (!tag || !sessionId) continue;

        const label = decode(tag[1]);
        // « UGC Aime » est une recommandation éditoriale posée sur des films ordinaires, pas un
        // événement. C'est le seul intrus observé, et il est fréquent.
        if (!label || normalize(label) === 'ugc aime') continue;

        out.push({ sessionId, label });
    }
    return out;
};

// Événements d'une salle UGC, indexés par numéro de séance.
const fetchCinemaTiles = async (cinemaId) => {
    const url = `${UGC_ORIGIN}/actusAjaxAction!getActusAndFilters.action?filter=&cinemaId=${cinemaId}&reset=false`;

    try {
        const html = await $fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Referer: `${UGC_ORIGIN}/evenements.html` },
            signal: AbortSignal.timeout(TIMEOUT),
            responseType: 'text',
        });
        return parseUgcTiles(html);
    } catch (e) {
        console.error('[ugc] Événements illisibles pour la salle', cinemaId, e?.message ?? e);
        return null;
    }
};

// Cache mémoire d'instance, opportuniste : donnée publique en lecture, aucune promesse partagée — le
// pire qu'une course produise, c'est deux relevés au lieu d'un. Meurt au cold start, d'où le cache
// durable en base (`server/api/events/detail.js`).
const LABELS_TTL = 10 * 60 * 1000;
let labelsCache = { at: 0, labels: null };

// Carte `numéro de séance → libellé`, pour toutes les salles parisiennes.
//
// Une salle injoignable n'annule pas les autres : on garde ce qu'on a et on signale que la carte est
// incomplète, pour que l'appelant ne grave pas une absence qui n'en est peut-être pas une.
export const fetchUgcLabels = async () => {
    if (labelsCache.labels && Date.now() - labelsCache.at < LABELS_TTL) return labelsCache.labels;

    const labels = {};
    let partial = false;

    const results = await promisePool(
        UGC_PARIS_CINEMAS.map(({ id }) => () => fetchCinemaTiles(id)),
        4,
    );

    for (const tiles of results) {
        if (tiles === null) { partial = true; continue; }
        for (const { sessionId, label } of tiles) labels[sessionId] = label;
    }

    const result = { labels, partial };
    // Un relevé incomplet n'entre pas en cache : on réessaiera au prochain passage plutôt que de
    // figer un trou pour dix minutes.
    if (!partial) labelsCache = { at: Date.now(), labels: result };
    return result;
};

// Texte libre d'un événement UGC : on extrait le numéro de séance des URL de billetterie livrées par
// Allociné et on interroge la carte. Aucun autre critère — l'identifiant remplace titre, date et salle.
export const fetchUgcDetail = async ({ cinema, bookings }) => {
    // Salle hors réseau : on ne sort pas. `isUgcVenue` est auto-importé depuis
    // `shared/utils/exhibitorVenues.js`.
    if (cinema && !isUgcVenue(cinema)) return { detail: null, unavailable: false };

    const ids = (bookings ?? []).map(ugcSessionId).filter(Boolean);
    if (!ids.length) return { detail: null, unavailable: false };

    const { labels, partial } = await fetchUgcLabels();

    for (const id of ids) {
        if (labels[id]) return { detail: labels[id], unavailable: false, url: `${UGC_ORIGIN}/evenements.html` };
    }

    // Rien trouvé, mais le relevé était incomplet : c'est peut-être la salle manquante qui l'avait.
    return { detail: null, unavailable: partial };
};
