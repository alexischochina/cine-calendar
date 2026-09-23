// Une URL de tiers est-elle sûre à poser dans un `href` ?
//
// **Source unique**, app et serveur. Le test vivait dans `server/utils/allocine.js`, à l'ingestion
// seulement — ce qui ne protège que ce qui passe par l'ingestion. Tout ce qui est déjà en base
// arrivait au `href` sans l'avoir croisé.
//
// ⚠️ Liste blanche, jamais une liste noire. `javascript:` et `data:` sont les deux qu'on cite, mais
// il y a aussi `vbscript:`, `blob:`, `filesystem:`, et ceux qu'un navigateur ajoutera. Énumérer ce
// qu'on refuse, c'est s'engager à tenir la liste à jour ; énumérer ce qu'on accepte, non.
//
// ⚠️ Aucune dépendance : `shared/` doit rester chargeable depuis un script Node nu.

const SAFE_SCHEMES = ['http:', 'https:'];

// Rend l'URL si elle est sûre, `null` sinon. `null` et non une chaîne vide : les appelants testent
// déjà la présence (`v-if="row.note?.url"`, `:is="showtime.booking ? 'a' : 'span'"`), donc une URL
// refusée retombe naturellement sur le rendu « sans lien » plutôt que sur un lien mort.
//
// ⚠️ Les URL relatives sont refusées, et c'est voulu : toutes les URL concernées viennent de tiers et
// sont absolues. Accepter le relatif obligerait à fournir une base, donc à faire des hypothèses sur
// le contexte d'appel — côté serveur il n'y en a pas.
export const safeUrl = (value) => {
    if (typeof value !== 'string' || !value) return null;

    try {
        return SAFE_SCHEMES.includes(new URL(value).protocol) ? value : null;
    } catch {
        // `new URL` lève sur tout ce qui n'est pas une URL absolue valide. Une entrée qu'on ne sait
        // pas analyser est une entrée qu'on ne pose pas dans un `href`.
        return null;
    }
};
