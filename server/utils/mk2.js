// Libellés d'événement des salles MK2 parisiennes. Seconde source d'exploitant après Dulac, sur la
// même architecture : sitemap → fiche → texte, rapproché sur le titre, la date et la salle.
//
// Ce qu'on y gagne, sur le cas qui a motivé l'ajout — *Fjord*, avant-première du 17/08 :
//   Allociné : « Avant-première »
//   MK2      : « La séance sera présentée par le réalisateur Cristian Mungiu. »
//
// ⚠️ Différence notable avec Dulac, et c'est la faiblesse assumée de ce connecteur : **pas de JSON-LD
// exploitable**. On lit l'`og:description`, une métadonnée SEO. C'est plus stable que du markup (un
// site ne remanie pas ses balises `og:` à la légère, son référencement en dépend) mais moins qu'un
// `schema.org/Event`. Si MK2 change la rédaction de ses descriptions, ce connecteur se tait — il ne
// ment pas.
//
// `robots.txt` autorise (`User-agent: * / Allow: /` ; seuls `/panier`, `/mon-compte`, `/redirect`,
// `/_next/static`, `/password-reset` et `/email-reset` sont interdits).

import { normalize, sentences, truncateDetail, metaContent, mentionsDate, isEventHeadline } from './exhibitorText.js';

const MK2_ORIGIN = 'https://www.mk2.com';
// ⚠️ User-Agent **honnête**, jamais une chaîne de navigateur — cf. `allocine.js`.
const USER_AGENT = 'cinegenda/1.0';
const TIMEOUT = 8000;

// Cache mémoire d'instance, opportuniste (cf. `dulac.js`).
const SLUGS_TTL = 10 * 60 * 1000;
let slugsCache = { at: 0, slugs: null };

// Slugs d'événement du sitemap : 422 entrées au total, dont ~61 sous `/evenement/` (singulier chez MK2,
// pluriel chez Dulac — d'où deux connecteurs plutôt qu'un paramétrage).
export const fetchMk2EventSlugs = async () => {
    if (slugsCache.slugs && Date.now() - slugsCache.at < SLUGS_TTL) return slugsCache.slugs;

    try {
        const xml = await $fetch(`${MK2_ORIGIN}/sitemap.xml`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT),
            responseType: 'text',
        });
        const slugs = [...String(xml).matchAll(/<loc>\s*([^<\s]+\/evenement\/[^<\s]+)\s*<\/loc>/g)]
            .map(m => m[1].split('/evenement/')[1]?.replace(/\/$/, ''))
            .filter(Boolean);

        slugsCache = { at: Date.now(), slugs };
        return slugs;
    } catch (e) {
        console.error('[mk2] Sitemap illisible', e?.message ?? e);
        return null;   // `null` = injoignable, `[]` = répondu mais vide. À ne pas confondre.
    }
};

// Slugs qui pourraient concerner ce film : `fjord-avant-premiere` pour « Fjord ». Filtre large — la
// fiche est vérifiée ensuite sur sa date et sa salle, donc un faux candidat ne coûte qu'une lecture.
export const matchingMk2Slugs = (slugs, title) => {
    const needle = normalize(title).replace(/ /g, '-');
    if (needle.length < 3) return [];
    return slugs.filter(slug => slug.includes(needle));
};

// Le texte libre, extrait de la description SEO :
//
//   « Avant-première du film “Fjord” le 17 août à 20h00 au mk2 bibliothèque.
//     La séance sera présentée par le réalisateur Cristian Mungiu. »
//
// La première phrase est une formule figée — type d'événement, film, date, heure, salle — dont on sait
// déjà tout par Allociné. On l'écarte via `isEventHeadline` et on garde la suite, seule information
// neuve. Aucune phrase restante = rien à ajouter, et on rend `null` plutôt que de répéter l'écran.
//
// ⚠️ L'en-tête se reconnaît à sa **date** ou à sa **salle**, pas au titre du film : MK2 l'omet parfois
// (« Avant-première le mardi 8 septembre à 20h00 au mk2 bibliothèque »), et filtrer sur le titre
// laissait alors passer tout l'en-tête dans le libellé — constaté sur `her-private-hell-avant-premiere`.
export const mk2EventDetail = (description, title, cinema) => {
    const rest = sentences(description).filter(s => !isEventHeadline(s, { title, cinema }));
    return rest.length ? truncateDetail(rest.join(' ')) : null;
};

// Texte libre d'un événement MK2 pour un (film, date, salle), ou `null`. N'échoue jamais ;
// `unavailable` distingue « MK2 injoignable » de « MK2 n'a rien pour ça ».
export const fetchMk2Detail = async ({ title, date, cinema }) => {
    // Salle hors réseau : on ne sort pas, pas même pour le sitemap. C'est le premier et le plus gros
    // économiseur d'appels (`isMk2Venue`, auto-importé depuis `shared/utils/exhibitorVenues.js`).
    if (!isMk2Venue(cinema)) return { detail: null, unavailable: false };

    const slugs = await fetchMk2EventSlugs();
    if (slugs === null) return { detail: null, unavailable: true };

    const candidates = matchingMk2Slugs(slugs, title);
    if (!candidates.length) return { detail: null, unavailable: false };

    const wantedVenue = normalize(cinema);

    for (const slug of candidates) {
        let html;
        try {
            html = await $fetch(`${MK2_ORIGIN}/evenement/${slug}`, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(TIMEOUT),
                responseType: 'text',
            });
        } catch (e) {
            console.error('[mk2] Fiche illisible', slug, e?.message ?? e);
            continue;
        }

        const description = metaContent(html, 'og:description') ?? metaContent(html, 'description');
        if (!description) continue;

        // ⚠️ Sur la **description**, jamais sur la page entière : une fiche MK2 porte plusieurs dates
        // ISO dans ses payloads, et une séance du 18 héritait du libellé de celle du 17. Sans preuve
        // de date, on ne qualifie pas — un libellé sur la mauvaise séance est pire que pas de libellé.
        if (!mentionsDate(description, date)) continue;

        // Salle : MK2 l'écrit en minuscules dans sa description (« au mk2 bibliothèque »), Allociné en
        // capitales (« MK2 Bibliothèque »). Comparaison sur les formes normalisées.
        if (wantedVenue && !normalize(description).includes(wantedVenue)) continue;

        const detail = mk2EventDetail(description, title, cinema);
        if (detail) return { detail, unavailable: false, url: `${MK2_ORIGIN}/evenement/${slug}` };
    }

    return { detail: null, unavailable: false };
};
