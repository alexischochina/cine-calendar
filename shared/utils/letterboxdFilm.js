// Lecture du JSON-LD d'une fiche film Letterboxd : note **et** liens réalisateurs.
// Sans dépendance, donc importable app / serveur / script — la route et le backfill en avaient
// chacun leur copie.
//
// ⚠️ Le lien réalisateur ne se devine **pas** depuis le nom : Letterboxd suffixe les homonymes
// (`kane-parsons-4`, le slug nu désignant quelqu'un d'autre — un 200 qui ment, indétectable par
// sondage) et n'orthographie pas toujours comme TMDB (ordre inversé, translittération, écriture non
// latine). `director[].sameAs` est la seule source exacte, et elle est dans la page déjà chargée
// pour la note.

// `matchAll` : ne lire que le premier bloc échouerait en silence le jour où Letterboxd en insère un
// avant celui du film.
const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

// ⚠️ Deux formes, pas une : le slug (`/director/joe-russo/`) et l'identifiant de contributeur
// (`/director/contributor:61567/`), servi quand la personne n'a pas de page à slug. N'accepter que
// la première jetait des liens valides.
const DIRECTOR_URL_RE = /^https:\/\/letterboxd\.com\/director\/(?:[a-z0-9-]+|contributor:\d+)\/$/;

const empty = () => ({ rating: null, count: null, directors: [] });

// Exporté parce que l'écriture n'est pas seule concernée : la valeur ressort de la base pour aller
// dans un `href`, et le rendu est la dernière ligne de défense (cf. `directorLinks`).
export const isLetterboxdDirectorUrl = (url) => DIRECTOR_URL_RE.test(String(url ?? ''));

export const parseLetterboxdFilm = (html) => {
    const blocks = [...String(html ?? '').matchAll(LD_RE)]
        .map(m => {
            // Le JSON-LD Letterboxd est enveloppé dans un commentaire CDATA.
            const raw = m[1].replace(/\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\//, '').trim();
            try { return JSON.parse(raw); } catch { return null; }
        })
        .filter(Boolean);

    // La fiche film, pas le fil d'Ariane qui l'accompagne parfois.
    const data = blocks.find(b => b?.['@type'] === 'Movie') ?? blocks[0];
    if (!data) return empty();

    const rating = Number(data?.aggregateRating?.ratingValue);
    const count = Number(data?.aggregateRating?.ratingCount);
    const directors = (Array.isArray(data?.director) ? data.director : [])
        .map(d => ({ name: String(d?.name ?? '').trim(), url: String(d?.sameAs ?? '').trim() }))
        .filter(d => d.name && isLetterboxdDirectorUrl(d.url));

    return {
        rating: Number.isFinite(rating) ? rating : null,
        count: Number.isFinite(count) ? count : null,
        directors,
    };
};
