// Libellés d'événement des salles Dulac — L'Arlequin, L'Escurial, Majestic Bastille, Majestic Passy,
// Reflet Médicis. Cinq salles art et essai parisiennes, celles qui concentrent le plus d'événements.
//
// Pourquoi cette source. Allociné ne livre **aucun texte libre** décrivant un événement : son
// vocabulaire est fermé (`showtimeEventLabels` dans `allocine.js`) et donne « Avant-première », jamais
// « en présence du réalisateur ». Vérifié séance par séance, `internalId` à l'appui. C'est aussi ce que
// fait paris-cine.info, dont le champ `srcs` trahit deux sources par séance (`AO`, `AB` sur la même
// salle) : Allociné pour la grille, l'exploitant pour le texte.
//
// Pourquoi Dulac plutôt qu'un autre. Ce n'est **pas du parsing HTML** — c'est précisément ce que le
// projet a abandonné, pour cause de fragilité. Chaque fiche événement porte un
// `application/ld+json` au format `schema.org/Event`, avec `name`, `description`, `startDate` et
// `location.name`. De la donnée structurée et standardisée, donc stable. Et `robots.txt` l'autorise
// (`User-agent: * / Allow: /`, seuls `/old` et `/test-jsonapi` sont interdits).
//
// ⚠️ Ce qu'on ne fait PAS : parcourir les 111 fiches du sitemap à chaque relevé. On part du film qu'on
// cherche à qualifier — on connaît déjà son titre, sa salle et sa date par Allociné — et on ne va lire
// que les fiches dont le **slug** ressemble à ce titre. Une requête de sitemap (mise en cache) plus une
// ou deux fiches, au lieu de 111.

import { normalize, escapeRe, fold, truncateDetail, isEventHeadline } from './exhibitorText.js';

// ⚠️ **Aucun import vers `shared/` ici, et c'est volontaire.** Deux contraintes se contredisaient :
//   - `scripts/test-seances-rules.mjs` charge ce fichier hors de Nuxt, donc sans les auto-imports ;
//   - un import relatif qui traverse `shared/` (`../../shared/utils/…`) **casse au bundling** — Vite
//     réécrit le chemin depuis le chunk généré et sort du projet (`/Users/shared/utils/…`). Déjà
//     rencontré sur `app/utils/seancesGrouping.js`.
//
// La sortie : les helpers de texte vivent dans `./exhibitorText.js`, voisin de palier, importable des
// deux côtés. `isDulacVenue`, utilisé seulement par la fonction réseau, vient de l'auto-import Nitro
// (`shared/utils/exhibitorVenues.js`) — le test ne l'atteint jamais.

const DULAC_ORIGIN = 'https://www.dulaccinemas.com';
const USER_AGENT = 'Mozilla/5.0 (compatible; cine-calendar/1.0)';
const TIMEOUT = 8000;

// Le sitemap ne bouge qu'au rythme des publications de Dulac, et une même vague de relevés enchaîne
// plusieurs recherches. On le garde donc en mémoire quelques minutes.
//
// ⚠️ Cache **mémoire d'instance**, donc partagé entre toutes les requêtes d'un serveur Nitro — le motif
// que `useShowtimes` a jugé assez risqué pour y ajouter une garde `import.meta.server`. Ici il est
// inoffensif, et il faut dire pourquoi : ce cache ne contient que de la **donnée publique en lecture**,
// identique pour tous les visiteurs, et aucune promesse n'y est partagée (pas de file d'attente). Le pire
// qu'une course puisse produire, c'est deux lectures de sitemap au lieu d'une.
//
// Opportuniste par ailleurs : il meurt au cold start sur Vercel — c'est exactement pourquoi les caches
// qui comptent vivent en base (cf. `refresh.js`). Le perdre coûte une requête, pas une salve.
const SLUGS_TTL = 10 * 60 * 1000;
let slugsCache = { at: 0, slugs: null };

// Slugs d'événement du sitemap. 823 entrées au total, dont ~111 sous `/evenements/`.
export const fetchDulacEventSlugs = async () => {
    if (slugsCache.slugs && Date.now() - slugsCache.at < SLUGS_TTL) return slugsCache.slugs;

    try {
        const xml = await $fetch(`${DULAC_ORIGIN}/sitemap.xml`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT),
            responseType: 'text',
        });
        const slugs = [...String(xml).matchAll(/<loc>\s*([^<\s]+\/evenements\/[^<\s]+)\s*<\/loc>/g)]
            .map(m => m[1].split('/evenements/')[1]?.replace(/\/$/, ''))
            .filter(Boolean);

        slugsCache = { at: Date.now(), slugs };
        return slugs;
    } catch (e) {
        console.error('[dulac] Sitemap illisible', e?.message ?? e);
        return null;   // `null` = injoignable, `[]` = répondu mais vide. L'appelant ne doit pas confondre.
    }
};

