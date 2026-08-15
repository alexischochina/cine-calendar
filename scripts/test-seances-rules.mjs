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
// Sept familles, toutes importées depuis le code réel (aucune copie) :
//   1. `carryOverMissing`     — report des salles disparues (server/utils/showtimesFreshness.js)
//   2. `cineWeek`             — semaine ciné partagée app/serveur/scripts (shared/utils/cineWeek.js)
//   3. `seancesGrouping`      — filtres, tri, regroupements (app/utils/seancesGrouping.js)
//   4. `showtimeEventLabels`  — tags Allociné → libellés d'événement (server/utils/allocine.js)
//   5. `seanceEvents`         — règles des séances événement (app/utils/seanceEvents.js)
//   6. `exploitants`          — libellés Dulac / MK2 / UGC (server/utils/{dulac,mk2,ugc,…}.js)
//   7. `inTheaters`           — qui est « en salle » (app/utils/inTheaters.js)
//
// Sort en code 1 au premier échec, pour être branchable sur un hook ou une CI.

import { carryOverMissing } from '../server/utils/showtimesFreshness.js';
import { isoDay, lastWednesday, SEANCES_HORIZON_DAYS } from '../shared/utils/cineWeek.js';
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
    movieEvents, nextMovieEvent, hasUpcomingEvent, eventChips,
} from '../app/utils/seanceEvents.js';

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

// --- 4. Tags Allociné → libellés d'événement ----------------------------------------------------
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

// --- 5. Séances événement — côté séance et côté film --------------------------------------------
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

// --- 6. Libellés d'exploitant (Dulac) -----------------------------------------------------------
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

// --- 7. Qui est « en salle » --------------------------------------------------------------------
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

console.log(`\n${pass} passé(s), ${fail} échoué(s)`);
process.exit(fail ? 1 : 0);
