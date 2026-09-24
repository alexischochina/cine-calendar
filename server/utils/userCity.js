// La ville de l'appelant, sur le chemin chaud.
//
// `refresh.js` l'obtient gratuitement : `requireUser` lit déjà le profil pour vérifier
// l'approbation. `showtimes.js` — la lecture groupée — n'appelle **pas** `requireUser`, et c'est
// délibéré : une garde y coûterait un aller-retour d'authentification par affichage (cf. l'en-tête
// de `rateLimit.js`). Il lui faut pourtant la ville, sans quoi il lirait la mauvaise partition.
//
// ⚠️ **Jamais depuis la query string.** D'abord parce qu'un paramètre libre laisse désigner
// n'importe quelle ville. Surtout parce que `showtimes` répond « voilà ce qui manque » et que le
// client rappelle `refresh` pour ce manque : si les deux ne s'accordent pas sur la ville, l'entrée
// écrite n'est jamais celle qui était cherchée et le client boucle sur Allociné indéfiniment.
//
// ⚠️ Le mémo vit en mémoire d'instance, comme le compteur de `rateLimit.js` : plusieurs instances,
// tout repart au cold start. C'est une économie, pas un cache de cohérence — un changement de ville
// met au plus `TTL` à être pris en compte.

import { createHash } from 'node:crypto';
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server';

const TTL = 5 * 60 * 1000;

// Même raisonnement que `SWEEP_AT` dans `rateLimit.js` : borner la mémoire sans minuteur, qui
// survivrait mal au gel d'instance entre deux requêtes.
const SWEEP_AT = 500;

const memo = new Map();

const sweep = (now) => {
    for (const [key, entry] of memo) if (entry.expiresAt <= now) memo.delete(key);
};

// Clé du mémo : l'empreinte des cookies de session Supabase.
//
// ⚠️ Une **empreinte**, jamais le jeton lui-même : un jeton de session en clair dans une `Map` de
// process est un secret qui traîne, lisible dans un dump mémoire ou un heap snapshot. Le hachage ne
// coûte rien et retire complètement la question.
//
// ⚠️ Et ce jeton ne sert **qu'**à indexer le mémo — il n'est ni décodé, ni cru sur parole. C'est le
// client de session qui authentifie, et RLS qui décide quelle ligne de `profiles` sort. Un jeton
// forgé ne donne donc rien : la requête ci-dessous rend zéro ligne, et on retombe sur la ville par
// défaut.
const sessionKey = (event) => {
    const cookies = parseCookies(event);
    const material = Object.keys(cookies)
        .filter(name => name.startsWith('sb-'))
        .sort()
        .map(name => `${name}=${cookies[name]}`)
        .join('|');

    return material ? createHash('sha256').update(material).digest('hex') : null;
};

// Ville de l'appelant, avec repli sur `DEFAULT_CITY`.
//
// Le repli couvre trois cas qui se ressemblent et qu'on traite pareil, faute de pouvoir mieux :
// visiteur sans session, profil absent (migration pas jouée), lecture en échec. Dans les trois cas
// Paris est le bon défaut — c'est l'état du monde avant ce chantier, et toutes les lignes de cache
// antérieures sont parisiennes.
//
// ⚠️ Repli **silencieux et sans conséquence de sécurité** : cette fonction ne garde rien. Elle
// choisit une partition de cache d'horaires publics. Ce qui protège la donnée, c'est RLS ; ce qui
// protège la dépense, c'est `rateLimit` sur cette route et `requireUser` sur celles qui sortent.
export const cityForRequest = async (event) => {
    const key = sessionKey(event);
    if (!key) return DEFAULT_CITY;

    const now = Date.now();
    if (memo.size > SWEEP_AT) sweep(now);

    const cached = memo.get(key);
    if (cached && cached.expiresAt > now) return cached.city;

    // ⚠️⚠️ **Le filtre par propriétaire n'est pas facultatif.** Depuis les listes partagées,
    // `profiles` rend plusieurs lignes à un compte approuvé : sans lui, `maybeSingle()` rend une
    // erreur, le repli ci-dessous s'applique, et **un compte troyen se voit servir Paris en
    // silence** — alors que la ville décide de la localisation Allociné, du filtre de salles et de la
    // clé de cache.
    //
    // ⚠️ L'en-tête du fichier tient toujours : le mémo est consulté **avant**, donc
    // `serverSupabaseUser` n'est appelée qu'au plus une fois par session et par `TTL`. Elle lève sur
    // un jeton illisible, d'où le `try`. `sub ?? id` : mêmes claims que dans `requireUser`.
    let userId = null;
    try {
        const user = await serverSupabaseUser(event);
        userId = user?.sub ?? user?.id ?? null;
    } catch {
        userId = null;
    }

    if (!userId) return DEFAULT_CITY;

    const client = await serverSupabaseClient(event);
    const { data, error } = await client
        .from('profiles')
        .select('city')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('[cities] Profil illisible, repli sur', DEFAULT_CITY, '—', error.message);
        return DEFAULT_CITY;
    }

    const city = cityOf(data?.city);
    memo.set(key, { city, expiresAt: now + TTL });
    return city;
};