// Slugs qui pourraient concerner ce film. Le slug d'une fiche Dulac contient le titre du film
// (`avant-premiere-la-fille-condor-de-alvaro-olmos-torrico-…`) : on teste l'inclusion du titre
// normalisé, tirets compris. Filtre volontairement large — la fiche est vérifiée ensuite sur sa date
// et sa salle, donc un faux candidat ne coûte qu'une lecture.
export const matchingSlugs = (slugs, title) => {
    const needle = normalize(title).replace(/ /g, '-');
    if (needle.length < 3) return [];
    return slugs.filter(slug => slug.includes(needle));
};

// JSON-LD d'une fiche. On ne lit **que** le nœud `Event` : le reste (`BreadcrumbList`, `Organization`)
// ne nous concerne pas.
export const parseDulacEvent = (html) => {
    const block = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(String(html ?? ''));
    if (!block) return null;

    let data;
    try {
        data = JSON.parse(block[1]);
    } catch {
        return null;
    }

    const nodes = Array.isArray(data) ? data : (data['@graph'] ?? [data]);
    const event = nodes.find(n => n?.['@type'] === 'Event');
    if (!event?.startDate) return null;

    return {
        // ⚠️ Date seule, jamais l'heure : Dulac horodate l'**événement** et non la projection. Sur
        // *La Fille Condor* sa fiche annonce 18:00 pour une séance à 20:00. Rapprocher sur l'heure
        // ferait manquer le cas le plus courant.
        date: String(event.startDate).slice(0, 10),
        venue: event.location?.name ?? null,
        name: event.name ?? '',
        description: event.description ?? '',
    };
};

// Le texte libre, extrait de la description. Celle-ci répète le titre en tête puis le redonne en
// queue, encadrant la phrase utile :
//
//   « AVANT-PREMIÈRE : LA FILLE CONDOR de Álvaro Olmos Torrico␣␣Séance en présence du réalisateur,
//     suivie d'une dégustation de produits boliviens (assurée par l'Ambassade de Bolivie)
//     LA FILLE CONDOR de… »
//
// On découpe sur les blancs doubles (Dulac y sépare ses paragraphes), on écarte les segments qui ne
// sont qu'un écho du titre, et on coupe à la réapparition du titre.
//
export const dulacEventDetail = (event, title) => {
    const words = normalize(title).split(' ').filter(Boolean);
    // Séparateurs souples entre les mots du titre : la description les ponctue autrement que le slug.
    const source = words.length ? words.map(escapeRe).join('\\s+') : null;

    const segments = String(event?.description ?? '').split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

    for (const segment of segments) {
        const { out, map } = fold(segment);

        // Segment d'en-tête : « AVANT-PREMIÈRE : <titre> de <réalisateur> ». Il n'apporte rien qu'on
        // n'ait déjà — le type vient d'Allociné, le titre et le réalisateur de TMDB. Reconnu par le
        // même test que chez MK2 : une date, la salle, ou un segment qui n'est que le titre.
        if (out.trimStart().startsWith('avant premiere')) continue;
        if (isEventHeadline(segment, { title })) continue;

        // Coupe à la réapparition du titre, qui marque la fin de la phrase utile.
        let text = segment;
        if (source) {
            const re = new RegExp(source, 'g');
            re.lastIndex = 1;
            const found = re.exec(out);
            if (found && found.index > 12) text = segment.slice(0, map[found.index]);
        }

        const detail = truncateDetail(text);
        if (detail) return detail;
    }

    return null;
};

// Texte libre d'un événement Dulac pour un (film, date, salle), ou `null`.
//
// N'échoue jamais. `unavailable` distingue « Dulac injoignable » de « Dulac n'a pas d'événement
// pour ça » — le premier ne doit pas être mis en cache comme une absence, sinon une panne réseau
// tairait le libellé jusqu'à expiration.
export const fetchDulacDetail = async ({ title, date, cinema }) => {
    if (!isDulacVenue(cinema)) return { detail: null, unavailable: false };

    const slugs = await fetchDulacEventSlugs();
    if (slugs === null) return { detail: null, unavailable: true };

    const candidates = matchingSlugs(slugs, title);
    if (!candidates.length) return { detail: null, unavailable: false };

    const wantedVenue = normalize(cinema);

    for (const slug of candidates) {
        let html;
        try {
            html = await $fetch(`${DULAC_ORIGIN}/evenements/${slug}`, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(TIMEOUT),
                responseType: 'text',
            });
        } catch (e) {
            console.error('[dulac] Fiche illisible', slug, e?.message ?? e);
            continue;
        }

        const event = parseDulacEvent(html);
        if (!event || event.date !== date) continue;

        // Salle : vérifiée dans les deux sens. Allociné et Dulac ne rédigent pas pareil (« L'Arlequin »
        // contre « Arlequin »), et l'un est parfois plus verbeux que l'autre.
        const venue = normalize(event.venue);
        if (venue && wantedVenue && !venue.includes(wantedVenue) && !wantedVenue.includes(venue)) continue;

        const detail = dulacEventDetail(event, title);
        if (detail) return { detail, unavailable: false, url: `${DULAC_ORIGIN}/evenements/${slug}` };
    }

    return { detail: null, unavailable: false };
};
