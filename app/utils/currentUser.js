// L'identifiant du compte connecté.
//
// ⚠️ `useSupabaseUser()` rend les **claims du JWT**, pas un objet utilisateur : l'identifiant
// s'appelle `sub` et `.id` vaut `undefined` — au rendu serveur comme dans le navigateur, les deux
// plugins de `@nuxtjs/supabase` 2.0.5 y écrivant `getClaims()`.
//
// L'oublier donne `user_id=eq.undefined`, que Postgres refuse en `22P02` : les replis fermés du
// projet traduisent alors l'erreur en « compte non validé » ou en 503.
export const userIdOf = (user) => user?.sub ?? user?.id ?? null;
