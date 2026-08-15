// Garde d'authentification des routes serveur.
//
// ⚠️ `app/middleware/auth.js` protège les **pages** Nuxt, pas les handlers Nitro : une route
// `server/api/…` reste joignable par n'importe qui. Sans garde, les quatre routes qui **sortent sur le
// réseau** (`resolve`, `refresh`, `events-refresh`, `events/detail`) font émettre des requêtes vers des
// tiers depuis l'IP du déploiement, en volume arbitraire — ce qui démolit la prémisse du compromis
// assumé en tête de `server/utils/allocine.js` (« app mono-utilisateur, à volume dérisoire »).
//
// À poser sur toute route qui sort sur le réseau. Celles qui ne font que lire un cache s'en passent —
// RLS suffit, et la garde coûterait un aller-retour sur le chemin le plus chaud (cf. `rateLimit.js`).

import { serverSupabaseUser } from '#supabase/server';

export const requireUser = async (event) => {
    let user = null;

    try {
        user = await serverSupabaseUser(event);
    } catch {
        // `serverSupabaseUser` lève sur un jeton illisible — sans `statusCode`, donc en 500. Un jeton
        // qu'on ne sait pas lire est un visiteur qu'on ne sait pas identifier : c'est un 401, pas une
        // panne du serveur.
        user = null;
    }

    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    return user;
};
