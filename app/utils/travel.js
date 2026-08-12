// Mise en forme du temps de trajet domicile → salle.
//
// La valeur elle-même est **pré-calculée côté serveur** (`scripts/transit-times.mjs`, colonne
// `cinemas.transit_minutes`) et non dans le navigateur : le domicile étant fixe, c'est une constante
// par salle. Ça évite surtout d'exposer les coordonnées du domicile au client — une donnée
// personnelle n'a rien à faire dans le payload envoyé au navigateur.

// « 24 min » / « 1 h 05 ». `null` si le trajet n'est pas connu (salle non géocodée, ou apparue
// depuis le dernier passage du script) : l'UI n'affiche alors rien, jamais un tiret de remplissage
// ni une valeur estimée.
export const formatTransit = (minutes) => {
    if (minutes == null || !Number.isFinite(minutes)) return null;
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};
