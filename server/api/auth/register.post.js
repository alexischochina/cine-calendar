// Inscription : `POST /api/auth/register  { email, password, city }`
//
// ⚠️ **La seule route publique du projet qui écrit.** Toutes les autres, ou bien lisent un cache
// (`showtimes`, `events`), ou bien exigent un compte approuvé (`requireUser`). Celle-ci crée un
// compte pour quelqu'un qui n'en a pas encore — elle ne peut donc pas se garder par une session, et
// c'est ce qui impose tout ce qui suit.
//
// == Pourquoi le compte est créé ici, et pas par `signUp` côté navigateur ========================
//
// Parce qu'un compte et son profil doivent naître **ensemble**. Avec `signUp` côté client puis un
// appel pour poser le profil, une coupure entre les deux laisse un compte `auth.users` sans ligne
// `profiles` : `requireUser` le refuse (profil absent = non approuvé, c'est voulu), le middleware de
// page l'envoie sur `/pending`, et il y reste pour toujours — sans que personne ne sache pourquoi,
// puisque rien n'a échoué visiblement. Il faudrait alors réparer à la main en base.
//
// Ici, les deux écritures sont enchaînées côté serveur et la seconde nettoie la première si elle
// échoue. Ce n'est pas une transaction — l'API d'administration Supabase n'en offre pas — mais
// l'état incohérent est rattrapé plutôt que laissé.
//
// == `approved` n'est jamais lu depuis la requête ================================================
//
// Le corps ne porte que `email`, `password`, `city`. Le drapeau est écrit en dur à `false` plus bas.
// C'est la deuxième ligne de défense après l'absence de policy d'écriture sur `profiles`
// (cf. `2609221212-add-profiles.sql`) : même en forgeant le corps, on ne s'approuve pas soi-même.

import { serverSupabaseServiceRole } from '#supabase/server';

// Strict, et volontairement plus sévère que la route : elle crée des comptes, pas des requêtes de
// lecture. 5 par minute et par IP couvre largement l'usage réel (une inscription, peut-être deux si
// la première échoue) et ferme la création en boucle.
const RATE = { max: 5 };

// Validation d'e-mail volontairement grossière : la seule vérification qui vaille est l'envoi d'un
// message, et ce n'est pas le rôle de cette route. On écarte ce qui n'est manifestement pas une
// adresse, Supabase tranche le reste.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supabase impose 6 caractères par défaut. On demande 8 : c'est un compte qui reste ouvert un an
// (cf. `cookieOptions.maxAge` dans `nuxt.config.ts`), autant qu'il ne tienne pas sur un mot du
// dictionnaire. Pas de règle de composition — elles poussent aux mots de passe notés sur un papier.
const MIN_PASSWORD = 8;

export default defineEventHandler(async (event) => {
    rateLimit(event, RATE);

    const body = await readBody(event);
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const city = String(body?.city ?? '');

    if (!EMAIL.test(email)) {
        throw createError({ statusCode: 400, statusMessage: 'Adresse e-mail invalide' });
    }
    if (password.length < MIN_PASSWORD) {
        throw createError({ statusCode: 400, statusMessage: `Mot de passe trop court (${MIN_PASSWORD} caractères minimum)` });
    }
    // ⚠️ `isCityKey` et non `cityOf` : ici on **rejette** une ville inconnue au lieu de replier sur
    // Paris. Le repli a du sens en lecture, où il vaut mieux montrer quelque chose ; à l'inscription
    // il donnerait silencieusement la mauvaise ville à quelqu'un qui a cliqué sur l'autre.
    if (!isCityKey(city)) {
        throw createError({ statusCode: 400, statusMessage: 'Ville inconnue' });
    }

    const admin = serverSupabaseServiceRole(event);

    // `email_confirm: true` : pas de courriel de confirmation, parce que la confirmation ici n'est
    // pas l'adresse — c'est Alexis. Un compte confirmé mais non approuvé ne peut toujours rien faire
    // (cf. `requireUser`), et ça évite d'avoir à configurer un SMTP pour une application fermée à
    // deux comptes.
    const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });

    if (error) {
        // ⚠️ Le message de Supabase n'est pas renvoyé tel quel : sur une adresse déjà prise, il le
        // dit, ce qui transforme cette route en oracle permettant de tester si une adresse a un
        // compte ici. On répond la même chose dans tous les cas, et le détail part dans les logs.
        console.error('[auth] Création de compte échouée pour', email, '—', error.message);
        throw createError({ statusCode: 400, statusMessage: 'Inscription impossible avec ces informations.' });
    }

    const userId = data?.user?.id;
    if (!userId) {
        console.error('[auth] Création de compte sans identifiant renvoyé pour', email);
        throw createError({ statusCode: 502, statusMessage: 'Inscription impossible pour le moment.' });
    }

    // ⚠️ `approved: false` écrit ici, jamais lu du corps de la requête. C'est la serrure.
    const { error: profileError } = await admin
        .from('profiles')
        .insert({ user_id: userId, city, approved: false });

    if (profileError) {
        // Compte créé mais profil absent : l'état exactement inutilisable décrit en tête. On défait
        // la création plutôt que de laisser quelqu'un avec des identifiants qui ne mèneront jamais
        // nulle part, et on lui dit de réessayer.
        console.error('[auth] Profil non créé pour', userId, '—', profileError.message, '— compte annulé.');
        const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
        if (cleanupError) {
            // Le nettoyage a échoué à son tour : il reste un compte orphelin, et il faut le dire
            // fort, c'est la seule trace qu'on en aura.
            console.error('[auth] ⚠️ Compte orphelin', userId, '(', email, ') — profil absent et suppression échouée:', cleanupError.message);
        }
        throw createError({ statusCode: 503, statusMessage: 'Inscription impossible pour le moment, réessaie dans un instant.' });
    }

    console.log('[auth] Compte créé, en attente d\'approbation :', email, `(${city})`);

    // Rien de l'utilisateur ne sort d'ici — pas d'identifiant, pas de session. Le compte n'est pas
    // utilisable tant qu'il n'est pas approuvé ; le client affiche `/pending`.
    return { pending: true };
});
