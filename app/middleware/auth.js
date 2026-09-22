// Garde des **pages** : une session, et un compte approuvé.
//
// ⚠️ Elle ne protège que les pages Nuxt. Les routes `server/api/…` restent joignables sans elle —
// c'est `server/utils/requireUser.js` qui les garde, et c'est là que vit la vraie serrure. Ce
// fichier ne fait que rendre le refus lisible : sans lui, un compte non approuvé arriverait sur une
// timeline vide (RLS ne lui rend rien) sans comprendre pourquoi.
//
// `/login`, `/register` et `/pending` ne portent pas ce middleware : la première et la deuxième
// parce qu'on y va justement sans compte, la troisième parce qu'elle est l'endroit où l'on atterrit
// quand on en a un qui ne sert pas encore.
export default defineNuxtRouteMiddleware(async () => {
    const user = useSupabaseUser();
    if (!user.value) {
        return navigateTo("/login");
    }

    const { isApproved, loadProfile } = useProfile();
    await loadProfile();

    // Le repli de `useProfile` est fermé : profil absent ou illisible → non approuvé. Un compte
    // légitime bloqué par une panne de lecture voit `/pending`, qui l'invite à réessayer ; c'est
    // préférable à une timeline vide qui ressemble à une perte de données.
    if (!isApproved.value) {
        return navigateTo("/pending");
    }
})
