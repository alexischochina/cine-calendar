// Tests des règles pures de la vue « Séances ».
//
//   node scripts/test-seances-rules.mjs
//
// Le projet n'a pas de suite de tests, et en monter une pour trois fichiers serait disproportionné.
// Mais ces règles-là ont deux caractéristiques qui les rendent dangereuses : elles sont **pures**
// (donc triviales à tester) et leurs erreurs sont **silencieuses** — un cache qui perd une salle,
// un film qui reste « en salle » de trop, un mercredi mal calculé ne lèvent aucune exception, ils
// affichent simplement quelque chose de faux.
//
// Trois familles, toutes importées depuis le code réel (aucune copie) :
//   1. `carryOverMissing`  — report des salles disparues (server/utils/showtimesFreshness.js)
//   2. `cineWeek`          — semaine ciné partagée app/serveur/scripts (shared/utils/cineWeek.js)
//   3. `seancesGrouping`   — filtres, tri, regroupements (app/utils/seancesGrouping.js)
//
// Sort en code 1 au premier échec, pour être branchable sur un hook ou une CI.

import { carryOverMissing } from '../server/utils/showtimesFreshness.js';
import { isoDay, lastWednesday, SEANCES_HORIZON_DAYS } from '../shared/utils/cineWeek.js';
import {
    applyFilters, groupByFilm, groupByCinema, countShowtimes,
    isCardEligible, arrondissementFromZip, arrondissementLabel,
} from '../app/utils/seancesGrouping.js';

let pass = 0, fail = 0;

