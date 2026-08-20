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
// Onze familles, toutes importées depuis le code réel (aucune copie) :
//   1. `carryOverMissing`     — report des salles disparues (server/utils/showtimesFreshness.js)
//   2. `cineWeek`             — semaine ciné partagée app/serveur/scripts (shared/utils/cineWeek.js)
//   3. `seancesGrouping`      — filtres, tri, regroupements (app/utils/seancesGrouping.js)
//   4. plage horaire          — créneaux, bornes, séances de nuit (app/utils/seancesGrouping.js)
//   5. `showtimeEventLabels`  — tags Allociné → libellés d'événement (server/utils/allocine.js)
//   6. `seanceEvents`         — règles des séances événement (app/utils/seanceEvents.js)
//   7. `exploitants`          — libellés Dulac / MK2 / UGC (server/utils/{dulac,mk2,ugc,…}.js)
//   8. `inTheaters`           — qui est « en salle » (app/utils/inTheaters.js)
//   9. gardes                 — schéma PostgREST et dates locales (shared/utils, app/utils)
//  10. `movieSearch`         — quel film la recherche ouvre dans la timeline (app/utils/movieSearch.js)
//  11. `movieFilters`        — quels filtres masquent un film (app/utils/movieFilters.js)
//  12. `viewport`           — la ligne est-elle déjà à l'écran ? (app/utils/viewport.js)
//
// Sort en code 1 au premier échec, pour être branchable sur un hook ou une CI.

import { carryOverMissing, isShowtimesFresh } from '../server/utils/showtimesFreshness.js';
import { pruneSnapshot, stampForDisplay } from '../app/utils/seancesSnapshot.js';
import { isoDay, lastWednesday, lastWednesdayDay, SEANCES_HORIZON_DAYS } from '../shared/utils/cineWeek.js';
import {
    applyFilters, groupByFilm, groupByCinema, countShowtimes,
    isCardEligible, arrondissementFromZip, arrondissementLabel,
    minutesOfShowtime, slotRange, inTimeRange, rangeLabel, timeLabel, sanitizeRange,
    countMatching, countMatchingEvents,
} from '../app/utils/seancesGrouping.js';
// ⚠️ `allocine.js` s'appuie sur des globales Nitro (`$fetch`, `promisePool`) — mais uniquement à
// l'intérieur de ses fonctions réseau, jamais au chargement du module. Les deux fonctions importées ici
// sont pures et s'importent donc telles quelles, sans monter Nuxt. Même arrangement que `tmdbDates.js`
// côté backfill.
import { showtimeEventLabels, isPreviewShowtime } from '../server/utils/allocine.js';
import { isDulacVenue, isMk2Venue, isKnownExhibitorVenue } from '../shared/utils/exhibitorVenues.js';
import { playingWithin, horizonVerdict, sourceLooksAlive } from '../app/utils/inTheaters.js';
import { matchingSlugs, parseDulacEvent, dulacEventDetail } from '../server/utils/dulac.js';
import { matchingMk2Slugs, mk2EventDetail } from '../server/utils/mk2.js';
import { ugcSessionId, parseUgcTiles, UGC_PARIS_CINEMAS } from '../server/utils/ugc.js';
import { mentionsDate, isEventHeadline, metaContent, truncateDetail } from '../server/utils/exhibitorText.js';
import {
    showtimeEvents, isEventShowtime, countEvents, eventLabelsOf, eventCountLabel,
    graftEvents, dayEventEntries, bookingsOf, mergeEventEntries, groupEventsByDay, entriesKey,
    movieEvents, nextMovieEvent, hasUpcomingEvent, eventChips, entryKinds, entryKey,
} from '../app/utils/seanceEvents.js';
import { isMissingSchema } from '../shared/utils/pgErrors.js';
import { hasDatedEventFrom, isSeanceFilm, isFreshRelease } from '../shared/utils/seanceScope.js';
import { parseLocalDate, daysBetween } from '../app/utils/localDate.js';
import { directorLinks, letterboxdPersonSlug } from '../app/utils/movieHelpers.js';
import { parseLetterboxdFilm, isLetterboxdDirectorUrl } from '../shared/utils/letterboxdFilm.js';
import { bestSearchMatch, closestToToday } from '../app/utils/movieSearch.js';
import { matchesFilters, blockingFilters } from '../app/utils/movieFilters.js';
import { isFullyVisible } from '../app/utils/viewport.js';

