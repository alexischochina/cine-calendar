// Les règles pures des listes partagées. Sans dépendance ni auto-import : importable depuis l'app
// comme depuis un script Node nu, ce qui permet aux tests de l'atteindre sans monter Nuxt.

// Le slug d'URL d'une liste. **Source unique** : l'URL, la résolution de la route et le libellé
// d'onglet en sortent tous. Une seconde écriture ferait une route qui ne trouve jamais son profil.
//
// ⚠️ La base n'impose l'unicité que sur `lower(display_name)` : « Jean-Éric » et « Jean Eric »
// produisent le même slug sans qu'elle les refuse. `useSharedLists` tranche et le signale.
export const listSlug = (displayName) => String(displayName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// L'initiale de l'avatar. Repli sur `?` : un rond vide se lit comme un chargement en cours.
export const listInitial = (displayName) => {
    const first = String(displayName ?? '').trim().charAt(0);
    return first ? first.toLocaleUpperCase('fr-FR') : '?';
};

// Les films de `theirs` que je n'ai pas — la bascule et le compteur de l'onglet.
//
// ⚠️ Comparaison sur `movie_id` et **jamais sur le titre** : deux films homonymes se confondraient,
// et un même film sous son titre original et son titre français ne se reconnaîtrait pas.
//
// ⚠️ `Number()` des deux côtés : l'identifiant transite par des URL et des `String()` ailleurs dans
// le projet, et un `'123' !== 123` produirait un « tu ne l'as pas » faux sur toute la liste.
//
// Une ligne sans identifiant exploitable est comptée comme manquante : la montrer laisse
// l'arbitrage à l'utilisateur, la masquer déciderait à sa place sur une donnée abîmée.
export const missingFrom = (theirs, mine) => {
    const owned = new Set(
        (mine ?? []).map(m => Number(m?.movie_id)).filter(Number.isFinite)
    );

    return (theirs ?? []).filter(film => {
        const id = Number(film?.movie_id);
        return !Number.isFinite(id) || !owned.has(id);
    });
};

// Le sous-titre de l'en-tête : « 34 films · 12 que tu n'as pas ». Les deux cas particuliers ne sont
// pas décoratifs — « 0 que tu n'as pas » se lit comme un compteur cassé, « 0 films » comme une
// erreur de chargement.
export const sharedListStat = (total, missing) => {
    const n = Number(total) || 0;
    const m = Number(missing) || 0;

    if (!n) return 'Liste vide';

    const films = `${n} film${n > 1 ? 's' : ''}`;
    return m ? `${films} · ${m} que tu n'as pas` : `${films} · tu les as tous`;
};