const t = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}`);
    if (!ok) {
        console.log(`      attendu : ${JSON.stringify(want)}`);
        console.log(`      obtenu  : ${JSON.stringify(got)}`);
        fail++;
    } else pass++;
};

const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();

// --- 1. Report des salles disparues -------------------------------------------------------------
console.log('\n\x1b[1mcarryOverMissing — ne jamais appauvrir en silence\x1b[0m');
{
    const T = (code, extra = {}) => ({ code, name: code, zip: '75001', showtimes: [{ time: '20:00' }], ...extra });
    const lastSeen = hoursAgo(1);

    let r = carryOverMissing([T('A'), T('B')], [T('A')], lastSeen);
    t('salle disparue → reportée, marquée à la date du dernier relevé',
        r.map(x => [x.code, x.unconfirmedSince === lastSeen]), [['B', true]]);
    t('   … avec ses horaires', r[0]?.showtimes, [{ time: '20:00' }]);

    t('disparue depuis 49 h → abandonnée',
        carryOverMissing([T('B', { unconfirmedSince: hoursAgo(49) })], [], lastSeen), []);

    const since10 = hoursAgo(10);
    t('disparue depuis 10 h → conservée, date d\'origine NON rafraîchie',
        carryOverMissing([T('B', { unconfirmedSince: since10 })], [], lastSeen).map(x => x.unconfirmedSince), [since10]);

    t('salle revenue → aucun report (la version fraîche gagne, sans marqueur)',
        carryOverMissing([T('B', { unconfirmedSince: since10 })], [T('B')], lastSeen), []);

    t('pas de cache précédent → rien à reporter', carryOverMissing(undefined, [T('A')], lastSeen), []);

    t('source entièrement vide → tout est reporté (le cas de la panne)',
        carryOverMissing([T('A'), T('B'), T('C')], [], hoursAgo(2)).map(x => x.code), ['A', 'B', 'C']);
}

// --- 2. Semaine ciné ----------------------------------------------------------------------------
console.log('\n\x1b[1mcineWeek — repères partagés app / serveur / scripts\x1b[0m');
{
    t('isoDay(0) a le format YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(isoDay(0)), true);
    t('isoDay accepte un offset négatif', isoDay(-1) < isoDay(0), true);
    t('isoDay(6) est le dernier jour de la fenêtre', isoDay(SEANCES_HORIZON_DAYS - 1) > isoDay(0), true);

    const w = new Date(lastWednesday());
    t('lastWednesday tombe un mercredi', w.getDay(), 3);
    t('   … à minuit', [w.getHours(), w.getMinutes(), w.getSeconds()], [0, 0, 0]);
    t('   … et dans les 7 derniers jours', Date.now() - w.getTime() < 7 * 24 * 3600 * 1000, true);
}

// --- 3. Filtres, tri, regroupements -------------------------------------------------------------
console.log('\n\x1b[1mseancesGrouping — filtre carte, ordre des salles, buckets\x1b[0m');
{
    const show = (time, version = 'VO', projection = []) => ({ time, startsAt: `2026-08-13T${time}:00`, version, projection });
    const entry = (movieId, code, { ugc = true, fav = false, arr = 1, times = [show('20:00')] } = {}) => ({
        movie: { id: movieId, title: `film ${movieId}` },
        cinema: { code, name: code, acceptsUgc: ugc, favorite: fav, arrondissement: arr },
        showtimes: times,
    });

    const all = { card: false, arrondissement: 'all', version: 'all' };

    t('filtre carte : salle non acceptante écartée',
        applyFilters([entry(1, 'A'), entry(2, 'B', { ugc: false })], { ...all, card: true }).length, 1);

    t('filtre carte : séance IMAX écartée même en salle acceptante',
        applyFilters([entry(1, 'A', { times: [show('20:00', 'VO', ['IMAX'])] })], { ...all, card: true }).length, 0);

    t('   … mais gardée si le filtre carte est levé',
        applyFilters([entry(1, 'A', { times: [show('20:00', 'VO', ['IMAX'])] })], all).length, 1);

    t('filtre version : ne garde que la VO',
        countShowtimes(applyFilters([entry(1, 'A', { times: [show('18:00', 'VO'), show('20:00', 'VF')] })],
            { ...all, version: 'VO' })), 1);

    t('filtre arrondissement : compare en nombre, pas en chaîne',
        applyFilters([entry(1, 'A', { arr: 6 })], { ...all, arrondissement: '6' }).length, 1);

    t('entrée vidée de ses séances par les filtres → retirée',
        applyFilters([entry(1, 'A', { times: [show('20:00', 'VF')] })], { ...all, version: 'VO' }), []);

    // Ordre : favori d'abord, puis arrondissement, puis nom.
    const ordered = groupByCinema([
        entry(1, 'Zèbre', { arr: 2 }),
        entry(1, 'Alpha', { arr: 9 }),
        entry(1, 'Oméga', { arr: 20, fav: true }),
    ]).map(b => b.cinema.code);
    t('« Par cinéma » : favori en tête, puis arrondissement croissant', ordered, ['Oméga', 'Zèbre', 'Alpha']);

    const grouped = groupByFilm([entry(7, 'A'), entry(7, 'B'), entry(9, 'C')]);
    t('« Par film » : un bucket par film', grouped.map(b => b.key), ['f7', 'f9']);
    t('   … avec le compte de séances du bucket', grouped[0].nbSeances, 2);

    t('salle sans arrondissement connu → reléguée en fin de liste',
        groupByCinema([entry(1, 'Connue', { arr: 3 }), { ...entry(1, 'Inconnue'), cinema: { code: 'Inconnue', name: 'Inconnue', acceptsUgc: true, favorite: false, arrondissement: null } }])
            .map(b => b.cinema.code), ['Connue', 'Inconnue']);

    // Détails de format
    t('avant-première exclue de la carte', isCardEligible({ isPreview: true, projection: [] }), false);
    t('format inconnu → éligible (on n\'exclut pas par défaut)', isCardEligible({ projection: ['NUMERIQUE'] }), true);
    t('75116 (Passy) reconnu comme 16e', arrondissementFromZip('75116'), 16);
    t('75001 reconnu comme 1er', arrondissementFromZip('75001'), 1);
    t('code postal hors Paris → null', arrondissementFromZip('92100'), null);
    t('libellé du 1er arrondissement', arrondissementLabel(1), '1er');
    t('libellé du 6e arrondissement', arrondissementLabel(6), '6e');
}

console.log(`\n${pass} passé(s), ${fail} échoué(s)`);
process.exit(fail ? 1 : 0);
