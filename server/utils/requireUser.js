// Garde d'authentification **et d'approbation** des routes serveur.
//
// ⚠️ `app/middleware/auth.js` protège les **pages** Nuxt, pas les handlers Nitro : sans cette garde,
// les cinq routes qui **sortent sur le réseau** (`resolve`, `refresh`, `events-refresh`,
// `events/detail`, `movies/:id/letterboxd`) font émettre des requêtes vers des tiers depuis l'IP du
// déploiement, en volume arbitraire — ce qui démolit la prémisse du compromis assumé en tête de
// `server/utils/allocine.js`.
//
// À poser sur toute route qui sort sur le réseau. Celles qui ne font que lire un cache s'en passent —
// RLS suffit, et la garde coûterait un aller-retour sur le chemin le plus chaud (cf. `rateLimit.js`
// et `userCity.js`).
//
// ⚠️ L'approbation doit vivre **ici** et pas seulement dans le middleware de page, pour la raison
// écrite six lignes plus haut : un compte non approuvé peut appeler les routes Nitro directement.
// Une inscription publique sans cette ligne, c'est un robinet ouvert sur des tiers.
//
// ⚠️ Profil absent = non approuvé. Une garde qui s'ouvre sur une donnée manquante n'est pas une garde.

import { serverSupabaseUser, serverSupabaseClient } from '#supabase/server';

// Rend `{ user, profile }` et non `user` seul : les appelants ont besoin de la **ville** pour choisir
// la localisation Allociné et la clé du cache (cf. `refreshShowtimes`). La lire ici, dans la requête
// qu'on fait de toute façon, évite un second aller-retour par route.
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

    // Identifiant normalisé tout de suite : selon la version du module, `serverSupabaseUser` rend un
    // objet utilisateur (`id`) ou des claims JWT (`sub`). Résolu ici une fois, pour que ni les
    // journaux ni les appelants n'aient à s'en soucier.
    const userId = user.sub ?? user.id;

    const client = await serverSupabaseClient(event);

    // Client **de session** et non service-role : l'appelant ne lit que ce que ses policies lui
    // donnent, jamais la table entière.
    //
    // ⚠️⚠️ **`.eq('user_id', userId)` est obligatoire depuis les listes partagées** : `profiles` rend
    // maintenant plusieurs lignes à un compte approuvé, `maybeSingle()` lève, et les cinq routes
    // gardées tombent en 503 pour tout le monde — donc la vue Séances avec.
    //
    // ⚠️ **`userId` et jamais `user.id` brut** : `serverSupabaseUser` rend les claims du JWT, où
    // l'identifiant s'appelle `sub`. C'est l'erreur qui avait déjà mis ces routes en 503.
    const { data: profile, error } = await client
        .from('profiles')
        .select('user_id, city, approved')
        .eq('user_id', userId)
        .maybeSingle();

    // ⚠️ Une erreur de lecture **ferme**, elle n'ouvre pas. Table absente (migration pas jouée),
    // panne Supabase, policy mal posée : dans les trois cas on ne sait pas si ce compte est approuvé,
    // et « je ne sais pas » ne vaut pas « oui ». 503 plutôt que 403, parce que ce n'est pas la faute
    // de l'appelant et que le message doit orienter vers la bonne cause.
    if (error) {
        console.error('[auth] Profil illisible pour', userId, '—', error.message);
        throw createError({ statusCode: 503, statusMessage: 'Profile unavailable' });
    }

    if (!profile?.approved) {
        throw createError({ statusCode: 403, statusMessage: 'Account pending approval' });
    }

    // `id` exposé aux appelants quelle que soit la forme rendue par le module : c'est cette
    // différence qui a produit le 503 décrit plus haut, ils n'ont pas à la connaître.
    return { user: { ...user, id: userId }, profile };
};
