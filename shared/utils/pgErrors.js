// Reconnaître « cet objet n'existe pas encore en base » à travers PostgREST.
//
// **Source unique** partagée par les routes serveur, les composables et les scripts (cf. l'en-tête de
// `cineWeek.js` pour le pourquoi de `shared/`).
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
