// Qui est « en salle » — règles pures, testables sans monter Nuxt.
//
// Leurs erreurs sont silencieuses : un film retiré à tort disparaît sans un mot, un film gardé à tort
// occupe le rail avec zéro séance. D'où la discipline commune — **trois issues, jamais deux** : oui,
// non, et « on ne sait pas ».

// Le film joue-t-il d'après le relevé d'**une** journée ? `null` = on ne sait pas — le confondre avec
// « plus à l'affiche » retirerait un film sur un hoquet réseau, et la panne d'un jour se paierait sept.
export const playingWithin = (payload, horizon) => {
    if (!payload || payload.error) return null;

    // ⚠️ Les salles reportées (`unconfirmedSince`) ne comptent pas : elles témoignent du passé. Les
    // croire maintiendrait un film « en salle » 48 h après sa déprogrammation.
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

// Verdict sur **l'horizon entier**. Sert à retirer un film sans attendre le contrôle hebdomadaire, qui
// laisserait sinon jusqu'au mercredi suivant un film parti le jeudi (constaté le 14/08/2026 sur quatre
// films). Ne lit que le cache déjà payé.
//
// ⚠️ Ne conclut `'gone'` que sur des preuves **complètes** : une journée manquante, en échec ou périmée
// suffit à rendre `'unknown'`.
export const horizonVerdict = (payloads, horizon) => {
    if (!payloads.length || payloads.some(p => !p || p.error || p.stale)) return 'unknown';
    return payloads.some(p => playingWithin(p, horizon) === true) ? 'plays' : 'gone';
};

// La source répond-elle normalement ? `payloadsByFilm` = un tableau de relevés **par film**.
//
// ⚠️ Garde indispensable avant tout retrait en masse : Allociné perd parfois un pan entier de sa grille
// (UGC Les Halles, 13/08/2026, cf. README), ce qui rendrait `'gone'` pour tous les films d'un coup. Si
// aucun film ne joue nulle part sur sept jours, ce n'est pas l'affiche qui est vide, c'est notre
// lecture qui est fausse.
export const sourceLooksAlive = (payloadsByFilm) =>
    payloadsByFilm.some(payloads =>
        payloads.some(p => p?.theaters?.some(t => !t.unconfirmedSince)));
