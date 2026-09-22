// La ville de l'appelant, sur le chemin chaud.
//
// `refresh.js` obtient la ville gratuitement : `requireUser` lit déjà le profil pour vérifier
// l'approbation, et la rend dans `{ user, profile }`. Mais `showtimes.js` — la lecture groupée du
// cache — n'appelle **pas** `requireUser`, et c'est délibéré : c'est le chemin le plus chaud du
// projet, une garde y coûterait un aller-retour d'authentification par affichage (cf. l'en-tête de
// `rateLimit.js`). Il lui faut pourtant la ville, sans quoi il lirait la mauvaise partition du cache.
//
// == Pourquoi jamais depuis la query string ====================================================
//
// Ce serait le plus simple, et c'est justement l'erreur. Deux raisons, dont la seconde est la plus
// concrète :
//
//   1. Un paramètre libre laisse n'importe quel appelant désigner n'importe quelle ville, donc
//      faire préchauffer et servir des partitions qu'il n'utilise pas. Sur `refresh`, qui sort chez
//      Allociné, c'est directement le risque que `requireUser` a été écrit pour fermer.
//   2. **Les deux routes doivent s'accorder.** `showtimes` répond « voici le frais, voilà ce qui
//      manque », et le client rappelle `refresh` pour ce qui manque. Si la lecture se fait sur une
//      ville et le rafraîchissement sur une autre, l'entrée écrite n'est jamais celle qui était
//      cherchée : `missing` revient identique à chaque tour, et le client boucle sur Allociné
//      indéfiniment — sans erreur, juste une facture.
//
// La ville vient donc de `profiles`, des deux côtés.
//
// == Le coût, et comment il est tenu ============================================================
//
// Une lecture de `profiles` par affichage annulerait l'économie que `showtimes.js` a été découpé
// pour obtenir (mesuré : 14+14 requêtes → 1+1). D'où ce mémo en mémoire d'instance, calqué sur le
// compteur de `rateLimit.js` : même durée de vie, mêmes limites assumées.
//
// ⚠️ Ce que ça ne vaut pas, dit ici comme dans `rateLimit.js` : le mémo vit en mémoire d'instance,
// plusieurs instances servent en parallèle, tout repart au cold start. Ce n'est pas un cache de
// cohérence — c'est une économie. La conséquence d'un mémo périmé est bornée et bénigne : un
// changement de ville met au plus `TTL` à être pris en compte, et le changement de ville n'est même
// pas exposé par l'application (hors périmètre du plan).

import { createHash } from 'node:crypto';
import { serverSupabaseClient } from '#supabase/server';

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

    const client = await serverSupabaseClient(event);
    const { data, error } = await client.from('profiles').select('city').maybeSingle();

    if (error) {
        console.error('[cities] Profil illisible, repli sur', DEFAULT_CITY, '—', error.message);
        return DEFAULT_CITY;
    }

    const city = cityOf(data?.city);
    memo.set(key, { city, expiresAt: now + TTL });
    return city;
};
