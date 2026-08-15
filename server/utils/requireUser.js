// Garde d'authentification des routes serveur.
//
// ⚠️ `app/middleware/auth.js` protège les **pages** Nuxt, pas les handlers Nitro : une route
// `server/api/…` reste joignable par n'importe qui, connecté ou non. Jusqu'ici ça ne coûtait rien —
// RLS refuse les lectures d'un client anonyme, donc les routes qui ne font que lire le cache
// répondent vide et c'est correct.
//
// Ce qui a changé avec les séances : quatre routes **sortent sur le réseau** avant d'écrire quoi que
// ce soit (`resolve`, `refresh`, `events-refresh`, `events/detail`). `serverSupabaseClient` ne lève
// pas pour un anonyme, il rend un client anon : la lecture de cache revient vide, et le handler
// enchaîne sur son appel à Allociné ou à l'exploitant. Sans garde, n'importe qui connaissant l'URL
// fait émettre des requêtes vers des tiers depuis l'IP du déploiement, en volume arbitraire.
//
// Or c'est exactement la prémisse sur laquelle repose le compromis assumé en tête de
// `server/utils/allocine.js` : « app mono-utilisateur, en lecture, à volume dérisoire ». Une route
// ouverte la démolit — et le coût se paierait en invocations serverless comme en réputation d'IP.
//
// À poser sur toute route qui sort sur le réseau. Les routes qui ne font que lire un cache
// (`showtimes`, `events`) n'en ont pas besoin : RLS suffit, et la garde y coûterait un aller-retour
// d'authentification sur le chemin le plus chaud du projet.

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
