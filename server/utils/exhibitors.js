// Registre des sources de libellés d'événement. Allociné a un vocabulaire fermé (« Avant-première »,
// jamais « en présence du réalisateur ») : ce texte-là vit chez l'exploitant.
//
// Chaque connecteur est autonome et suit la même forme : sitemap → fiche → texte, rapproché sur le
// titre (pour trouver la fiche), la date et la salle (pour la valider). ⚠️ Aucun ne s'apparie sur
// l'heure : les exploitants horodatent l'événement, pas la projection — une fiche Dulac annonce 18:00
// pour une séance à 20:00.
//
// Ajouter une source = une entrée ici et un module frère.

import { fetchDulacDetail } from './dulac.js';
import { fetchMk2Detail } from './mk2.js';
import { fetchUgcDetail } from './ugc.js';

// Périmètres disjoints, mais on s'arrête au premier qui répond : classés par fiabilité de la jointure.
// UGC s'apparie sur un numéro de séance (rien ne peut dériver), Dulac et MK2 sur (titre, date, salle).
const SOURCES = [
    { id: 'ugc', fetch: fetchUgcDetail },
    { id: 'dulac', fetch: fetchDulacDetail },
    { id: 'mk2', fetch: fetchMk2Detail },
];

// Texte libre pour un (film, date, salle), toutes sources confondues.
//
// ⚠️ `unavailable` remonte dès qu'**une** source n'a pas pu être jointe : l'appelant ne doit pas graver
// « pas de libellé » sur ce qui n'est peut-être qu'une panne réseau. `bookings` (clé de jointure d'UGC)
// passe par la signature commune plutôt qu'un chemin spécial, pour le prochain connecteur qui en aura.
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
