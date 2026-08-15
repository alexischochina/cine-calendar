// Libellés d'événement des salles UGC parisiennes. Troisième source d'exploitant, et **la plus fiable
// des trois** — pour une raison qui n'a rien à voir avec la qualité de son HTML.
//
// Dulac et MK2 se rapprochent par (titre, date, salle) : trois heuristiques, trois occasions de se
// tromper. UGC, lui, publie le **numéro de séance de sa billetterie** dans chaque tuile :
//
//     <a href="reservationSeances.html?id=330171840281">19h15</a>
//
// Et Allociné nous donne exactement ce numéro dans l'URL de réservation de la même séance :
//
//     https://www.ugc.fr/reservationSeances.html?id=330171840281&part=all&mtm_source=allocine…
//
// Le rapprochement est donc une **égalité d'identifiants**. Pas de titre à normaliser, pas de date à
// interpréter, pas de nom de salle à comparer. Rien ne peut dériver.
//
// ⚠️ Le paramètre qui change tout : `cinemaId`. Sans lui, l'endpoint rend une grille d'affiches sans
// date ni libellé — c'est ce qui m'a fait conclure à tort qu'UGC ne publiait rien. Avec lui, il rend
// les sections « Séances Spéciales » et « Avant-Premières » de la salle demandée. Aucune session,
// aucun cookie, aucun compte : le paramètre suffit.
//
// robots.txt : `Disallow: /AjaxAction!` est un **préfixe** et ne couvre pas `/actusAjaxAction!…`.
// Ce chemin est donc autorisé. (C'est `/AjaxAction!` tout court — les horaires — qui est fermé, et on
// n'y touche pas : les horaires viennent d'Allociné.)

import { normalize } from './exhibitorText.js';

const UGC_ORIGIN = 'https://www.ugc.fr';
const USER_AGENT = 'Mozilla/5.0 (compatible; cine-calendar/1.0)';
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

// Tuiles événement d'une page de salle → `{ sessionId, label }`.
//
// On découpe sur `<!-- Component: tile -->` plutôt que de parser l'arbre : chaque tuile est un bloc
// autonome, et on ne lit que deux choses dedans. Un changement de gabarit fait rendre zéro tuile — le
// connecteur se tait, il ne ment pas.
//
// ⚠️ Seules les tuiles qui portent **les deux** sont retenues. Une tuile sans `film-tag` est un film
// ordinaire de la rubrique « En ce moment » ; une tuile sans lien de réservation (un cycle, un
// festival) n'a pas de séance à laquelle s'accrocher.
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

// ⚠️ Cache **mémoire d'instance**, donc partagé entre toutes les requêtes d'un serveur Nitro — le motif
// que `useShowtimes` a jugé assez risqué pour y ajouter une garde `import.meta.server`. Inoffensif ici,
// et il faut dire pourquoi : donnée **publique, en lecture**, identique pour tous les visiteurs, et
// aucune promesse partagée. Le pire qu'une course produise, c'est deux relevés au lieu d'un.
//
// Opportuniste : il meurt au cold start (c'est pourquoi le cache qui compte vit en base, cf.
// `server/api/events/detail.js`). Le perdre coûte 11 requêtes, pas davantage.
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

// Texte libre d'un événement UGC, à partir des URL de billetterie de la séance.
//
// `bookings` : les URL de réservation qu'Allociné a livrées pour cette séance. On en extrait le numéro
// et on interroge la carte. Aucun autre critère — ni titre, ni date, ni salle : l'identifiant les
// remplace tous les trois.
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
