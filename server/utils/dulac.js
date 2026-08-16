// Libellés d'événement des salles Dulac — L'Arlequin, L'Escurial, Majestic Bastille, Majestic Passy,
// Reflet Médicis. Cinq salles art et essai parisiennes, celles qui concentrent le plus d'événements.
//
// Pourquoi Dulac en premier. Ce n'est **pas du parsing HTML** — c'est précisément ce que le
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

// ⚠️ Aucun import vers `shared/` (cf. l'en-tête de `exhibitorText.js`) : `isDulacVenue` vient de
// l'auto-import Nitro, que seule la fonction réseau atteint.

const DULAC_ORIGIN = 'https://www.dulaccinemas.com';
// ⚠️ User-Agent **honnête**, jamais une chaîne de navigateur — cf. `allocine.js`.
const USER_AGENT = 'cine-calendar/1.0';
const TIMEOUT = 8000;

// Le sitemap ne bouge qu'au rythme des publications de Dulac, et une vague de relevés enchaîne
// plusieurs recherches. Cache mémoire d'instance, inoffensif pour la même raison que celui d'`ugc.js`.
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
