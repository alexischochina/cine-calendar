// Reconnaître « cet objet n'existe pas encore en base » à travers PostgREST.
//
// ⚠️ Piège coûteux, et déjà rencontré deux fois sur ce projet sous une autre forme. Une **colonne**
// absente remonte `42703` en lecture mais `PGRST204` en écriture (cf. `check-seances.mjs`, documenté
// dans `README-seances.md`). Une **table** absente, elle, ne remonte pas `42P01` du tout quand
// PostgREST tranche sur son cache de schéma sans atteindre la base : le code est `PGRST205` et le
// message « Could not find the table 'public.…' in the schema cache ».
//
// Ne tester que `42P01` laissait donc le garde inerte : la route croyait la table présente, retentait
// à chaque relevé, et l'erreur ne se voyait qu'en console — pendant que le cache, lui, n'écrivait rien
// et qu'on ressortait sur le réseau à chaque fois. Constaté le 14/08/2026 sur `event_detail_cache`.
const MISSING_CODES = ['42P01', 'PGRST205', 'PGRST204', '42703'];

export const isMissingSchema = (error) => {
    if (!error) return false;
    if (MISSING_CODES.includes(error.code)) return true;
    return /schema cache/i.test(String(error.message ?? ''));
};
