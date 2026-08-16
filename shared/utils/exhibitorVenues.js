// Quelles salles sont couvertes par une source de libellés d'événement, et par laquelle.
// **Source unique** partagée par l'app, le serveur et les scripts (cf. l'en-tête de `cineWeek.js`).
//
// Pourquoi ce test vit aussi côté app : c'est **lui** qui économise les appels. Sans lui, l'app
// demanderait un libellé pour chaque séance événement de Paris, dont l'immense majorité n'a aucune
// source branchée — un aller-retour HTTP pour se faire répondre non, à chaque fois.
//
// ⚠️ Aucune dépendance, volontairement, d'où la normalisation recopiée ici : `shared/` doit rester
// chargeable depuis n'importe où, y compris un script Node nu.

const normalize = (str) => String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
