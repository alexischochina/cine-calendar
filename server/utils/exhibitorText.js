// Outils de texte partagés par les connecteurs d'exploitant (`dulac.js`, `mk2.js`).
//
// ⚠️ Import **relatif entre fichiers de `server/utils/`**, jamais vers `shared/`. Un `../../shared/…`
// est réécrit par Vite depuis le chunk généré et sort du projet (`/Users/shared/utils/…`) — vu deux
// fois sur ce projet. Un `./` dans le même dossier passe partout : Nitro le bundle, et le script de
// test le résout tel quel hors de Nuxt.

// Version repliée d'une chaîne, avec une table de correspondance des positions vers l'original.
//
// ⚠️ Cette table est indispensable, et son absence a mordu : chercher une aiguille dans une version
// normalisée puis découper la chaîne d'origine à l'index trouvé donne un décalage, la normalisation
// supprimant des caractères (accents, apostrophes, parenthèses). Symptôme observé sur *La Fille
// Condor* : « … de Bolivi » au lieu de « … de Bolivie) », la phrase tronquée à cinq caractères de la fin.
export const fold = (str) => {
    const source = String(str ?? '');
    let out = '';
    const map = [];

    for (let i = 0; i < source.length; i++) {
        const stripped = source[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        // Un caractère d'origine peut se replier en plusieurs (œ → oe) : chacun retient sa position
        // d'origine, sans quoi la table se désynchroniserait sur la suite de la chaîne.
        for (const ch of stripped) {
            out += /[a-z0-9]/.test(ch) ? ch : ' ';
            map.push(i);
        }
    }
    return { out, map };
};

// Forme de comparaison, sur le modèle de `normalizeTitle` (allocine.js) : accents dépliés, tout ce qui
// n'est pas alphanumérique réduit à un espace. Recopié plutôt qu'importé pour que les connecteurs
// restent chargeables par le script de test sans monter Nuxt.
export const normalize = (str) => fold(str).out.replace(/\s+/g, ' ').trim();

export const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longueur au-delà de laquelle un libellé n'informe plus : il remplit. La fiche complète reste à un
// clic sur le site de la salle.
export const MAX_DETAIL = 160;

// Coupe en annonçant la coupe. Un texte tronqué en silence se lit comme un texte complet.
export const truncateDetail = (text) => {
    const clean = String(text ?? '').trim().replace(/[\s—–-]+$/, '').trim();
    if (clean.length < 8) return null;
    return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL - 1).trimEnd()}…` : clean;
};

// Contenu d'une balise meta (`og:description`, `description`…), entités HTML les plus courantes
// décodées. On ne monte pas un parseur pour ça : ces attributs sont produits par un CMS, ils ne
// portent que le jeu d'entités standard.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', '#x27': "'" };

export const metaContent = (html, name) => {
    const attr = escapeRe(name);
    const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${attr}["'][^>]*content=["']([^"']*)["']`
        + `|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${attr}["']`,
        'i',
    );
    const found = re.exec(String(html ?? ''));
    if (!found) return null;

    return (found[1] ?? found[2] ?? '')
        .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => ENTITIES[code.toLowerCase()] ?? whole)
        .trim() || null;
};

// Découpe en phrases, sur un point suivi d'un blanc. Suffisant pour des descriptions de CMS, et sans
// dépendance — on ne cherche pas à segmenter du texte littéraire.
export const sentences = (text) => String(text ?? '')
    .split(/(?<=\.)\s+/)
    .map(s => s.trim())
    .filter(Boolean);

// --- Dates écrites en toutes lettres ------------------------------------------------------------
//
// Les exploitants datent leurs événements en français et **sans année** (« le 17 août », « le mardi
// 8 septembre »). Sur un horizon de sept jours, jour + mois lèvent toute ambiguïté.

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

const DATE_RE = new RegExp(`(\\d{1,2}) (${MONTHS.join('|')})`, 'g');

// Toutes les dates trouvées dans un texte, en `{ day, month }` (mois de 1 à 12).
export const frenchDates = (text) =>
    [...normalize(text).matchAll(DATE_RE)]
        .map(m => ({ day: Number(m[1]), month: MONTHS.indexOf(m[2]) + 1 }));

// Le texte annonce-t-il **cette** date ?
//
// ⚠️ C'est le garde-fou contre le faux rapprochement, et il a été resserré après coup : chercher la
// date ISO dans la page entière ne suffisait pas — une fiche MK2 porte plusieurs dates dans ses
// payloads, si bien qu'une séance du 18 se voyait attribuer le libellé de celle du 17. La date
// annoncée dans la **description** est la seule qui qualifie l'événement.
export const mentionsDate = (text, isoDate) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
    if (!parts) return false;

    const month = Number(parts[2]);
    const day = Number(parts[3]);
    return frenchDates(text).some(d => d.day === day && d.month === month);
};

// La phrase est-elle l'en-tête figé de l'événement ? Les exploitants ouvrent par une formule qui
// répète ce qu'on sait déjà — type, film, date, heure, salle. On la reconnaît à ce qu'elle porte une
// date ou le nom de la salle, plutôt qu'au titre du film : MK2 l'omet parfois (« Avant-première le
// mardi 8 septembre à 20h00 au mk2 bibliothèque »), et se fier au titre laissait alors passer tout
// l'en-tête dans le libellé.
export const isEventHeadline = (sentence, { title, cinema }) => {
    const folded = normalize(sentence);
    if (frenchDates(sentence).length) return true;
    if (cinema && folded.includes(normalize(cinema))) return true;

    // Phrase qui n'est que le titre : rien à en tirer non plus.
    const withoutTitle = title ? folded.replace(normalize(title), '') : folded;
    return withoutTitle.replace(/[^a-z0-9]/g, '').length < 12;
};
