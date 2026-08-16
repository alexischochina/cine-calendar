// Repères de la « semaine ciné ». **Source unique**, partagée par les trois mondes du projet :
// l'app (bande de jours, contrôle « en salle »), le serveur (fraîcheur du cache de séances) et les
// scripts Node (contrôles de santé). `shared/utils/` est auto-importé côté app comme côté Nitro
// depuis Nuxt 3.14 ; les scripts l'importent par chemin relatif, ce fichier n'ayant aucune
// dépendance.
//
// Pourquoi une source unique et pas deux copies jumelles : la règle du mercredi est un **invariant
// partagé**. Si la version app et la version serveur divergent, le cache déclare « frais » ce que le
// contrôle juge périmé — les deux tournent en rond sans jamais lever d'erreur. Une divergence
// silencieuse est le pire des bugs, autant la rendre impossible.

// Les salles renouvellent leur programmation le mercredi : c'est ce jour-là, et pas une durée
// glissante, qui rythme les contrôles.
const WEDNESDAY = 3;

// Horizon de la vue Séances. Un film est « en salle » s'il a une séance dans cette fenêtre — au-delà,
// la page ne saurait de toute façon pas la montrer.
export const SEANCES_HORIZON_DAYS = 7;

// Date **locale** en `YYYY-MM-DD`. Pas de `toISOString()`, qui rend de l'UTC et bascule d'un jour en
// fin de soirée à Paris.
const formatDay = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Date locale `YYYY-MM-DD` à J+offset (offset négatif accepté).
export const isoDay = (offset = 0) => {
    const d = new Date();
    // Midi et non minuit : décaler de N jours à partir de midi traverse les changements d'heure
    // sans jamais retomber sur la veille.
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return formatDay(d);
};

// Dernier mercredi 00 h (aujourd'hui même, s'il est mercredi).
//
// ⚠️ Minuit et non midi comme `isoDay`, et ce n'est pas à harmoniser : celui-ci sert de **seuil**
// comparé à des horodatages d'écriture, et calé à midi il déclarerait périmé tout ce qui a été écrit le
// mercredi matin.
const lastWednesdayDate = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() - WEDNESDAY + 7) % 7));
    return d;
};

// En millisecondes. Toute donnée écrite avant est périmée quel que soit son âge : une entrée du mardi
// soir ne dit plus rien de la grille du mercredi matin.
export const lastWednesday = () => lastWednesdayDate().getTime();

// Le même repère en `YYYY-MM-DD`, pour se comparer aux dates de sortie, qui sont des chaînes. Rendu
// ici et pas reconverti chez l'appelant : reconvertir, c'est repasser par `toISOString()`, donc par le
// décalage d'un jour que `formatDay` existe pour éviter.
export const lastWednesdayDay = () => formatDay(lastWednesdayDate());
