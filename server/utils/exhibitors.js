// Registre des sources de libellés d'événement.
//
// Allociné ne décrit pas ses événements : son vocabulaire est fermé et rend « Avant-première », jamais
// « en présence du réalisateur » (vérifié séance par séance, `internalId` à l'appui). Ce texte-là vit
// chez l'exploitant. C'est aussi ainsi que procède paris-cine.info, dont le champ `srcs` trahit deux
// sources par séance (`AO`, `AB` sur la même salle).
//
// Chaque connecteur est autonome et suit la même forme : sitemap → fiche → texte, rapproché sur le
// **titre** (pour trouver la fiche), la **date** et la **salle** (pour la valider). Aucun ne
// s'apparie sur l'heure : les exploitants horodatent l'événement, pas la projection — la fiche Dulac
// de *La Fille Condor* annonce 18:00 pour une séance à 20:00.
//
// Ajouter une source, c'est ajouter une entrée ici et un module frère. Les candidats restants sont
// nombreux — Studio Galande, Studio des Ursulines, Saint-André des Arts, Le Louxor, L'Entrepôt, Les 7
// Parnassiens — et chacun demande son propre format.

import { fetchDulacDetail } from './dulac.js';
import { fetchMk2Detail } from './mk2.js';
import { fetchUgcDetail } from './ugc.js';

// L'ordre compte peu — les périmètres de salles sont disjoints — mais on s'arrête au premier qui
// répond, donc autant classer par fiabilité de la **jointure** :
//   UGC   : égalité de numéros de séance. Rien ne peut dériver.
//   Dulac : (titre, date, salle) sur du `schema.org/Event`.
//   MK2   : (titre, date, salle) sur une description SEO.
const SOURCES = [
    { id: 'ugc', fetch: fetchUgcDetail },
    { id: 'dulac', fetch: fetchDulacDetail },
    { id: 'mk2', fetch: fetchMk2Detail },
];

// Texte libre pour un (film, date, salle), toutes sources confondues.
//
// `unavailable` remonte dès qu'**une** source n'a pas pu être jointe : l'appelant ne doit pas graver
// « pas de libellé » dans son cache sur ce qui n'est peut-être qu'une panne réseau.
// `bookings` : les URL de réservation de la séance, telles qu'Allociné les livre. Seul UGC s'en sert —
// c'est sa clé de jointure — mais elles transitent par la signature commune plutôt que par un chemin
// spécial, pour qu'un futur connecteur qui publie aussi ses identifiants puisse s'en saisir.
export const exhibitorDetail = async ({ title, date, cinema, bookings = [] }) => {
    let unavailable = false;

    for (const source of SOURCES) {
        // Le connecteur décide lui-même s'il couvre cette salle : c'est lui qui connaît son réseau, et
        // ça évite de tenir ici une carte des salles qui divergerait des modules.
        const result = await source.fetch({ title, date, cinema, bookings });
        if (result.unavailable) { unavailable = true; continue; }
        if (result.detail) return { detail: result.detail, url: result.url ?? null, source: source.id };
    }

    return { detail: null, url: null, source: null, unavailable };
};
