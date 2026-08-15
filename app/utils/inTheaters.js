// Qui est « en salle » — les règles pures, extraites de `useInTheatersSync` pour être testables sans
// monter Nuxt (`scripts/test-seances-rules.mjs`). Le composable ne garde que l'état, le réseau et les
// écritures.
//
// Ces verdicts décident de ce qui apparaît dans le rail et de ce que la vue Séances sait montrer. Leurs
// erreurs sont silencieuses : un film retiré à tort disparaît sans un mot, un film gardé à tort occupe
// le rail avec zéro séance. D'où la discipline commune aux deux fonctions — **trois issues, jamais
// deux** : oui, non, et « on ne sait pas ».

// Le film joue-t-il d'après le relevé d'**une** journée ?
//
// `null` = on ne sait pas, et c'est le cas qui compte : le confondre avec « plus à l'affiche »
// retirerait un film du rail sur un simple hoquet réseau, et il n'y reviendrait qu'une semaine plus
// tard — la panne d'un jour se paierait sept.
export const playingWithin = (payload, horizon) => {
    if (!payload || payload.error) return null;

    // ⚠️ Les salles reportées (`unconfirmedSince`, cf. `carryOverMissing`) ne comptent pas : elles
    // témoignent du passé, pas de l'affiche. Les prendre pour argent comptant maintiendrait un film
    // « en salle » 48 h de plus après sa déprogrammation — exactement le défaut collant qu'on a
    // corrigé. Elles restent visibles dans la vue, marquées ; elles ne décident de rien.
    if (payload.theaters?.some(t => !t.unconfirmedSince)) return true;
    // Aucune séance aujourd'hui **et** horaires servis depuis une entrée périmée : c'est le cas où
    // le vide n'est pas une information.
    if (payload.stale) return null;

    // Allociné livre `nextDate` quand il n'y a rien ce jour-là : un film qui ne joue que le week-end
    // (ou qui ressort mercredi) est bien en salle cette semaine.
    const next = String(payload.nextDate ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) return next <= horizon;
    return false;
};

// Verdict sur **l'horizon entier**, à partir des relevés de toutes ses journées.
//
// Sert à retirer un film sans attendre le contrôle hebdomadaire. Le contrôle ne tourne qu'une fois par
// semaine ciné : un film qui quitte l'affiche le jeudi reste dans le rail jusqu'au mercredi suivant,
// avec zéro séance à montrer. Constaté le 14/08/2026 sur quatre films — *Silent Friend*,
// *Plus fort que moi*, *The Plague*, *L'Inconnu de la Grande Arche* — tous contrôlés et légitimement
// gardés le 12/08 à 23:10, donc **après** le mercredi qui sert de gate.
//
// La preuve de leur départ était pourtant déjà en cache : sept journées chargées, zéro salle
// intra-muros partout. Cette fonction ne fait que lire ce qu'on a déjà payé.
//
// ⚠️ Elle ne conclut `'gone'` que sur des preuves **complètes**. Une seule journée manquante, en échec
// ou servie depuis du périmé, et le verdict est `'unknown'` : mieux vaut garder un film de trop
// quelques jours que d'en retirer un sur une lacune.
export const horizonVerdict = (payloads, horizon) => {
    if (!payloads.length || payloads.some(p => !p || p.error || p.stale)) return 'unknown';
    return payloads.some(p => playingWithin(p, horizon) === true) ? 'plays' : 'gone';
};

// La source répond-elle normalement ? `payloadsByFilm` = un tableau de relevés **par film**.
//
// ⚠️ Garde indispensable avant tout retrait en masse. `horizonVerdict` conclut « parti » sur des
// journées franchement vides — mais Allociné perd parfois un pan entier de sa grille : le README
// documente la disparition d'UGC Les Halles le 13/08/2026, salle pleine, absente de la source pendant
// des heures. Un tel trou rendrait `'gone'` pour tous les films concernés, et le retrait est plus
// violent qu'une page vide : le film sort du rail et n'y revient qu'au prochain mercredi.
//
// Le signal choisi est le plus simple qui soit honnête : **au moins un film du lot joue quelque part**.
// Si aucun ne joue nulle part sur sept jours, ce n'est pas l'affiche parisienne qui est vide, c'est
// notre lecture qui est fausse — et on ne touche à rien.
export const sourceLooksAlive = (payloadsByFilm) =>
    payloadsByFilm.some(payloads =>
        payloads.some(p => p?.theaters?.some(t => !t.unconfirmedSince)));
