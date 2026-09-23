// Une URL de tiers est-elle sûre à poser dans un `href` ?
//
// **Source unique**, app et serveur. Ce test existait déjà — en double, et à un seul bout de la
// chaîne : `server/utils/allocine.js` filtrait le schéma **à l'ingestion**, avec ce commentaire qui
// disait juste :
//
//   « Le schéma est validé ici, à l'entrée : cette URL vient d'un tiers et finit dans un `href`.
//     Vue ne filtre pas les schémas — un `javascript:` dans le payload s'exécuterait au clic. »
//
// ⚠️ Le raisonnement était bon et la garde mal placée. Filtrer à l'ingestion ne protège que ce qui
// **passe** par l'ingestion. Tout ce qui est déjà en base, ou qui y entre autrement, arrive au `href`
// sans avoir croisé ce test — c'est exactement ce qu'a montré la revue de sécurité du 22/09/2026 :
// une écriture directe dans `showtimes_cache` court-circuitait `allocine.js` et plaçait l'URL de son
// choix dans la billetterie affichée à l'autre utilisateur.
//
// La migration `2609231006` ferme cette écriture. Ce fichier ferme le sink, et les deux sont
// nécessaires : la première empêche d'y entrer, le second fait que ça ne servirait à rien. Les
// sources restent des tiers (Allociné, UGC, Dulac, MK2, Letterboxd) même sans attaquant — une URL
// hostile n'a pas besoin d'un compte pour arriver là.
//
// ⚠️ Aucune dépendance, volontairement : `shared/` doit rester chargeable depuis n'importe où, y
// compris un script Node nu.

// Liste blanche, jamais une liste noire. `javascript:` et `data:` sont les deux qu'on cite, mais ce
// sont loin d'être les seuls schémas exécutables ou surprenants (`vbscript:`, `blob:`, `filesystem:`,
// et ceux qu'un navigateur ajoutera demain). Énumérer ce qu'on refuse, c'est s'engager à tenir la
// liste à jour ; énumérer ce qu'on accepte, non.
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
