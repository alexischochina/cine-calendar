// Garde d'authentification **et d'approbation** des routes serveur.
//
// ⚠️ `app/middleware/auth.js` protège les **pages** Nuxt, pas les handlers Nitro : une route
// `server/api/…` reste joignable par n'importe qui. Sans garde, les cinq routes qui **sortent sur le
// réseau** (`resolve`, `refresh`, `events-refresh`, `events/detail`, `movies/:id/letterboxd`) font
// émettre des requêtes vers des tiers depuis l'IP du déploiement, en volume arbitraire — ce qui
// démolit la prémisse du compromis assumé en tête de `server/utils/allocine.js` (« app
// mono-utilisateur, à volume dérisoire »).
//
// À poser sur toute route qui sort sur le réseau. Celles qui ne font que lire un cache s'en passent —
// RLS suffit, et la garde coûterait un aller-retour sur le chemin le plus chaud (cf. `rateLimit.js`
// et `userCity.js`).
//
// == L'approbation, et pourquoi elle est ici ====================================================
//
// L'inscription est publique (`/register`), l'usage ne l'est pas : un compte naît `approved = false`
// et n'est ouvert qu'à la main dans le dashboard Supabase. Cette serrure **doit** vivre ici, pas
// seulement dans le middleware de page, et pour exactement la raison écrite six lignes plus haut :
// un compte non approuvé qui ne passe que par le middleware de page peut encore appeler les routes
// Nitro directement, donc faire sortir le déploiement chez Allociné, UGC, Dulac et MK2 à volonté.
// Une inscription publique sans cette ligne, c'est un robinet ouvert sur des tiers.
//
// ⚠️ Profil absent = non approuvé. Une garde qui s'ouvre sur une donnée manquante n'est pas une
// garde : si la migration `2609221212` n'a pas été jouée, ou si la ligne a été supprimée, on refuse.

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

    // Client **de session** et non service-role : RLS ne rend que la ligne de l'appelant
    // (`profiles: lecture de son profil`), donc `maybeSingle` suffit et ne peut pas rendre le profil
    // de quelqu'un d'autre.
    //
    // ⚠️ **Pas de `.eq('user_id', …)` ici, et ce n'est pas un raccourci.** Ce filtre a existé, écrit
    // « pour la clarté », et il cassait tout : depuis `@nuxtjs/supabase` 2.0.5, `serverSupabaseUser`
    // ne rend plus un objet utilisateur mais les **claims du JWT**, où l'identifiant s'appelle `sub`
    // et non `id`. `user.id` valait donc `undefined`, PostgREST répondait
    // `invalid input syntax for type uuid: "undefined"`, et la garde tombait dans sa branche
    // « profil illisible » → **503 sur les cinq routes, pour tout le monde**, y compris les comptes
    // approuvés. Un filtre redondant qui ne protégeait rien et qui a suffi à éteindre la moitié de
    // l'application.
    //
    // La leçon est plus générale : ne pas réécrire côté code ce que RLS fait déjà. Le filtre en
    // double n'ajoute aucune garantie et donne une seconde occasion de se tromper.
    const { data: profile, error } = await client
        .from('profiles')
        .select('user_id, city, approved')
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
