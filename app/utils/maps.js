// Itinéraire « ma position → cette salle », ouvert dans l'application de cartes du système.
//
// Une seule URL par plateforme, et aucune tentative de deviner ce qui est installé :
//   - iOS / iPadOS → `maps.apple.com`, que le système remet à Plans, et qui retombe de lui-même
//     sur la page web si l'app a été désinstallée ;
//   - partout ailleurs → Google Maps, qui bascule tout seul dans l'app sur Android et reste une
//     page web sur ordinateur.
//
// Aucun point de départ n'est passé : laissé vide, les deux services partent de la position
// actuelle. C'est volontaire — on n'a ainsi **jamais** à demander la géolocalisation nous-mêmes,
// donc rien à stocker ni à transmettre. Le domicile, lui, ne quitte pas le `.env` (cf. `travel.js`).
//
// Mode transport en commun par défaut (`travelmode=transit` / `dirflg=r`) : c'est la même unité que
// le `transit_minutes` affiché juste à côté, il serait incohérent d'ouvrir un itinéraire en voiture.

// Destination : les coordonnées dès que la salle est géocodée, sinon « nom, code postal Paris ».
// Les coordonnées d'abord parce que les adresses d'Allociné ne sont pas toujours des adresses
// (« 30 Rue Saint-André des Arts : caisse, salles 1 & 2 - 12 rue Gît-le-Cœur ») : ce sont
// précisément celles que `scripts/geocode-cinemas.mjs` a déjà démêlées, et un couple lat/lng ne
// laisse aucune place à l'ambiguïté.
const destination = (cinema) => {
    const { lat, lng } = cinema ?? {};
    if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;

    return [cinema?.name, cinema?.zip, 'Paris'].filter(Boolean).join(', ');
};

// iPadOS 13+ se présente comme un Mac : l'écran tactile est ce qui les sépare. Un Mac reste sur
// Google Maps — c'est un ordinateur, la carte s'y lit dans le navigateur.
const prefersAppleMaps = () => {
    if (!import.meta.client) return false;
    const ua = navigator.userAgent ?? '';
    return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

export const directionsUrl = (cinema) => {
    const dest = destination(cinema);
    if (!dest) return null;

    return prefersAppleMaps()
        ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=r`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=transit`;
};