// --- Auto-imports simulés ------------------------------------------------------------------------
//
// Les fichiers testés vivent dans Nuxt ou Nitro, qui leur injectent `shared/utils/` sans `import` ;
// chargés en Node nu ils lèvent un `ReferenceError` loin de la cause. À compléter dès qu'un fichier
// testé ici lit un nouveau `shared/utils/`.
//
// ⚠️ **Ne pas "corriger" par un import relatif côté production** : Nitro résout ces chemins depuis son
// bundle, ce qui casse *toutes* les routes serveur d'un coup.
globalThis.isoDay = isoDay;                          // ← server/utils/showtimesFreshness.js
globalThis.lastWednesday = lastWednesday;            // ← server/utils/showtimesFreshness.js
globalThis.hasDatedEventFrom = hasDatedEventFrom;
// Idem pour `directorLinks` (app/utils/movieHelpers.js), qui revalide les URL stockées.
globalThis.isLetterboxdDirectorUrl = isLetterboxdDirectorUrl;    // ← app/utils/seanceEvents.js

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

    // Les deux repères doivent désigner **le même** mercredi : une reconversion maison par
    // `toISOString()` décalerait d'un jour le soir à Paris, et le périmètre sauterait un film.
    t('lastWednesdayDay a le format YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(lastWednesdayDay()), true);
    t('   … et désigne le même jour que lastWednesday',
        lastWednesdayDay(),
        `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`);
    t('   … jamais après aujourd\'hui', lastWednesdayDay() <= isoDay(0), true);
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

    const all = { card: false, range: null };

    t('filtre carte : salle non acceptante écartée',
        applyFilters([entry(1, 'A'), entry(2, 'B', { ugc: false })], { ...all, card: true }).length, 1);

    t('filtre carte : séance IMAX écartée même en salle acceptante',
        applyFilters([entry(1, 'A', { times: [show('20:00', 'VO', ['IMAX'])] })], { ...all, card: true }).length, 0);

    t('   … mais gardée si le filtre carte est levé',
        applyFilters([entry(1, 'A', { times: [show('20:00', 'VO', ['IMAX'])] })], all).length, 1);

    t('filtre horaire : ne garde que ce qui tombe dans la plage',
        countShowtimes(applyFilters([entry(1, 'A', { times: [show('11:00'), show('20:00')] })],
            { ...all, range: slotRange('morning') })), 1);

    t('entrée vidée de ses séances par les filtres → retirée',
        applyFilters([entry(1, 'A', { times: [show('20:00')] })], { ...all, range: slotRange('morning') }), []);

    // `countMatching` doit répondre exactement comme `countShowtimes(applyFilters(…))`, sans allouer.
    // Deux implémentations qui divergeraient rendraient les messages « N séances masquées » faux.
    {
        const list = [
            entry(1, 'A', { times: [show('11:00'), show('20:00'), show('22:00', 'VO', ['IMAX'])] }),
            entry(2, 'B', { ugc: false, times: [show('20:00')] }),
        ];
        const cases = [
            ['sans filtre', all],
            ['carte', { ...all, card: true }],
            ['plage', { ...all, range: slotRange('evening') }],
            ['carte + plage', { card: true, range: slotRange('evening') }],
        ];
        for (const [label, f] of cases) {
            t(`countMatching == countShowtimes(applyFilters) — ${label}`,
                countMatching(list, f), countShowtimes(applyFilters(list, f)));
        }
    }

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

// --- 4. Plage horaire ---------------------------------------------------------------------------
console.log('\n\x1b[1mplage horaire — créneaux, bornes, séances de nuit\x1b[0m');
{
    const at = (time) => ({ time });

    t('14:30 → 870 minutes', minutesOfShowtime(at('14:30')), 870);
    t('séance de nuit projetée après minuit (00:20 → 1460)', minutesOfShowtime(at('00:20')), 1460);
    t('horaire illisible → null', minutesOfShowtime(at('')), null);

    t('borne basse incluse : 12:00 est dans l\'après-midi', inTimeRange(at('12:00'), slotRange('afternoon')), true);
    t('borne haute exclue : 12:00 n\'est plus le matin', inTimeRange(at('12:00'), slotRange('morning')), false);
    t('08:00 est bien le matin', inTimeRange(at('08:00'), slotRange('morning')), true);
    t('20:00 est bien le soir', inTimeRange(at('20:00'), slotRange('evening')), true);

    t('séance de nuit gardée par « Soir » (borne haute à minuit = fin de soirée)',
        inTimeRange(at('00:20'), slotRange('evening')), true);
    t('   … et par une plage libre qui va jusqu\'à minuit',
        inTimeRange(at('00:20'), [20 * 60, 24 * 60]), true);
    t('   … mais pas par une plage libre qui s\'arrête avant',
        inTimeRange(at('00:20'), [14 * 60, 20 * 60]), false);

    t('aucune plage → tout passe', inTimeRange(at('03:00'), null), true);
    t('horaire illisible → gardé plutôt qu\'écarté', inTimeRange(at('n\'importe quoi'), slotRange('morning')), true);

    t('« Toutes » n\'a pas de plage', slotRange('all'), null);
    t('plage libre lue depuis `custom`', slotRange('custom', [840, 1200]), [840, 1200]);
    t('plage libre absente → aucune plage', slotRange('custom', null), null);
    t('un créneau nommé ignore la plage libre', slotRange('morning', [840, 1200]), [0, 12 * 60]);
    t('« Matin » part de minuit — aucune séance ne tombe entre deux créneaux',
        inTimeRange(at('07:30'), slotRange('morning')), true);

    t('libellé de plage', rangeLabel([840, 1200]), '14:00 – 20:00');
    t('libellé sans plage', rangeLabel(null), 'Toutes');
    t('minuit s\'écrit 24:00 en borne haute', timeLabel(24 * 60), '24:00');

    // Les trois créneaux nommés partitionnent la journée : aucune séance ne peut tomber entre deux.
    for (const time of ['00:10', '05:30', '07:30', '08:00', '11:59', '12:00', '17:59', '18:00', '23:50']) {
        const hit = ['morning', 'afternoon', 'evening'].filter(s => inTimeRange({ time }, slotRange(s)));
        t(`${time} tombe dans exactement un créneau nommé (${hit.join(',') || 'aucun'})`, hit.length, 1);
    }

    // Plage libre : seule entrée de forme libre de la chaîne, donc validée au seuil.
    t('plage inversée → refusée', sanitizeRange([1200, 840]), null);
    t('plage vide (bornes égales) → refusée', sanitizeRange([840, 840]), null);
    t('NaN → refusé plutôt que filtre muet', sanitizeRange([NaN, 1200]), null);
    t('chaînes numériques → acceptées et converties', sanitizeRange(['840', '1200']), [840, 1200]);
    t('bornes hors journée → ramenées dans la journée', sanitizeRange([-120, 5000]), [0, 24 * 60]);
    t('valeurs fractionnaires → arrondies', sanitizeRange([840.4, 1200.6]), [840, 1201]);
    t('forme inattendue → refusée', sanitizeRange('14:00-20:00'), null);
    t('plage libre invalide → aucun filtre appliqué', slotRange('custom', [1200, 840]), null);
}

// --- 5. Tags Allociné → libellés d'événement ----------------------------------------------------
//
// Le tri entre « qualifie la séance » et « décrit la projection » est le cœur de la fonctionnalité :
// trop large, le badge se pose sur 1 656 séances sur 2 293 et ne dit plus rien.
console.log('\n\x1b[1mshowtimeEventLabels — ce qui est un événement, et surtout ce qui n\'en est pas\x1b[0m');
{
    const labels = (tags, extra = {}) => showtimeEventLabels(extra, tags);

    t('séance ordinaire → aucun libellé', labels(['Format.Projection.Digital']), []);
    t('aucun tag → aucun libellé', labels([]), []);

    t('`isPreview` seul → avant-première', labels([], { isPreview: true }), ['Avant-première']);
    t('tag `Showtime.Event.Preview` seul → avant-première (vu sans le booléen)',
        labels(['Showtime.Event.Preview']), ['Avant-première']);
    t('les deux ensemble → un seul libellé, pas deux',
        labels(['Showtime.Event.Preview'], { isPreview: true }), ['Avant-première']);
    t('`isPreview: false` n\'invente rien', labels(['Format.Projection.Digital'], { isPreview: false }), []);

    // Le booléen qui décide de l'éligibilité carte, isolé des libellés d'affichage.
    t('avant-première par le booléen', isPreviewShowtime({ isPreview: true }, []), true);
    t('avant-première par le tag seul', isPreviewShowtime({}, ['Showtime.Event.Preview']), true);
    t('séance ordinaire', isPreviewShowtime({ isPreview: false }, ['Format.Projection.Digital']), false);
    t('séance vide → pas une avant-première', isPreviewShowtime(undefined, undefined), false);

    t('séance unique', labels(['Showtime.Event.OnlySession']), ['Séance unique']);
    t('label de programmation', labels(['BoostPos.XpEtLabels.JeunePublic']), ['Jeune public']);

    t('deux événements sur la même séance → les deux libellés',
        labels(['Showtime.Event.Preview', 'BoostPos.XpEtLabels.JeunePublic']),
        ['Avant-première', 'Jeune public']);

    // Le vocabulaire écarté, tag par tag : c'est ce test qui empêche le badge de se banaliser.
    for (const tag of [
        'Format.Projection.Digital', 'Format.Projection.Laser', 'Format.Projection.3d',
        'Format.Sound.Dolby71', 'Auditorium.Experience.4dx', 'Auditorium.Experience.DolbyAtmos',
        'Localization.Version.Original', 'Localization.Subtitle.French',
        'Showtime.Accessibility.Accessible', 'Showtime.Accessibility.Greta',
        'Theater.Service.DisabledAccess', 'BoostPos.Autres.PopCorn', 'BoostPos.Son.RenfortAuditif',
        'BoostPos.Accessibilite.AudioDescriptionAe',
    ]) {
        t(`${tag} n'est PAS un événement`, labels([tag]), []);
    }

    // Allociné élargit son vocabulaire : dans SON namespace d'événements, on nomme quand même plutôt
    // que de taire.
    t('membre inconnu de `Showtime.Event.*` → libellé lisible plutôt que silence',
        labels(['Showtime.Event.CineClub']), ['Cine club']);
    t('   … y compris sur un sigle', labels(['Showtime.Event.VOSTFR']), ['Vostfr']);

    // ⚠️⚠️ Le bug de production : `BoostPos.XpEtLabels.*` mélange programmation et **noms de salles**.
    // Deviner ses membres inconnus avait posé « Artet essai » sur 54 séances, « Diffusion salle le
    // club » sur 25… Liste blanche stricte, aucun repli.
    for (const [tag, want] of [
        ['BoostPos.XpEtLabels.ArtEtEssai', []],
        ['BoostPos.XpEtLabels.DiffusionSalleLeClub', []],
        ['BoostPos.XpEtLabels.Salle1YoussefChahine', []],
        ['BoostPos.XpEtLabels.SalleInfinite', []],
        ['BoostPos.XpEtLabels.Premier', []],
        ['BoostPos.XpEtLabels.StAnglais', []],
        ['BoostPos.XpEtLabels.Headline', []],
        ['BoostPos.XpEtLabels.JeunePublic', ['Jeune public']],
        ['BoostPos.XpEtLabels.LenfanceDeLart', ['L’enfance de l’art']],
    ]) {
        t(`${tag} → ${JSON.stringify(want)}`, labels([tag]), want);
    }
}

// --- 6. Séances événement — côté séance et côté film --------------------------------------------
console.log('\n\x1b[1mseanceEvents — marquer sans jamais inventer\x1b[0m');
{
    const st = (time, events) => (events ? { time, events } : { time });

    // Lecture tolérante : le cache contient encore des payloads écrits avant le champ `events`.
    t('payload d\'avant la fonctionnalité (pas de champ) → aucun événement', showtimeEvents(st('20:00')), []);
    t('champ mal formé → aucun événement', showtimeEvents({ time: '20:00', events: 'Avant-première' }), []);
    t('séance ordinaire n\'est pas un événement', isEventShowtime(st('20:00', [])), false);
    t('séance marquée en est un', isEventShowtime(st('20:00', ['Avant-première'])), true);

    const entries = [
        { showtimes: [st('14:00'), st('20:00', ['Avant-première'])] },
        { showtimes: [st('18:00', ['Séance unique', 'Jeune public'])] },
    ];
    t('on compte les séances, pas les libellés', countEvents(entries), 2);
    t('libellés distincts, ordre de rencontre',
        eventLabelsOf(entries.flatMap(e => e.showtimes)), ['Avant-première', 'Séance unique', 'Jeune public']);
    t('aucun événement → 0', countEvents([{ showtimes: [st('14:00')] }]), 0);

    t('singulier', eventCountLabel(1), '1 ÉVÉNEMENT');
    t('pluriel', eventCountLabel(3), '3 ÉVÉNEMENTS');

    // Les compteurs de carte se lisent sur des entrées **déjà filtrées** : ils promettent ce que le
    // dépliage montrera, pas ce que le pré-filtre carte vient d'écarter.
    {
        // ⚠️ Le cas réel de la production : `isPreview` n'existe pas sur l'endpoint film, c'est
        // `graftEvents` qui le pose à partir de ce que la passe salle a vu. Le filtre carte doit donc
        // mordre sur une séance greffée, sans quoi elle afficherait « Avant-première » dans son chip
        // tout en étant comptée comme couverte par la carte deux lignes plus bas.
        const grafted = graftEvents(
            { theaters: [{ code: 'C1', showtimes: [{ internalId: 9, time: '20:00' }] }] },
            { events: { 9: ['Avant-première'] }, seen: new Set([9]), previews: new Set([9]) },
        ).theaters[0].showtimes[0];

        t('avant-première greffée → `isPreview` posé', grafted.isPreview, true);
        t('   … donc écartée du filtre carte', isCardEligible(grafted), false);
        t('   … une séance événement qui n\'est pas une avant-première reste couverte',
            isCardEligible({ time: '20:00', events: ['Jeune public'] }), true);

        const list = [{
            cinema: { code: 'C1', name: 'A', arrondissement: 1, acceptsUgc: true, favorite: false },
            movie: { id: 1, title: 'F' },
            showtimes: [grafted, st('22:00')],
        }];

        t('avant-première écartée par le filtre carte', countMatching(list, { card: true }), 1);
        t('   … donc 0 événement annoncé sur la carte', groupByFilm(applyFilters(list, { card: true }))[0].nbEvents, 0);
        t('   … et 1 quand on ouvre à tout Paris', groupByFilm(applyFilters(list, { card: false }))[0].nbEvents, 1);
        t('   … vu par cinéma aussi', groupByCinema(applyFilters(list, { card: false }))[0].nbEvents, 1);

        // Le décompte qui alimente le message « N séance(s) événement hors carte UGC ». Sans lui,
        // l'avant-première disparaîtrait en silence alors que le rail vient de la promettre.
        t('événements masqués par le filtre carte, comptés', countMatchingEvents(list, { card: false }), 1);
        t('   … et zéro visible avec le filtre actif', countMatchingEvents(list, { card: true }), 0);
        t('   … la plage horaire s\'applique aussi à ce décompte',
            countMatchingEvents(list, { card: false, range: slotRange('morning') }), 0);
    }

    // La jointure de la seconde passe. C'est ici que se joue le piège de l'endpoint creux : une séance
    // qu'il n'a pas rendue n'est PAS une séance sans événement, et la confondre reproduirait le faux
    // positif qui avait fait déclarer Les Halles muette (cf. README-seances, spike Cinéfil).
    {
        const payload = () => ({
            nextDate: null,
            theaters: [{
                code: 'C0159',
                showtimes: [
                    { internalId: 1, time: '18:00' },
                    { internalId: 2, time: '20:00' },
                    // Déjà marquée par une passe précédente de la visite.
                    { internalId: 3, time: '22:00', events: ['Avant-première'] },
                ],
            }],
        });
        const eventsOf = (p) => p.theaters[0].showtimes.map(s => showtimeEvents(s));

        // Tout vu : la 1 gagne son libellé, la 3 perd le sien (elle a été vue sans être marquée, donc
        // l'événement n'est plus à la programmation). C'est la même règle dans les deux sens.
        t('séance vue et marquée → libellé greffé ; séance vue et non marquée → remise à vide',
            eventsOf(graftEvents(payload(), { events: { 1: ['Séance unique'] }, seen: new Set([1, 2, 3]) })),
            [['Séance unique'], [], []]);

        t('   … et rien de marqué du tout → tout revient à vide',
            eventsOf(graftEvents(payload(), { seen: new Set([1, 2, 3]) })),
            [[], [], []]);

        // Le cas creux : l'endpoint n'a rendu que la séance de 18 h. Les deux autres sont intouchées.
        t('séance NON vue → intouchée, on ne prétend pas qu\'elle est sans événement',
            eventsOf(graftEvents(payload(), { events: { 1: ['Séance unique'] }, seen: new Set([1]) })),
            [['Séance unique'], [], ['Avant-première']]);

        t('aucune séance vue (journée creuse) → rien n\'est touché',
            eventsOf(graftEvents(payload(), { seen: new Set() })),
            [[], [], ['Avant-première']]);

        // Entrée de cache écrite avant la fonctionnalité : pas d'`internalId`, donc jamais dans `seen`.
        t('séance sans `internalId` (vieux cache) → intouchée plutôt que faussement qualifiée',
            showtimeEvents(graftEvents(
                { theaters: [{ code: 'C1', showtimes: [{ time: '18:00' }] }] },
                { events: { undefined: ['Avant-première'] }, seen: new Set([1]) },
            ).theaters[0].showtimes[0]),
            []);

        t('payload sans salle → ne casse pas', graftEvents({}, { seen: new Set([1]) }).theaters, []);

        // Le verdict de la source, s'il arrive un jour par l'endpoint film, n'est pas effacé par une
        // passe salle plus pauvre.
        t('`isPreview` déjà posé par la source survit à une passe qui l\'ignore',
            graftEvents(
                { theaters: [{ code: 'C1', showtimes: [{ internalId: 1, time: '18:00', isPreview: true }] }] },
                { seen: new Set([1]) },
            ).theaters[0].showtimes[0].isPreview,
            true);
    }

    // --- Côté film : les événements datés portés par la ligne `calendar` -------------------------
    //
    // Deux gardes qui ne disent pas la même chose, et il faut les deux : la **date** élague les
    // événements passés, l'**horodatage** élague les relevés périmés.
    const monday = Date.parse('2026-08-10T00:00:00Z');
    const thursday = '2026-08-13T09:00:00Z';
    const lastWeek = '2026-08-07T09:00:00Z';
    const B = { freshSince: monday, today: '2026-08-14' };
    const ev = (date, cinema, labels = ['Avant-première']) => ({ date, cinema, labels });

    // Extraction depuis un payload de journée : une entrée par salle, libellés fusionnés.
    t('entrées d\'une journée : une par salle, libellés fusionnés',
        dayEventEntries({ theaters: [
            { name: 'MK2 Bibliothèque', showtimes: [st('20:00', ['Avant-première']), st('20:15', ['Avant-première'])] },
            { name: 'Le Champo', showtimes: [st('18:00')] },
            { name: 'Reflet Médicis', showtimes: [st('21:00', ['Ciné-club'])] },
        ] }, '2026-08-17').map(({ bookings, ...rest }) => rest),
        [ev('2026-08-17', 'MK2 Bibliothèque'), ev('2026-08-17', 'Reflet Médicis', ['Ciné-club'])]);

    // Les URL de billetterie voyagent avec l'entrée : c'est la clé de jointure d'UGC.
    t('billetteries portées par l\'entrée',
        dayEventEntries({ theaters: [{ name: 'UGC Les Halles', showtimes: [
            { time: '19:15', events: ['Avant-première'], booking: 'https://www.ugc.fr/reservationSeances.html?id=330171840281' },
        ] }] }, '2026-08-18')[0].bookings,
        ['https://www.ugc.fr/reservationSeances.html?id=330171840281']);

    t('billetteries dédoublonnées et bornées à 4',
        bookingsOf([{ booking: 'a' }, { booking: 'a' }, { booking: 'b' }, { booking: 'c' }, { booking: 'd' }, { booking: 'e' }]),
        ['a', 'b', 'c', 'd']);
    t('séance sans billetterie → rien', bookingsOf([{ time: '20:00' }]), []);

    t('journée sans événement → aucune entrée',
        dayEventEntries({ theaters: [{ name: 'A', showtimes: [st('20:00')] }] }, '2026-08-17'), []);
    t('payload absent → aucune entrée', dayEventEntries(null, '2026-08-17'), []);

    // Fusion : accumulation entre journées, élagage du passé, remplacement des seules journées relues.
    t('journée non relue → entrée conservée',
        mergeEventEntries([ev('2026-08-20', 'A')], [], { dates: ['2026-08-17'], today: '2026-08-14' }),
        [ev('2026-08-20', 'A')]);
    t('journée relue et vidée → entrée retirée (événement déprogrammé)',
        mergeEventEntries([ev('2026-08-17', 'A')], [], { dates: ['2026-08-17'], today: '2026-08-14' }), []);
    t('accumulation entre deux journées',
        mergeEventEntries([ev('2026-08-20', 'A')], [ev('2026-08-17', 'B')], { dates: ['2026-08-17'], today: '2026-08-14' }),
        [ev('2026-08-17', 'B'), ev('2026-08-20', 'A')]);
    t('événement passé → élagué sans dépendre d\'aucun horodatage',
        mergeEventEntries([ev('2026-08-13', 'A'), ev('2026-08-20', 'B')], [], { dates: [], today: '2026-08-14' }),
        [ev('2026-08-20', 'B')]);
    t('même jour même salle → dédoublonné, la version fraîche gagne',
        mergeEventEntries([ev('2026-08-17', 'A', ['Séance unique'])], [ev('2026-08-17', 'A')],
            { dates: ['2026-08-17'], today: '2026-08-14' }),
        [ev('2026-08-17', 'A')]);
    t('tri par date puis par salle',
        mergeEventEntries([], [ev('2026-08-20', 'Z'), ev('2026-08-17', 'B'), ev('2026-08-17', 'A')],
            { dates: [], today: '2026-08-14' }).map(e => `${e.date} ${e.cinema}`),
        ['2026-08-17 A', '2026-08-17 B', '2026-08-20 Z']);

    // Lecture depuis la ligne `calendar`.
    t('entrées fraîches et à venir → retenues',
        movieEvents({ events: [ev('2026-08-17', 'A')], events_checked_at: thursday }, B),
        [ev('2026-08-17', 'A')]);
    t('événement d\'aujourd\'hui → retenu (il a encore lieu ce soir)',
        movieEvents({ events: [ev('2026-08-14', 'A')], events_checked_at: thursday }, B).length, 1);
    t('événement d\'hier → ignoré',
        movieEvents({ events: [ev('2026-08-13', 'A')], events_checked_at: thursday }, B), []);
    t('relevé de la semaine passée → ignoré même si la date est future',
        movieEvents({ events: [ev('2026-08-20', 'A')], events_checked_at: lastWeek }, B), []);
    t('horodatage manquant → ignoré', movieEvents({ events: [ev('2026-08-17', 'A')] }, B), []);
    t('horodatage illisible → ignoré',
        movieEvents({ events: [ev('2026-08-17', 'A')], events_checked_at: 'jamais' }, B), []);
    t('colonne absente (migration pas jouée) → aucune entrée, aucune erreur', movieEvents({}, B), []);
    t('entrée sans libellé → ignorée',
        movieEvents({ events: [{ date: '2026-08-17', cinema: 'A', labels: [] }], events_checked_at: thursday }, B), []);

    // Regroupement par journée, pour l'affichage. C'est ce qui manquait quand le rail ne montrait que
    // le prochain événement : un film à trois avant-premières se lisait comme n'en ayant qu'une.
    t('trois salles le même soir → une journée, salles listées',
        groupEventsByDay([ev('2026-08-16', 'UGC Maillot'), ev('2026-08-16', 'UGC Gobelins')]),
        [{ date: '2026-08-16', labels: ['Avant-première'], cinemas: ['UGC Maillot', 'UGC Gobelins'] }]);

    t('trois journées → trois groupes, dans l\'ordre reçu',
        groupEventsByDay([ev('2026-08-16', 'A'), ev('2026-08-17', 'B'), ev('2026-08-18', 'C')])
            .map(d => d.date),
        ['2026-08-16', '2026-08-17', '2026-08-18']);

    t('libellés d\'une même journée fusionnés et dédoublonnés',
        groupEventsByDay([
            ev('2026-08-16', 'A', ['Avant-première']),
            ev('2026-08-16', 'B', ['Avant-première', 'Jeune public']),
        ])[0].labels,
        ['Avant-première', 'Jeune public']);

    t('salle absente → pas de trou dans la liste',
        groupEventsByDay([{ date: '2026-08-16', cinema: null, labels: ['Séance unique'] }])[0].cinemas, []);

    t('aucune entrée → aucun groupe', groupEventsByDay([]), []);

    // Ce qui va dans la pastille. Le vocabulaire d'Allociné tient en deux mots : sans cet arbitrage,
    // la page Événements affiche « Avant-première » sur chaque ligne et ne dit jamais ce que la séance
    // a de particulier — c'est l'exploitant qui le sait.
    const chips = (labels, detail, url = null) => eventChips({ labels, detail, url });

    t('pas de texte d\'exploitant → les libellés d\'Allociné, sans lien',
        chips(['Avant-première'], null),
        { chips: [{ text: 'Avant-première', url: null }], note: null });

    t('libellé d\'exploitant plus précis → il remplace celui d\'Allociné',
        chips(['Avant-première'], 'Avant-première avec équipe', 'https://ugc.fr/x'),
        { chips: [{ text: 'Avant-première avec équipe', url: 'https://ugc.fr/x' }], note: null });

    t('texte d\'exploitant identique → une seule pastille, pas de doublon en dessous',
        chips(['Avant-première'], 'Avant-première'),
        { chips: [{ text: 'Avant-première', url: null }], note: null });

    t('    … la comparaison ignore accents, casse et ponctuation',
        chips(['Avant-première'], 'AVANT PREMIERE').chips.length, 1);

    t('phrase rédigée → elle reste sous les pastilles',
        chips(['Avant-première'], 'La séance sera présentée par le réalisateur Cristian Mungiu.', 'https://mk2.com/x'),
        { chips: [{ text: 'Avant-première', url: null }],
          note: { text: 'La séance sera présentée par le réalisateur Cristian Mungiu.', url: 'https://mk2.com/x' } });

    t('libellé ponctué d\'un point final → toujours un libellé',
        chips(['Avant-première'], 'Séance unique.').chips[0].text, 'Séance unique');

    t('texte tronqué par la source → jamais promu en pastille',
        chips(['Avant-première'], 'Une rencontre avec la comédienne et le chef opérateur du…').note?.url, null);

    t('libellé d\'Allociné non couvert par la pastille promue → conservé',
        chips(['Avant-première', 'Séance unique'], 'Avant-première avec équipe').chips.map(c => c.text),
        ['Avant-première avec équipe', 'Séance unique']);

    t('aucun libellé, texte d\'exploitant seul → il fait la pastille',
        chips([], 'Ciné-club').chips.map(c => c.text), ['Ciné-club']);

    t('entrée vide → rien à afficher', eventChips({}), { chips: [], note: null });

    // ⚠️ L'invariant de la page Événements : tout ce qu'une pastille montre, le menu « Type » le
    // propose. Il s'était rompu en silence, les deux listes étant calculées séparément.
    const kindsOf = (labels, detail) => entryKinds({ labels, detail });

    t('la précision de l\'exploitant est filtrable, sa famille aussi',
        kindsOf(['Avant-première'], 'Avant-première avec équipe'),
        ['Avant-première', 'Avant-première avec équipe']);

    t('    … donc filtrer la famille garde la séance précisée',
        kindsOf(['Avant-première'], 'Avant-première avec équipe').includes('Avant-première'), true);

    t('pas de texte d\'exploitant → les seuls libellés d\'Allociné',
        kindsOf(['Avant-première', 'Jeune public'], null), ['Avant-première', 'Jeune public']);

    t('texte d\'exploitant identique à la casse près → un seul type, bien accentué',
        kindsOf(['Avant-première'], 'AVANT PREMIERE'), ['Avant-première']);

    t('phrase rédigée → jamais un type : elle ferait un filtre par séance',
        kindsOf(['Avant-première'], 'La séance sera présentée par le réalisateur Cristian Mungiu.'),
        ['Avant-première']);

    // ⚠️ Un compte et pas un `every`, qui passe sur un tableau vide : le test resterait vert le jour où
    // `eventChips` cesserait de rendre la moindre pastille.
    t('toute pastille affichée est un type proposé',
        eventChips({ labels: ['Séance unique'], detail: 'Ciné-club' }).chips
            .filter(c => kindsOf(['Séance unique'], 'Ciné-club').includes(c.text)).length, 2);

    t('entrée vide → aucun type', entryKinds({}), []);

    t('prochain événement = le plus proche',
        nextMovieEvent({ events: [ev('2026-08-20', 'Z'), ev('2026-08-17', 'A')], events_checked_at: thursday }, B).date,
        '2026-08-17');
    t('aucun événement → pas de prochain', nextMovieEvent({}, B), null);

    // ⚠️ L'empreinte décide s'il faut écrire. Un `JSON.stringify` du tableau aurait dépendu de l'ordre
    // des clés — invariant que rien ne garantit, les entrées venant de trois chemins différents (relevé
    // du jour, repli par les dates, relecture depuis la base après aller-retour JSON).
    t('ordre des clés indifférent',
        entriesKey([{ date: '2026-08-17', cinema: 'A', labels: ['X'], detail: 'd' }]),
        entriesKey([{ detail: 'd', labels: ['X'], cinema: 'A', date: '2026-08-17' }]));
    t('ordre des entrées indifférent',
        entriesKey([ev('2026-08-17', 'A'), ev('2026-08-18', 'B')]),
        entriesKey([ev('2026-08-18', 'B'), ev('2026-08-17', 'A')]));
    t('ordre des libellés indifférent',
        entriesKey([ev('2026-08-17', 'A', ['X', 'Y'])]),
        entriesKey([ev('2026-08-17', 'A', ['Y', 'X'])]));
    t('le texte libre compte — sinon un libellé gagné ne serait jamais écrit',
        entriesKey([{ ...ev('2026-08-17', 'A'), detail: 'en présence du réalisateur' }])
            !== entriesKey([ev('2026-08-17', 'A')]), true);
    t('salle différente → empreinte différente',
        entriesKey([ev('2026-08-17', 'A')]) !== entriesKey([ev('2026-08-17', 'B')]), true);

    // ⚠️ Le cas qui a motivé l'ajout des bookings à l'empreinte. Celle-ci sert aussi de **clé de
    // regroupement** des écritures (`useSeanceEvents`, `useUpcomingEvents`) : deux films de même clé
    // reçoivent le même patch. Deux avant-premières le même soir dans la même salle, mêmes libellés,
    // `detail` encore null — sans les bookings, le second film héritait des URL de billetterie du
    // premier, et `fetchUgcDetail` (qui rapproche par numéro de séance) lui collait le libellé de
    // l'autre film.
    const withBooking = (url) => ({ ...ev('2026-08-17', 'UGC Les Halles'), bookings: [url] });
    t('bookings différents → empreinte différente (pas de patch partagé entre deux films)',
        entriesKey([withBooking('https://ugc.fr/reservationSeances.html?id=1')])
            !== entriesKey([withBooking('https://ugc.fr/reservationSeances.html?id=2')]), true);
    t('ordre des bookings indifférent',
        entriesKey([{ ...ev('2026-08-17', 'A'), bookings: ['b', 'a'] }]),
        entriesKey([{ ...ev('2026-08-17', 'A'), bookings: ['a', 'b'] }]));
    t('bookings absents → pas d\'exception',
        entriesKey([ev('2026-08-17', 'A')]), entriesKey([{ ...ev('2026-08-17', 'A'), bookings: [] }]));

    t('lot vide', entriesKey([]), '');
    t('lot absent → pas d\'exception', entriesKey(undefined), '');

    // La rubrique « Événement à venir ».
    t('film à venir (PAS en salle) avec avant-première → dans la rubrique',
        hasUpcomingEvent({ state: 'unseen', events: [ev('2026-08-17', 'A')], events_checked_at: thursday }, B), true);
    t('film en salle avec événement → dans la rubrique aussi',
        hasUpcomingEvent({ state: 'inTheaters', events: [ev('2026-08-17', 'A')], events_checked_at: thursday }, B), true);
    t('film déjà vu → jamais, même avec un événement frais',
        hasUpcomingEvent({ state: 'seen', events: [ev('2026-08-17', 'A')], events_checked_at: thursday }, B), false);
    t('film sans événement → pas dans la rubrique', hasUpcomingEvent({ state: 'inTheaters' }, B), false);
}

// --- 7. Libellés d'exploitant (Dulac) -----------------------------------------------------------
//
// Allociné ne décrit pas ses événements ; Dulac publie du `schema.org/Event` en JSON-LD. Ce bloc teste
// le rapprochement et l'extraction du texte — les deux endroits où ça peut se tromper en silence.
console.log('\n\x1b[1mdulac — le texte libre qu\'Allociné n\'a pas\x1b[0m');
{
    // Le test de salle est ce qui évite d'interroger Dulac pour 45 salles parisiennes sur 50.
    for (const [name, want] of [
        ["L'Arlequin", true], ['Reflet Médicis', true], ['Reflet Medicis', true],
        ['Majestic Bastille', true], ['Majestic Passy', true], ["L'Escurial", true],
        ['MK2 Bibliothèque', false], ['UGC Ciné Cité Les Halles', false], ['Le Champo', false],
        [null, false], ['', false],
    ]) {
        t(`isDulacVenue(${JSON.stringify(name)})`, isDulacVenue(name), want);
    }

    const slugs = [
        'avant-premiere-la-fille-condor-de-alvaro-olmos-torrico-seance-en-presence-du-realisateur',
        'retrospective-kim-jee-woon',
    ];
    t('slug candidat trouvé par le titre', matchingSlugs(slugs, 'La Fille Condor').length, 1);
    t('titre absent → aucun candidat', matchingSlugs(slugs, 'Fjord'), []);
    t('titre trop court → aucun candidat (filtre trop large sinon)', matchingSlugs(slugs, 'La'), []);
    t('accents et casse indifférents', matchingSlugs(slugs, 'RÉTROSPECTIVE Kim Jee-Woon').length, 1);

    // JSON-LD réel, réduit à ce qu'on lit.
    const html = `<html><head><script type="application/ld+json" data-seo-jsonld="article-detail">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            { '@type': 'BreadcrumbList', itemListElement: [] },
            {
                '@type': 'Event',
                name: 'AVANT-PREMIÈRE : LA FILLE CONDOR de Álvaro Olmos Torrico séance en présence du réalisateur',
                description: "AVANT-PREMIÈRE : LA FILLE CONDOR de Álvaro Olmos Torrico  Séance en présence du réalisateur, suivie d’une dégustation de produits boliviens (assurée par l'Ambassade de Bolivie) LA FILLE CONDOR de…",
                startDate: '2026-08-17T18:00:00',
                location: { '@type': 'Place', name: "L'Arlequin" },
            },
        ],
    })}</script></head><body></body></html>`;

    const ev = parseDulacEvent(html);
    t('date lue sans l\'heure — Dulac horodate l\'événement (18:00) et non la séance (20:00)', ev.date, '2026-08-17');
    t('salle lue', ev.venue, "L'Arlequin");
    t('pas de JSON-LD → null', parseDulacEvent('<html></html>'), null);
    t('JSON-LD illisible → null', parseDulacEvent('<script type="application/ld+json">{oops</script>'), null);
    t('JSON-LD sans nœud Event → null',
        parseDulacEvent('<script type="application/ld+json">{"@type":"Organization"}</script>'), null);

    // ⚠️ Le test qui a attrapé un vrai bug : la coupe se faisait à un index calculé sur la chaîne
    // normalisée puis appliquée à l'originale. La normalisation retirant accents, apostrophes et
    // parenthèses, la phrase perdait ses cinq derniers caractères — « de Bolivi » au lieu de
    // « de Bolivie) ». D'où la table de correspondance des positions.
    t('texte libre extrait en entier, parenthèse finale comprise',
        dulacEventDetail(ev, 'La Fille Condor'),
        "Séance en présence du réalisateur, suivie d’une dégustation de produits boliviens (assurée par l'Ambassade de Bolivie)");

    t('description vide → aucun texte', dulacEventDetail({ description: '' }, 'La Fille Condor'), null);
    t('description qui n\'est que le titre → aucun texte',
        dulacEventDetail({ description: 'LA FILLE CONDOR' }, 'La Fille Condor'), null);

    // Un texte à rallonge est coupé, mais avec un signe visible plutôt qu'en silence.
    const long = dulacEventDetail(
        { description: `Titre bidon  ${'Séance suivie d\'une rencontre '.repeat(12)}` }, 'Titre bidon');
    t('texte trop long → tronqué et signalé', long.length <= 160 && long.endsWith('…'), true);

    // --- MK2, seconde source -------------------------------------------------------------------
    for (const [name, want] of [
        ['MK2 Bibliothèque', true], ['mk2 Nation', true], ['MK2 Odéon', true],
        ["L'Arlequin", false], ['UGC Ciné Cité Les Halles', false], [null, false],
    ]) {
        t(`isMk2Venue(${JSON.stringify(name)})`, isMk2Venue(name), want);
    }
    t('pré-filtre générique : Dulac', isKnownExhibitorVenue("L'Arlequin"), true);
    t('pré-filtre générique : MK2', isKnownExhibitorVenue('MK2 Bibliothèque'), true);
    t('pré-filtre générique : ni l\'un ni l\'autre', isKnownExhibitorVenue('Le Champo'), false);

    t('slug MK2 trouvé par le titre',
        matchingMk2Slugs(['fjord-avant-premiere', 'retrospective-akira-kurosawa-2026'], 'Fjord'), ['fjord-avant-premiere']);

    // Le cas réel : l'en-tête porte le titre, la phrase utile suit.
    t('texte MK2 extrait, en-tête écarté',
        mk2EventDetail('Avant-première du film “Fjord” le 17 août à 20h00 au mk2 bibliothèque. La séance sera présentée par le réalisateur Cristian Mungiu.',
            'Fjord', 'MK2 Bibliothèque'),
        'La séance sera présentée par le réalisateur Cristian Mungiu.');

    // ⚠️ Le cas qui a corrigé l'heuristique : ici l'en-tête **ne contient pas le titre**. Filtrer sur
    // le titre laissait donc passer toute la formule dans le libellé.
    t('en-tête sans le titre → écarté quand même (date + salle)',
        mk2EventDetail('Avant-première le mardi 8 septembre à 20h00 au mk2 bibliothèque. La séance sera suivie d’un échange avec le réalisateur Nicolas Winding.',
            'Her Private Hell', 'MK2 Bibliothèque'),
        'La séance sera suivie d’un échange avec le réalisateur Nicolas Winding.');

    t('description sans info neuve → aucun texte plutôt qu\'un écho',
        mk2EventDetail('Séances exclusives des films de la saga Hunger Games au mk2 bibliothèque du 8 octobre au 5 novembre, au mk2 bibliothèque.',
            'Hunger Games', 'MK2 Bibliothèque'),
        null);

    // --- Garde-fous communs --------------------------------------------------------------------
    //
    // ⚠️ `mentionsDate` est ce qui empêche de coller le libellé du 17 à la séance du 18. Première
    // version : chercher la date ISO dans la page entière — trop lâche, une fiche MK2 porte plusieurs
    // dates dans ses payloads, et le 18 héritait du texte du 17.
    t('date annoncée en toutes lettres → reconnue', mentionsDate('le 17 août à 20h00', '2026-08-17'), true);
    t('   … avec le jour de la semaine', mentionsDate('le mardi 8 septembre', '2026-09-08'), true);
    t('   … jour différent → refusée', mentionsDate('le 17 août à 20h00', '2026-08-18'), false);
    t('   … mois différent → refusée', mentionsDate('le 17 août', '2026-09-17'), false);
    t('aucune date dans le texte → refusée', mentionsDate('La séance sera présentée', '2026-08-17'), false);
    t('date ISO malformée → refusée', mentionsDate('le 17 août', 'demain'), false);

    t('phrase avec une date → en-tête', isEventHeadline('Avant-première le 17 août', {}), true);
    t('phrase avec la salle → en-tête', isEventHeadline('Projection au mk2 bibliothèque', { cinema: 'MK2 Bibliothèque' }), true);
    t('phrase utile → gardée',
        isEventHeadline('La séance sera présentée par le réalisateur Cristian Mungiu.', { title: 'Fjord', cinema: 'MK2 Bibliothèque' }), false);

    t('meta og:description lue et décodée',
        metaContent('<meta property="og:description" content="L&#39;équipe &amp; le r&eacute;alisateur"/>', 'og:description'),
        "L'équipe & le r&eacute;alisateur");
    t('meta absente → null', metaContent('<html></html>', 'og:description'), null);
    t('texte trop court → refusé', truncateDetail('court'), null);

    // --- UGC, troisième source : la seule à jointure exacte -------------------------------------
    //
    // Dulac et MK2 rapprochent par (titre, date, salle) — trois heuristiques. UGC publie le numéro de
    // séance de sa billetterie, et Allociné nous donne le même dans l'URL de réservation. Égalité
    // d'identifiants : rien ne peut dériver.
    t('numéro de séance extrait de l\'URL Allociné',
        ugcSessionId('https://www.ugc.fr/reservationSeances.html?id=330171840281&part=all&mtm_source=allocine'),
        '330171840281');
    t('   … et de l\'URL relative de la tuile UGC',
        ugcSessionId('reservationSeances.html?id=330171836908'), '330171836908');
    t('URL d\'un autre exploitant → pas d\'identifiant',
        ugcSessionId('https://www.mk2.com/panier/seance/tickets?sessionId=138126'), null);
    t('URL absente → pas d\'identifiant', ugcSessionId(null), null);

    t('11 salles UGC parisiennes', UGC_PARIS_CINEMAS.length, 11);
    t('   … Les Halles porte bien cinemaId=10',
        UGC_PARIS_CINEMAS.find(c => /Halles/.test(c.name))?.id, 10);

    // Gabarit réel, réduit à ce qu'on lit.
    const tile = (tag, id) => `<!-- Component: tile -->
        <span class="film-tag text-uppercase bg--main-blue color--white position-absolute">${tag}</span>
        <a href="film_fjord_18035.html" title="FJORD"></a>
        ${id ? `<a href="reservationSeances.html?id=${id}"><span>19h15</span></a>` : ''}`;

    t('tuile événement → identifiant + libellé décodé',
        parseUgcTiles(tile('Avant-premi&egrave;re avec &eacute;quipe', '330171840281')),
        [{ sessionId: '330171840281', label: 'Avant-première avec équipe' }]);

    t('« UGC Aime » écarté — c\'est une recommandation, pas un événement',
        parseUgcTiles(tile('UGC Aime', '330171840281')), []);
    t('tuile sans lien de réservation → écartée (cycle, festival : rien à accrocher)',
        parseUgcTiles(tile('Concert', null)), []);
    t('tuile sans libellé → écartée', parseUgcTiles('<!-- Component: tile --><a href="reservationSeances.html?id=1"></a>'), []);
    t('gabarit inconnu → aucune tuile, pas d\'invention', parseUgcTiles('<html><body>bonjour</body></html>'), []);

    t('plusieurs tuiles dans une page',
        parseUgcTiles(tile('Concert', '111') + tile('Rencontre', '222')).map(x => `${x.sessionId}:${x.label}`),
        ['111:Concert', '222:Rencontre']);
}

// --- 8. Qui est « en salle » --------------------------------------------------------------------
//
// Erreurs silencieuses des deux côtés : un film retiré à tort disparaît sans un mot, un film gardé à
// tort occupe le rail avec zéro séance. D'où trois issues et jamais deux.
console.log('\n\x1b[1minTheaters — retirer sans se tromper, garder sans mentir\x1b[0m');
{
    const H = '2026-08-20';
    const day = (extra = {}) => ({ nextDate: null, theaters: [], ...extra });
    const withRoom = day({ theaters: [{ code: 'C1', showtimes: [{ time: '20:00' }] }] });

    t('séance parisienne aujourd\'hui → joue', playingWithin(withRoom, H), true);
    t('aucune séance, aucune date suivante → ne joue plus', playingWithin(day(), H), false);
    t('prochaine séance dans l\'horizon → joue encore', playingWithin(day({ nextDate: '2026-08-18' }), H), true);
    t('prochaine séance après l\'horizon → ne joue plus', playingWithin(day({ nextDate: '2026-09-04' }), H), false);

    // Les trois « on ne sait pas ». Les confondre avec « plus à l'affiche » ferait payer sept jours
    // pour une panne d'un jour.
    t('payload absent → on ne sait pas', playingWithin(null, H), null);
    t('Allociné injoignable → on ne sait pas', playingWithin(day({ error: true }), H), null);
    t('vide mais servi depuis du périmé → on ne sait pas', playingWithin(day({ stale: true }), H), null);

    // Salle reportée : elle témoigne du passé, elle ne décide de rien.
    t('seule une salle non confirmée → ne joue plus',
        playingWithin(day({ theaters: [{ code: 'C1', unconfirmedSince: '2026-08-13T10:00:00Z' }] }), H), false);
    t('   … mais une salle confirmée à côté suffit',
        playingWithin(day({ theaters: [{ code: 'C1', unconfirmedSince: 'x' }, { code: 'C2' }] }), H), true);

    // Le verdict sur l'horizon entier — ce qui manquait, et qui retire sans attendre le mercredi.
    const seven = (fn) => Array.from({ length: 7 }, (_, i) => fn(i));

    t('sept journées vides → le film est parti',
        horizonVerdict(seven(() => day()), H), 'gone');
    t('   … une seule journée avec une salle → il joue',
        horizonVerdict(seven(i => (i === 4 ? withRoom : day())), H), 'plays');
    t('   … un nextDate dans l\'horizon suffit aussi',
        horizonVerdict(seven(() => day({ nextDate: '2026-08-19' })), H), 'plays');
    t('   … un nextDate hors horizon ne suffit pas (le cas « Plus fort que moi »)',
        horizonVerdict(seven(() => day({ nextDate: '2026-09-04' })), H), 'gone');

    // ⚠️ Preuve incomplète → on se tait. C'est ce qui empêche une panne de vider le rail.
    t('une journée manquante → on ne conclut pas',
        horizonVerdict(seven(i => (i === 3 ? null : day())), H), 'unknown');
    t('une journée en échec → on ne conclut pas',
        horizonVerdict(seven(i => (i === 0 ? day({ error: true }) : day())), H), 'unknown');
    t('une journée périmée → on ne conclut pas',
        horizonVerdict(seven(i => (i === 6 ? day({ stale: true }) : day())), H), 'unknown');
    t('aucune journée du tout → on ne conclut pas', horizonVerdict([], H), 'unknown');

    // ⚠️ La corroboration avant retrait en masse. Allociné perd parfois un pan de sa grille (UGC Les
    // Halles, 13/08/2026) : sans ce garde, tous les films concernés seraient retirés du rail d'un coup
    // et n'y reviendraient qu'au mercredi suivant.
    t('au moins un film joue → la source répond, on peut conclure',
        sourceLooksAlive([seven(() => day()), seven(i => (i === 2 ? withRoom : day()))]), true);
    t('aucun film ne joue nulle part → lecture douteuse, on ne retire rien',
        sourceLooksAlive([seven(() => day()), seven(() => day())]), false);
    t('   … une salle non confirmée ne suffit pas à prouver que la source répond',
        sourceLooksAlive([seven(() => day({ theaters: [{ code: 'C1', unconfirmedSince: 'x' }] }))]), false);
    t('aucun film du tout → rien à corroborer', sourceLooksAlive([]), false);
}

// --- 9. Gardes de schéma et dates locales -------------------------------------------------------
//
// Deux règles qui vivaient chacune en plusieurs copies divergentes, et dont chaque copie ratait un
// cas. Elles ont désormais une seule définition — autant la tenir par des tests.
{
    console.log("\n\x1b[1mGardes de schéma — PostgREST ne rend pas le code qu'on croit\x1b[0m");

    // ⚠️ Le cœur du sujet : la **même** cause remonte un code différent selon qu'on lit ou qu'on
    // écrit, parce que PostgREST tranche sur son cache de schéma sans atteindre la base.
    t('colonne absente en lecture (42703)', isMissingSchema({ code: '42703' }), true);
    t('colonne absente en écriture (PGRST204)', isMissingSchema({ code: 'PGRST204' }), true);
    t('table absente côté Postgres (42P01)', isMissingSchema({ code: '42P01' }), true);
    t('table absente côté cache de schéma (PGRST205)', isMissingSchema({ code: 'PGRST205' }), true);
    t('reconnue au message, même sans code connu',
        isMissingSchema({ code: 'PGRST999', message: "Could not find the table 'public.x' in the schema cache" }), true);

    // Et l'inverse : un garde trop large avalerait des pannes qui méritent d'être signalées.
    t('erreur de droits → ce n\'est pas un schéma absent', isMissingSchema({ code: '42501' }), false);
    t('violation de contrainte → non plus', isMissingSchema({ code: '23505' }), false);
    t('pas d\'erreur du tout → non', isMissingSchema(null), false);

    console.log('\n\x1b[1mDates locales — jamais new Date("YYYY-MM-DD")\x1b[0m');

    // ⚠️ Le piège que `parseLocalDate` ferme : la spec lit une chaîne `YYYY-MM-DD` en **UTC**, si bien
    // qu'un fuseau à offset négatif retombe la veille et affiche « 16 août » pour un événement du 17.
    t('lue en heure locale, pas en UTC', (() => {
        const d = parseLocalDate('2026-08-17');
        return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    })(), [2026, 8, 17]);
    t('chaîne qui n\'est pas une date → null', parseLocalDate('demain'), null);
    t('valeur absente → null', parseLocalDate(null), null);

    t('écart en jours pleins', daysBetween('2026-08-15', '2026-08-17'), 2);
    t('le jour même → 0', daysBetween('2026-08-15', '2026-08-15'), 0);
    // Le passage à l'heure d'hiver (25/10/2026) : compté sur des millisecondes brutes, cet écart
    // rendrait 30,04 jours — l'arrondi le rattrape ici, mais pas sur toutes les paires de dates.
    t('traverse un changement d\'heure sans déraper', daysBetween('2026-10-10', '2026-11-09'), 30);
    t('date illisible → null', daysBetween('2026-08-15', ''), null);

    // `entryKey` sert aussi de clé de regroupement des écritures : deux entrées confondues, et deux
    // films reçoivent le même patch (cf. `entriesKey`).
    t('identité d\'une entrée = journée + salle',
        entryKey({ date: '2026-08-17', cinema: 'MK2 Bibliothèque' }), '2026-08-17|MK2 Bibliothèque');
    t('salle absente → la journée suffit', entryKey({ date: '2026-08-17' }), '2026-08-17|');
}

// --- 10. Fraîcheur anticipée et instantané persistant --------------------------------------------
//
// Deux règles ajoutées avec le préchauffage planifié (`server/api/cron/warm.js`) et l'instantané
// `localStorage` (`app/utils/seancesSnapshot.js`). Toutes deux ont le profil de défaut du reste de ce
// fichier : elles échouent en **affichant du faux** plutôt qu'en levant quoi que ce soit — une entrée
// de la semaine dernière remontée à l'écran, un cron qui ne rafraîchit jamais rien.
{
    console.log('\n\x1b[1mfraîcheur anticipée — ce qui expirera avant le prochain passage\x1b[0m');

    const HEURE = 60 * 60 * 1000;
    // Postérieur au dernier mercredi par construction : sans ça, un test lancé un mercredi matin
    // basculerait sur la règle de renouvellement des grilles et mesurerait autre chose.
    const recent = new Date(Math.max(lastWednesday() + 60_000, Date.now() - 30 * 60 * 1000)).toISOString();

    t('journée proche, relevé récent → frais maintenant', isShowtimesFresh(recent, isoDay(0)), true);
    // Le cœur du préchauffage : jugée à l'horizon du prochain passage, la même entrée est à refaire.
    // Sans ce comportement, un cron aligné sur le TTL laisse systématiquement une fenêtre froide.
    t('… mais périmée à l\'horizon du prochain passage', isShowtimesFresh(recent, isoDay(0), Date.now() + 2 * HEURE), false);

    t('journée lointaine, TTL plus long → frais maintenant', isShowtimesFresh(recent, isoDay(4)), true);
    t('… et périmée à trois heures d\'ici', isShowtimesFresh(recent, isoDay(4), Date.now() + 3 * HEURE), false);

    // ⚠️ La règle du mercredi ne s'anticipe pas : elle se juge toujours au présent, sinon tout le
    // catalogue serait rafraîchi chaque mardi soir.
    const avantMercredi = new Date(lastWednesday() - HEURE).toISOString();
    t('relevé d\'avant le dernier mercredi → jamais frais', isShowtimesFresh(avantMercredi, isoDay(0)), false);
    t('… y compris sans horizon', isShowtimesFresh(avantMercredi, isoDay(0), Date.now()), false);
    t('horodatage illisible → pas frais', isShowtimesFresh('bientôt', isoDay(0)), false);

    console.log('\n\x1b[1mseanceScope — le cron doit préchauffer un SUR-ensemble de la vue\x1b[0m');

    // L'invariant qui justifie l'extraction dans `shared/` : si le périmètre du préchauffage devenait
    // plus étroit que celui de la vue, des films sortiraient du cron sans une erreur ni un log — et le
    // visiteur repaierait l'attente qu'on vient de supprimer. On vérifie donc l'**inclusion**, pas
    // l'égalité : le cron a le droit d'en préchauffer plus, jamais moins.
    const jourRef = "2026-08-16";
    const bornesVue = { today: jourRef, freshSince: Date.parse("2026-08-12T00:00:00.000Z") };
    const releveFrais = '2026-08-15T10:00:00.000Z';
    const releveVieux = '2026-08-11T10:00:00.000Z';   // d'avant le « mercredi »
    const avecEvent = (extra) => ({
        state: 'unseen', events_checked_at: releveFrais,
        events: [{ date: '2026-08-18', labels: ['Avant-première'] }],
        ...extra,
    });

    const casLimites = [
        ['film en salle sans événement', { state: 'inTheaters', events: [] }],
        ['avant-première avant la sortie (pas inTheaters)', avecEvent({})],
        ['relevé d\'événement périmé', avecEvent({ events_checked_at: releveVieux })],
        ['événement déjà passé', avecEvent({ events: [{ date: '2026-08-15', labels: ['Avant-première'] }] })],
        ['événement sans libellé', avecEvent({ events: [{ date: '2026-08-18', labels: [] }] })],
        ['film vu', avecEvent({ state: 'seen' })],
        ['film sans rien', { state: 'unseen', events: [] }],
    ];

    for (const [label, movie] of casLimites) {
        // `hasUpcomingEvent || inTheaters` est exactement le `seanceFilms` de `useMovieCalendar`.
        const vue = movie.state === 'inTheaters' || hasUpcomingEvent(movie, bornesVue);
        const cron = isSeanceFilm(movie, jourRef);
        t(`${label} : vue ⊆ cron`, !vue || cron, true);
    }

    // La seule divergence tolérée, et dans le bon sens : le cron ignore la garde de fraîcheur du
    // relevé, donc il préchauffe un film que la vue ne mettra pas encore en avant.
    t('relevé périmé → hors de la vue, dans le cron',
        [hasUpcomingEvent(avecEvent({ events_checked_at: releveVieux }), bornesVue),
            isSeanceFilm(avecEvent({ events_checked_at: releveVieux }), jourRef)], [false, true]);

    t('la règle nue ignore les films vus', hasDatedEventFrom(avecEvent({ state: "seen" }), jourRef), false);

    // `isFreshRelease` — les sorties de la semaine restées `unseen`, que ni le contrôle hebdomadaire ni
    // `useUpcomingEvents` ne relevaient. `jourRef` est un dimanche, son mercredi ciné est le 12.
    const mercredi = '2026-08-12';
    const sortie = (extra) => ({ media: 'cinema', state: 'unseen', release_date: mercredi, ...extra });

    t('sortie du mercredi, pas encore basculée', isFreshRelease(sortie({}), mercredi, jourRef), true);
    t('sortie du jour même', isFreshRelease(sortie({ release_date: jourRef }), mercredi, jourRef), true);
    t('sortie de la semaine précédente → contrôle hebdomadaire',
        isFreshRelease(sortie({ release_date: '2026-08-11' }), mercredi, jourRef), false);
    t('sortie à venir → useUpcomingEvents, une requête au lieu de sept',
        isFreshRelease(sortie({ release_date: '2026-08-19' }), mercredi, jourRef), false);
    t('déjà en salle → déjà dans le périmètre', isFreshRelease(sortie({ state: 'inTheaters' }), mercredi, jourRef), false);
    t('film vu', isFreshRelease(sortie({ state: 'seen' }), mercredi, jourRef), false);
    t('état choisi par l\'utilisateur', isFreshRelease(sortie({ state: 'downloadable' }), mercredi, jourRef), false);
    t('film hors cinéma', isFreshRelease(sortie({ media: 'vod' }), mercredi, jourRef), false);
    t('sans date de sortie', isFreshRelease(sortie({ release_date: null }), mercredi, jourRef), false);

    // L'invariant du dessus, étendu : ce que le relevé de la vue Événements balaie doit être dans le
    // périmètre du cron, sans quoi le visiteur repaie sept journées d'Allociné.
    t('sortie fraîche : relevé ⊆ cron',
        isSeanceFilm(sortie({}), jourRef) || isFreshRelease(sortie({}), mercredi, jourRef), true);

    console.log('\n\x1b[1mpruneSnapshot — n\'afficher que ce qu\'on sait dater\x1b[0m');

    const today = '2026-08-16';
    const freshSince = Date.parse('2026-08-12T00:00:00.000Z');   // « mercredi »
    const bornes = { today, freshSince };
    const releve = (iso) => ({ theaters: [], fetchedAt: iso });

    t('journée passée → jetée', Object.keys(pruneSnapshot({
        '111:2026-08-15': releve('2026-08-15T20:00:00.000Z'),
        '111:2026-08-16': releve('2026-08-15T20:00:00.000Z'),
    }, bornes)), ['111:2026-08-16']);

    // Les salles ont renouvelé leur programmation depuis : l'entrée parle d'une grille qui n'existe
    // plus, et elle serait affichée telle quelle avant même le premier appel réseau.
    t('relevé d\'avant le dernier mercredi → jeté', pruneSnapshot({
        '111:2026-08-20': releve('2026-08-11T20:00:00.000Z'),
    }, bornes), {});

    // Un instantané qu'on ne sait pas dater ne peut pas être annoncé comme daté : on ne le montre pas.
    t('payload sans horodatage → jeté', pruneSnapshot({
        '111:2026-08-20': { theaters: [] },
    }, bornes), {});
    t('horodatage illisible → jeté', pruneSnapshot({
        '111:2026-08-20': releve('hier soir'),
    }, bornes), {});
    t('clé qui n\'est pas film:date → jetée', pruneSnapshot({
        'bidon': releve('2026-08-15T20:00:00.000Z'),
        '111:16-08-2026': releve('2026-08-15T20:00:00.000Z'),
    }, bornes), {});

    // Le plafond garde les journées les plus proches — celles qu'on ouvre en premier.
    t('plafond : les journées proches d\'abord', Object.keys(pruneSnapshot({
        '111:2026-08-22': releve('2026-08-15T20:00:00.000Z'),
        '111:2026-08-16': releve('2026-08-15T20:00:00.000Z'),
        '111:2026-08-19': releve('2026-08-15T20:00:00.000Z'),
    }, { ...bornes, max: 2 })), ['111:2026-08-16', '111:2026-08-19']);

    // À date égale, le relevé le plus récent gagne.
    t('à date égale, le relevé le plus récent', Object.keys(pruneSnapshot({
        '222:2026-08-16': releve('2026-08-15T18:00:00.000Z'),
        '111:2026-08-16': releve('2026-08-15T21:00:00.000Z'),
    }, { ...bornes, max: 1 })), ['111:2026-08-16']);

    t('instantané absent → objet vide', pruneSnapshot(null, bornes), {});

    console.log('\n\x1b[1mstampForDisplay — ne pas faire passer hier pour maintenant\x1b[0m');

    const maintenant = new Date('2026-08-16T14:00:00');
    t('même jour → heure nue', stampForDisplay(new Date('2026-08-16T09:05:00').toISOString(), maintenant), 'à 09:05');
    t('la veille → dit « hier »', stampForDisplay(new Date('2026-08-15T21:34:00').toISOString(), maintenant), 'hier à 21:34');
    t('plus ancien → date complète', stampForDisplay(new Date('2026-08-13T21:34:00').toISOString(), maintenant), 'le 13/08 à 21:34');
    t('horodatage illisible → null', stampForDisplay('jamais', maintenant), null);
}

// --- 11. Liens Letterboxd des réalisateurs -------------------------------------------------------
console.log('\n\x1b[1mletterboxdPersonSlug — le repli, et ses limites assumées\x1b[0m');
{
    t('accents décomposés', letterboxdPersonSlug('Pedro Almodóvar'), 'pedro-almodovar');
    t('tiret interne conservé', letterboxdPersonSlug('Bong Joon-ho'), 'bong-joon-ho');
    t('points supprimés, pas coupés', letterboxdPersonSlug('J.J. Abrams'), 'jj-abrams');
    t('apostrophe supprimée', letterboxdPersonSlug("Michael O'Shea"), 'michael-oshea');
    // NFD ne décompose pas ces lettres : la barre fait partie du glyphe.
    t('ø translittéré', letterboxdPersonSlug('André Øvredal'), 'andre-ovredal');
    t('ı sans point translittéré', letterboxdPersonSlug('Levan Akın'), 'levan-akin');
    // Aucun caractère latin → pas de lien deviné, plutôt qu'un lien vide.
    t('écriture non latine → vide', letterboxdPersonSlug('장재현'), '');
    t('absent → vide', letterboxdPersonSlug(null), '');
}

console.log('\n\x1b[1mdirectorLinks — le lien stocké fait autorité, le slug n\'est qu\'un repli\x1b[0m');
{
    const lb = (slug, name) => ({ name, url: `https://letterboxd.com/director/${slug}/` });

    t('sans lien stocké → slug deviné', directorLinks('Sean Baker'),
        [{ name: 'Sean Baker', url: 'https://letterboxd.com/director/sean-baker/', sep: '' }]);

    // Le séparateur est porté par chaque entrée : la première n'en a pas, les suivantes si.
    t('séparateurs calculés hors du template', directorLinks('Joel Coen, Ethan Coen').map(d => d.sep), ['', ', ']);

    // La colonne `director` joint les co-réalisateurs par « , » : un lien par personne.
    t('co-réalisateurs redécoupés', directorLinks('Joel Coen, Ethan Coen').map(d => d.url),
        ['https://letterboxd.com/director/joel-coen/', 'https://letterboxd.com/director/ethan-coen/']);

    // Le cas qui justifie la colonne : le slug nu existe, mais désigne quelqu'un d'autre.
    t('homonyme suffixé → l\'URL stockée gagne', directorLinks('Kane Parsons', [lb('kane-parsons-4', 'Kane Parsons')]),
        [{ name: 'Kane Parsons', url: 'https://letterboxd.com/director/kane-parsons-4/', sep: '' }]);

    // Même personne → on garde le libellé TMDB, affiché partout ailleurs.
    t('libellé TMDB conservé quand c\'est la même personne',
        directorLinks('Pedro Almodóvar', [lb('pedro-almodovar', 'Pedro Almodovar')])[0].name, 'Pedro Almodóvar');

    // Orthographes irréconciliables : le libellé Letterboxd est le seul cohérent avec la page.
    t('translittération divergente → libellé Letterboxd',
        directorLinks('Andreï Zviaguintsev', [lb('andrey-zvyagintsev', 'Andrey Zvyagintsev')]),
        [{ name: 'Andrey Zvyagintsev', url: 'https://letterboxd.com/director/andrey-zvyagintsev/', sep: '' }]);
    t('nom non latin → lien quand même',
        directorLinks('장재현', [lb('jang-jae-hyun', 'Jang Jae-hyun')]).map(d => d.name), ['Jang Jae-hyun']);

    // Par slug et non par position : deux co-réals en ordre inverse ne doivent pas s'échanger.
    t('appariement par slug, pas par position',
        directorLinks('Joel Coen, Ethan Coen', [lb('ethan-coen', 'Ethan Coen'), lb('joel-coen', 'Joel Coen')]),
        [{ name: 'Ethan Coen', url: 'https://letterboxd.com/director/ethan-coen/', sep: '' },
         { name: 'Joel Coen', url: 'https://letterboxd.com/director/joel-coen/', sep: ', ' }]);

    // Identifiant de contributeur : lien valide, mais aucun nom à rapprocher.
    const contrib = (id, name) => ({ name, url: `https://letterboxd.com/director/contributor:${id}/` });
    t('URL contributor: acceptée telle quelle',
        directorLinks('Joe Russo, Anthony Russo', [contrib(61567, 'Joe Russo'), contrib(61656, 'Anthony Russo')]).map(d => d.url),
        ['https://letterboxd.com/director/contributor:61567/', 'https://letterboxd.com/director/contributor:61656/']);
    // Un nom non latin donne un slug vide : il ne doit pas s'apparier avec une URL sans slug.
    t('nom non latin ≠ URL contributor:', directorLinks('장재현', [contrib(999, 'Jang Jae-hyun')])[0].name, 'Jang Jae-hyun');

    t('colonne vide → repli sur le slug', directorLinks('Sean Baker', []).length, 1);
    t('réalisateur inconnu → aucun lien', directorLinks(null), []);
}

console.log('\n\x1b[1mparseLetterboxdFilm — note et réalisateurs dans le même JSON-LD\x1b[0m');
{
    const page = (ld) => `<html><script type="application/ld+json">/* <![CDATA[ */ ${JSON.stringify(ld)} /* ]]> */</script></html>`;

    const full = parseLetterboxdFilm(page({
        aggregateRating: { ratingValue: 3.4, ratingCount: 1200 },
        director: [{ '@type': 'Person', name: 'Kane Parsons', sameAs: 'https://letterboxd.com/director/kane-parsons-4/' }],
    }));
    t('note lue', [full.rating, full.count], [3.4, 1200]);
    t('réalisateur lu depuis sameAs', full.directors, [{ name: 'Kane Parsons', url: 'https://letterboxd.com/director/kane-parsons-4/' }]);

    // Le JSON-LD finit dans un href : ce qui n'est pas une page réalisateur Letterboxd est jeté.
    t('sameAs hors du domaine → jeté', parseLetterboxdFilm(page({
        director: [{ name: 'X', sameAs: 'https://evil.example/director/x/' },
                   { name: 'Y', sameAs: 'https://letterboxd.com/actor/y/' },
                   { name: 'Z', sameAs: 'javascript:alert(1)' }],
    })).directors, []);

    t('forme contributor: conservée', parseLetterboxdFilm(page({
        director: [{ name: 'Joe Russo', sameAs: 'https://letterboxd.com/director/contributor:61567/' }],
    })).directors, [{ name: 'Joe Russo', url: 'https://letterboxd.com/director/contributor:61567/' }]);

    t('note absente → nulls, sans throw', parseLetterboxdFilm(page({ director: [] })), { rating: null, count: null, directors: [] });
    t('JSON-LD illisible → charge utile vide', parseLetterboxdFilm('<html><script type="application/ld+json">{oops</script></html>'),
        { rating: null, count: null, directors: [] });
    t('page sans JSON-LD → charge utile vide', parseLetterboxdFilm('<html></html>'), { rating: null, count: null, directors: [] });

    // Plusieurs blocs : c'est la fiche film qu'on lit, pas le fil d'Ariane qui la précède.
    const breadcrumb = { '@type': 'BreadcrumbList', itemListElement: [] };
    const movie = { '@type': 'Movie', aggregateRating: { ratingValue: 4.2, ratingCount: 10 },
                    director: [{ name: 'Céline Sciamma', sameAs: 'https://letterboxd.com/director/celine-sciamma/' }] };
    const multi = parseLetterboxdFilm(page(breadcrumb) + page(movie));
    t('bloc Movie choisi parmi plusieurs', [multi.rating, multi.directors.map(d => d.name)], [4.2, ['Céline Sciamma']]);
}

console.log('\n\x1b[1misLetterboxdDirectorUrl — la dernière ligne de défense avant le href\x1b[0m');
{
    t('slug accepté', isLetterboxdDirectorUrl('https://letterboxd.com/director/sean-baker/'), true);
    t('contributor: accepté', isLetterboxdDirectorUrl('https://letterboxd.com/director/contributor:61567/'), true);
    t('javascript: refusé', isLetterboxdDirectorUrl('javascript:alert(1)'), false);
    t('autre domaine refusé', isLetterboxdDirectorUrl('https://evil.example/director/x/'), false);
    t('http refusé', isLetterboxdDirectorUrl('http://letterboxd.com/director/x/'), false);
    t('absent refusé', isLetterboxdDirectorUrl(null), false);

    // La garde vaut aussi pour ce qui remonte de la base, pas seulement pour ce qui y descend.
    t('URL douteuse en base → ignorée au rendu',
        directorLinks('X', [{ name: 'X', url: 'javascript:alert(1)' }]).map(d => d.url),
        ['https://letterboxd.com/director/x/']);
}

console.log('\n\x1b[1mmovieSearch — quel film la recherche ouvre\x1b[0m');
{
    // Horloge figée : « à venir » et « passé » dépendent du jour, pas le test.
    const NOW = new Date('2026-08-19T12:00:00');

    // Les formes que prend « pas de date » en base : colonne nulle, chaîne vide, chaîne illisible.
    const undatedNull = { movie_id: 1, title: 'Sans date null', release_date: null };
    const undatedEmpty = { movie_id: 2, title: 'Sans date vide', release_date: '' };
    const undatedJunk = { movie_id: 3, title: 'Sans date illisible', release_date: 'n/a' };
    const soon = { movie_id: 4, title: 'Bientôt', release_date: '2026-09-01' };
    const later = { movie_id: 5, title: 'Plus tard', release_date: '2027-03-01' };
    const old = { movie_id: 6, title: 'Ancien', release_date: '2019-04-01' };
    const recent = { movie_id: 7, title: 'Récent', release_date: '2026-08-01' };

    const all = [undatedNull, undatedEmpty, undatedJunk, soon, later, old, recent];
    const found = (term, list = all) => bestSearchMatch(list, term, NOW)?.title ?? null;

    // Le bug d'origine : un film de la section « Sans date » était introuvable, la recherche restait
    // muette quelle que soit la forme du champ vide.
    t('sans date (null) trouvé', found('sans date null'), 'Sans date null');
    t('sans date (chaîne vide) trouvé', found('sans date vide'), 'Sans date vide');
    t('sans date (date illisible) trouvé', found('sans date illisible'), 'Sans date illisible');

    t('à venir le plus proche gagne', found('t'), 'Bientôt');
    t('daté prioritaire sur sans-date',
        found('x', [{ movie_id: 8, title: 'x sans date', release_date: null },
                    { movie_id: 9, title: 'x daté', release_date: '2026-12-01' }]), 'x daté');
    t('passé le plus récent quand aucun futur',
        found('n', [old, recent]), 'Récent');
    t('sans-date retenu s\'il est le seul candidat',
        found('sans date null', [undatedNull, soon, old]), 'Sans date null');

    t('deux sans-date → ordre de la liste',
        found('sans date', [undatedEmpty, undatedNull]), 'Sans date vide');

    t('casse ignorée', found('BIENTÔT'), 'Bientôt');
    t('terme inconnu → null', found('introuvable'), null);
    t('terme vide → null', found(''), null);
    t('terme blanc → null', found('   '), null);
    t('terme absent → null', found(undefined), null);
    t('liste vide → null', found('bientôt', []), null);
    t('titre absent → ignoré sans throw',
        found('bientôt', [{ movie_id: 10, release_date: null }, soon]), 'Bientôt');

    // `closestToToday` (bouton « aujourd'hui ») ignore les sans-date : rien ne les situe.
    const closest = (list) => closestToToday(list, NOW)?.title ?? null;
    t('le passé le plus récent', closest([old, recent, soon]), 'Récent');
    t('aucun passé → le futur le plus proche', closest([soon, later]), 'Bientôt');
    t('sortie du jour comptée comme passée',
        closest([{ movie_id: 11, title: 'Aujourd\'hui', release_date: '2026-08-19' }, later]), 'Aujourd\'hui');
    t('aucun daté → null', closest([undatedNull, undatedEmpty, undatedJunk]), null);
    t('liste vide → null', closest([]), null);
}

console.log('\n\x1b[1mmovieFilters — quels filtres masquent un film\x1b[0m');
{
    const film = { movie_id: 1, title: 'X', media: 'cinema', state: 'to-watch' };
    const none = { state: null, media: null };

    t('aucun filtre → visible', matchesFilters(film, none), true);
    t('aucun filtre → rien ne bloque', blockingFilters(film, none), []);
    t('filtre concordant → visible', matchesFilters(film, { state: null, media: 'cinema' }), true);
    t('filtre discordant → masqué', matchesFilters(film, { state: null, media: 'streaming' }), false);

    // C'est ce tableau que `onSearch` lève.
    t('un seul filtre bloque → lui seul est levé',
        blockingFilters(film, { state: 'to-watch', media: 'streaming' }), ['media']);
    t('les deux bloquent → les deux levés',
        blockingFilters(film, { state: 'watched', media: 'streaming' }), ['state', 'media']);
    t('filtres absents → rien ne bloque', blockingFilters(film, undefined), []);

    // Les deux fonctions ne doivent jamais se contredire.
    const cases = [none, { state: 'watched', media: null }, { state: null, media: 'cinema' },
                   { state: 'to-watch', media: 'streaming' }];
    t('cohérence matchesFilters ⇔ blockingFilters vide',
        cases.map(f => blockingFilters(film, f).length === 0 === matchesFilters(film, f)),
        cases.map(() => true));
}

console.log('\n\x1b[1mviewport — la ligne est-elle déjà à l\'écran\x1b[0m');
{
    const H = 800;
    const row = (top, height = 90) => ({ top, bottom: top + height });

    // Le cas qui décide : ligne sous les yeux → on marque tout de suite, pas après une durée de scroll
    // qui n'aura pas lieu.
    t('ligne en plein milieu → visible', isFullyVisible(row(300), H), true);
    t('ligne au-dessus du champ → non', isFullyVisible(row(-200), H), false);
    t('ligne en dessous du champ → non', isFullyVisible(row(900), H), false);
    t('ligne à cheval sur le haut → non', isFullyVisible(row(-10), H), false);
    t('ligne à cheval sur le bas → non', isFullyVisible(row(740), H), false);

    // Bornes exactes : collée en haut / en bas, sans marge, ça compte comme visible.
    t('collée au bord haut → visible', isFullyVisible(row(0), H), true);
    t('collée au bord bas → visible', isFullyVisible(row(710), H), true);
    t('dépasse d\'un pixel en bas → non', isFullyVisible(row(711), H), false);

    // La marge est là pour l'en-tête `sticky` et la nav flottante : « visible » en coordonnées mais
    // couverte en vrai.
    t('sous l\'en-tête sticky → non malgré top >= 0', isFullyVisible(row(40), H, 120), false);
    t('derrière la nav flottante → non', isFullyVisible(row(650), H, 120), false);
    t('dégagée des deux bandes → visible', isFullyVisible(row(300), H, 120), true);
    t('pile sur la marge haute → visible', isFullyVisible(row(120), H, 120), true);

    // Plus haute que le viewport : jamais entièrement visible, donc jamais la branche rapide.
    t('plus haute que l\'écran → non', isFullyVisible(row(0, 1200), H), false);

    // Entrées absentes : la branche lente, jamais une exception (élément détaché, hauteur inconnue).
    t('rect absent → non', isFullyVisible(null, H), false);
    t('hauteur inconnue → non', isFullyVisible(row(300), undefined), false);
    t('coordonnées non finies → non', isFullyVisible({ top: NaN, bottom: NaN }, H), false);
}

console.log(`\n${pass} passé(s), ${fail} échoué(s)`);
process.exit(fail ? 1 : 0);
