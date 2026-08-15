// Reconnaître « cet objet n'existe pas encore en base » à travers PostgREST.
//
// **Source unique**, partagée par les trois mondes du projet comme `cineWeek.js` : les routes serveur
// (qui lisent et écrivent les caches), les composables (qui écrivent sur `calendar` et lisent
// `cinemas`) et les scripts. `shared/utils/` est auto-importé côté app comme côté Nitro depuis
// Nuxt 3.14 ; les scripts l'importent par chemin relatif, ce fichier n'ayant aucune dépendance.
//
// ⚠️ La règle est contre-intuitive au point d'avoir été ratée à cinq endroits, chacun avec un jeu de
// codes différent : une **colonne** absente remonte `42703` en lecture mais **`PGRST204`** en écriture,
// une **table** absente `PGRST205` et non `42P01` — PostgREST tranche sur son cache de schéma sans
// atteindre la base. Chaque test partiel laissait son garde inerte, donc le contrôle hebdomadaire
// repartait à chaque chargement : la salve qu'il existe pour éviter.
const MISSING_CODES = ['42P01', 'PGRST205', 'PGRST204', '42703'];

export const isMissingSchema = (error) => {
    if (!error) return false;
    if (MISSING_CODES.includes(error.code)) return true;
    return /schema cache/i.test(String(error.message ?? ''));
};
