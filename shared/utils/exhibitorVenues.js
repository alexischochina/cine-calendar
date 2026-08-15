// Quelles salles sont couvertes par une source de libellés d'événement, et par laquelle.
// **Source unique**, partagée par les trois mondes du projet comme `cineWeek.js` : l'app (qui décide
// s'il vaut la peine d'appeler la route), le serveur (qui interroge l'exploitant) et les scripts.
//
// Pourquoi ce test vit ici et pas seulement côté serveur : c'est **lui** qui économise les appels. Sans
// lui, l'app demanderait un libellé pour chaque séance événement de Paris, dont l'immense majorité n'a
// aucune source branchée — un aller-retour HTTP pour se faire répondre non, à chaque fois.
//
// ⚠️ Aucune dépendance, volontairement — même discipline que `cineWeek.js`. D'où la normalisation
// recopiée ici en quelques lignes plutôt qu'importée : `shared/` doit rester chargeable depuis
// n'importe où, y compris un script Node nu. (Et un import relatif *vers* `shared/` casse au bundling,
// ce qui interdit le trajet inverse — cf. l'en-tête de `server/utils/exhibitorText.js`.)

const normalize = (str) => String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Réseau Dulac : cinq salles art et essai. Écrites sous forme normalisée et **sans article**
// (« escurial », pas « l'escurial ») : la comparaison se fait par inclusion dans les deux sens, parce
// qu'Allociné et Dulac ne rédigent pas les noms pareil et que l'un est parfois plus verbeux que l'autre.
export const DULAC_VENUES = ['arlequin', 'escurial', 'majestic bastille', 'majestic passy', 'reflet medicis'];

export const isDulacVenue = (name) => {
    const normalized = normalize(name);
    return normalized ? DULAC_VENUES.some(v => normalized.includes(v)) : false;
};

// MK2 : une dizaine de salles parisiennes, toutes préfixées de la marque (« MK2 Bibliothèque »,
// « MK2 Gambetta », « MK2 Nation »…). Un test sur le préfixe vaut mieux qu'une liste en dur, qui
// vieillirait à chaque ouverture ou fermeture de salle. Aucun autre cinéma parisien ne porte « mk2 ».
export const isMk2Venue = (name) => normalize(name).includes('mk2');

// UGC : 11 salles parisiennes, toutes préfixées de la marque. Même raisonnement que MK2 — un test sur
// le préfixe vieillit mieux qu'une liste en dur.
export const isUgcVenue = (name) => normalize(name).startsWith('ugc');

// Le pré-filtre de l'app : cette salle a-t-elle une chance d'avoir un libellé quelque part ?
export const isKnownExhibitorVenue = (name) =>
    isDulacVenue(name) || isMk2Venue(name) || isUgcVenue(name);
