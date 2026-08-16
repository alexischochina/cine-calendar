// SPIKE / CANARI — paris-cine.info comme seconde source de séances.
//
// Successeur du spike Cinéfil (13/08/2026), qui butait sur le rapprochement des titres : 83 % seulement
// entre un slug d'URL et un titre rédigé, « il faudra un mapping par identifiant, pas par chaîne ».
// Ce mapping existe ici, et c'est tout l'intérêt de cette piste :
//
//   `get_movies.php`     → `id` **est** l'identifiant Allociné (vérifié : 188280 → Fjord), `i_id` l'IMDb.
//   `get_showtimes.php`  → `tid` **est** le code salle Allociné (`C0159`, `W7509`), notre `cinemas.code`.
//
// Le rapprochement est donc une **égalité d'identifiants**, comme la jointure UGC par numéro de séance :
// ni titre à normaliser, ni date à interpréter. C'est ce qui rend ce spike mesurable là où le précédent
// mélangeait lacune de source et échec de rapprochement.
//
//   node scripts/spike-pci.mjs                    # tout (~1 min)
//   node scripts/spike-pci.mjs --contract         # juste la forme des payloads (2 requêtes)
//   node scripts/spike-pci.mjs --coverage --films=6
//
// **Lecture seule** : aucune écriture en base, rien de branché en production. Ce script mesure, il ne
// décide pas. Trois questions, une par contrôle :
//
//   1. `--contract` — le format tient-il dans le temps ? C'est LA question du spike Cinéfil, restée
//                     sans réponse (« ce que ce spike ne dit pas : la stabilité du HTML »). À relancer
//                     quelques jours d'affilée : c'est la répétition qui répond, pas un run.
//   2. `--join`     — combien de nos films sont dans leur catalogue, par identifiant.
//   3. `--coverage` — que rendrait cette source **en plus** d'Allociné, sur nos films ? Elle nomme les
//                     salles absentes d'Allociné : c'est la mesure du cas « UGC Les Halles a disparu »,
//                     dont le README dit ne pas savoir s'il est fréquent ou accidentel.
//   4. `--labels`   — combien de libellés d'événement (`com`) gagnerions-nous, et **dans quelles
//                     salles** : celles que nos trois connecteurs couvrent déjà, ou les autres ?
//                     C'est le seul contrôle qui chiffre un gain net. Films en salle **et à venir** :
//                     une avant-première précède la sortie, la restreindre à l'affiche la raterait.
//
// ⚠️ Ce que ce canari ne dit pas, et qu'aucun code ne dira : si l'auteur du site est d'accord. Le
// `robots.txt` ne pose aucune directive (vérifié le 15/08/2026 — que le bloc « content signals » par
// défaut de Cloudflare), mais l'agrégation multi-exploitants **est** son travail, pas une donnée qu'il
// se contenterait de relayer comme Allociné. Ce script tient donc son volume au strict nécessaire, se
// déclare dans son User-Agent et espace ses requêtes ; brancher quoi que ce soit en production sans
// avoir écrit à l'auteur serait un autre débat, et il ne se tranche pas ici.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// Mêmes repères que l'app, le serveur et les autres scripts : un spike qui daterait ses journées
// autrement que le code qu'il évalue ne mesurerait pas la bonne fenêtre.
import { isoDay, SEANCES_HORIZON_DAYS } from '../../shared/utils/cineWeek.js';
// Le pré-filtre de l'app, réutilisé tel quel : « cette salle a-t-elle déjà une source de libellés ? ».
// C'est lui qui transforme un décompte de `com` en gain net.
import { isKnownExhibitorVenue } from '../../shared/utils/exhibitorVenues.js';

const loadEnv = () => {
    try {
        const raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
        for (const line of raw.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* .env absent : on compte sur l'environnement */ }
};
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.NUXT_SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

// User-Agent **identifiable**, et pas un navigateur déguisé : c'est le minimum qu'on doit à un site
// perso qu'on interroge sans lui avoir demandé. Même chaîne que les autres scripts du projet.
const UA = 'Mozilla/5.0 (compatible; cine-calendar/1.0)';
const PARIS = 115755;
const PCI = 'https://www.paris-cine.info';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const ko = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Drapeaux nus (`--coverage`) et drapeaux valués (`--films=6`) sont séparés : sans ça, `--films=6`
// entrerait dans la liste des contrôles demandés et les désactiverait tous les quatre.
const ARGS = process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2));
const ONLY = ARGS.filter(a => !a.includes('='));
const runs = (name) => !ONLY.length || ONLY.includes(name);
const valued = (name, fallback) => {
    const hit = ARGS.find(a => a.startsWith(`${name}=`));
    const n = hit ? Number(hit.split('=')[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const SAMPLE_FILMS = valued('films', 4);   // films comparés séance par séance (le contrôle coûteux)
const LABELS_MAX = valued('labels-max', 25);
const DATES = Array.from({ length: SEANCES_HORIZON_DAYS }, (_, i) => isoDay(i));

let broken = 0;

// Clé de rapprochement d'une séance : salle + horaire à la minute. Les deux sources rendent le même
// `YYYY-MM-DDTHH:MM:SS` local ; on coupe les secondes plutôt que de parier qu'elles sont toujours à 00.
// Jamais de rapprochement sur le titre : c'est ce qui a tué le spike précédent.
const minuteKey = (iso) => {
    const s = String(iso ?? '');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : null;
};

// --- Source A : paris-cine.info -----------------------------------------------------------------
//
// Deux endpoints, tous deux en GET nu, sans session ni jeton (le `PHPSESSID` est posé mais pas exigé —
// l'authentification Google du site ne sert qu'aux favoris et à la watchlist).
const pciGet = async (path) => {
    try {
        const r = await fetch(`${PCI}/${path}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
};

// Le catalogue de l'affiche parisienne : 195 Ko, deux contrôles le regardent. Une seule lecture.
let cataloguePromise = null;
const pciCatalogue = () => (cataloguePromise ??= pciGet('get_movies.php'));

// Un film = une requête pour **toute** la fenêtre (10 jours servis, 7 exploités ici), là où Allociné
// demande une requête par jour. Mémoïsé : `--coverage` et `--labels` regardent les mêmes films, et
// taper deux fois un site perso pour la même réponse ne se justifie par rien.
const pciCache = new Map();
const pciShowtimes = async (allocineId) => {
    if (pciCache.has(allocineId)) return pciCache.get(allocineId);
    const j = await pciGet(`get_showtimes.php?mov_id=${allocineId}`);
    const list = Array.isArray(j?.showtimes) ? j.showtimes : null;
    pciCache.set(allocineId, list);
    // Espacement volontaire : ce script n'a aucune raison d'être pressé, et sa politesse est le seul
    // argument qu'on pourra présenter à l'auteur du site.
    await sleep(700);
    return list;
};

// --- Source B : Allociné (ce qu'on sert déjà) ----------------------------------------------------
//
// Endpoint **de production** (`movie-<id>/near-Paris`), et pas `theater-<code>` : le spike Cinéfil
// s'est fait avoir exactement là, en mesurant la faiblesse du mauvais endpoint et en l'attribuant à la
// source (Bercy 2/7 jours par salle contre 6/7 par film).
const allocineDay = async (allocineId, date) => {
    const page = async (p) => {
        try {
            const r = await fetch(`https://www.allocine.fr/_/showtimes/movie-${allocineId}/near-${PARIS}/d-${date}/p-${p}/`,
                { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
            return await r.json();
        } catch { return null; }
    };

    const first = await page(1);
    if (!first) return null;
    // « Aucune séance à cette date » n'est pas une panne : Allociné le dit par `error` + `nextDate`.
    // La journée est vide, et c'est une réponse — la compter comme illisible masquerait précisément
    // les jours où la seconde source aurait quelque chose à dire.
    if (first.error) return { theaters: new Map(), keys: new Set() };

    const total = Number(first.pagination?.totalPages) || 1;
    const rest = [];
    for (let p = 2; p <= total; p++) rest.push(await page(p));
    // Une page perdue laisse un payload parfaitement bien formé, simplement amputé de 15 salles. Le
    // comparer reviendrait à imputer à Allociné une lacune qui est la nôtre — on se tait plutôt.
    if (rest.some(r => !r)) return null;

    const theaters = new Map();
    const keys = new Set();

    for (const entry of [first, ...rest].flatMap(p => p.results ?? [])) {
        const code = entry?.theater?.internalId;
        if (!code) continue;
        if (!/^75/.test(String(entry.theater.location?.zip ?? ''))) continue;   // Paris intra-muros, comme la vue
        theaters.set(code, entry.theater.name);
        for (const s of Object.values(entry.showtimes ?? {}).flat()) {
            const at = minuteKey(s?.startsAt);
            if (at) keys.add(`${code}|${at}`);
        }
    }
    return { theaters, keys };
};

// --- 1. Contrat des deux endpoints ---------------------------------------------------------------
//
// Le contrôle décisif, et le seul qui mérite d'être relancé tous les jours. Une seconde source ne vaut
// que par sa stabilité : c'est pour l'avoir ignoré que le projet a abandonné le parsing HTML d'Allociné,
// et c'est l'inconnue que le spike Cinéfil a laissée derrière lui.
const checkContract = async (witnessId) => {
    console.log('\n\x1b[1mContrat paris-cine.info\x1b[0m');

    const catalogue = await pciCatalogue();
    if (!Array.isArray(catalogue?.data)) {
        ko('get_movies.php — enveloppe { data: [...] } absente. Le catalogue n\'est plus lisible.');
        broken++;
    } else {
        const first = catalogue.data[0] ?? {};
        const missing = ['id', 'ti', 'i_id', 'rel'].filter(f => !(f in first));
        if (missing.length) { ko(`get_movies.php — champ(s) « ${missing.join(', ')} » disparu(s)`); broken++; }
        else ok(`get_movies.php : ${catalogue.data.length} films, champs attendus présents`);
    }

    if (!witnessId) { warn('aucun film résolu en base — contrôle des séances sauté'); return; }

    const showtimes = await pciShowtimes(witnessId);
    if (!Array.isArray(showtimes)) {
        ko(`get_showtimes.php?mov_id=${witnessId} — enveloppe { showtimes: [...] } absente`);
        broken++;
        return;
    }
    if (!showtimes.length) {
        // Pas un échec de contrat : un film peut n'avoir aucune séance. Mais c'est un mauvais témoin.
        warn(`get_showtimes.php : 0 séance pour le film témoin ${witnessId} — contrôle des champs impossible`);
        return;
    }

    const first = showtimes[0];
    // `tid` et `start` portent la jointure, `com` et `srcs` portent tout l'intérêt de la source. Un de
    // ces quatre qui disparaît, et la piste change de nature — d'où un contrôle nommé champ par champ
    // plutôt qu'un « ça répond ».
    const missing = ['tid', 'start', 'com', 'srcs'].filter(f => !(f in first));
    if (missing.length) { ko(`get_showtimes.php — champ(s) « ${missing.join(', ')} » disparu(s)`); broken++; return; }
    if (!minuteKey(first.start)) { ko(`get_showtimes.php — « start » n'est plus une date ISO (${first.start})`); broken++; return; }

    ok(`get_showtimes.php : ${showtimes.length} séances, champs de jointure et d'événement présents`);
};

// --- 2. Recouvrement des identifiants ------------------------------------------------------------
const checkJoin = async (films) => {
    console.log('\n\x1b[1mJointure par identifiant\x1b[0m');

    const catalogue = await pciCatalogue();
    if (!Array.isArray(catalogue?.data)) { ko('catalogue illisible — jointure non mesurable'); return; }

    const byId = new Map(catalogue.data.map(m => [Number(m.id), m]));
    const found = films.filter(f => byId.has(Number(f.allocine_id)));

    // Le chiffre qui remplace les 83 % du spike Cinéfil. Un film absent n'est pas un échec de
    // rapprochement — c'est un film que le site ne suit pas (il ne couvre que l'affiche parisienne).
    ok(`${found.length}/${films.length} de nos films en salle retrouvés par `
        + `\x1b[1mégalité d'identifiant\x1b[0m (0 rapprochement de titre)`);

    for (const f of films.filter(f => !byId.has(Number(f.allocine_id))).slice(0, 5)) {
        console.log(`      · absent du catalogue : ${f.title} (${f.allocine_id})`);
    }

    // L'autre bout de la chaîne : `i_id` (IMDb) permettrait de retrouver le TMDB exact via
    // /find?external_source=imdb_id — donc de résoudre un film **sans** la similarité de titres de
    // `server/api/allocine/resolve.js`, qui reste la pièce la plus approximative du pipeline.
    const withImdb = catalogue.data.filter(m => m.i_id && m.i_id !== '0000000');
    const rate = Math.round(100 * withImdb.length / Math.max(catalogue.data.length, 1));
    (rate >= 90 ? ok : warn)(`identifiant IMDb renseigné sur ${withImdb.length}/${catalogue.data.length} films (${rate} %) `
        + '— de quoi résoudre TMDB sans rapprochement de titre');
};

// --- 3. Couverture des séances -------------------------------------------------------------------
//
// Le cœur du canari. Pour chaque film de l'échantillon, on compare séance par séance (salle + minute)
// ce que rend paris-cine.info et ce que rend Allociné **en direct** — pas notre cache : un écart de
// cache est un problème de TTL, déjà mesuré par `check-seances.mjs --drift`. Ici on veut savoir si la
// SOURCE est plus complète.
//
// Le chiffre qu'on cherche est « PCI seul », et surtout les salles qu'il nomme. Le chiffre inverse
// (« Allociné seul ») n'est pas du bruit : c'est le canari d'une troncature côté PCI, dont l'endpoint
// n'expose aucune pagination. S'il grossit, la source est incomplète et tout le reste est à relire.
const checkCoverage = async (films, parisCodes) => {
    console.log(`\n\x1b[1mCouverture des séances (${DATES[0]} → ${DATES[DATES.length - 1]})\x1b[0m`);

    const sample = films.slice(0, SAMPLE_FILMS);
    if (films.length > sample.length) {
        // Aucun plafond silencieux : un échantillon qu'on ne nomme pas se lit comme un balayage complet.
        console.log(`  échantillon : ${sample.length}/${films.length} films (\x1b[2m--films=N pour élargir\x1b[0m)`);
    }

    let both = 0, onlyPci = 0, onlyAllocine = 0, skipped = 0;
    const gainedTheaters = new Map();   // code → { name, seances }
    const offPerimeter = new Map();     // salles PCI hors de notre référentiel Paris

    for (const film of sample) {
        const pci = await pciShowtimes(film.allocine_id);
        if (!Array.isArray(pci)) { warn(`${film.title} — paris-cine.info injoignable, film sauté`); continue; }

        // Index PCI restreint à notre fenêtre : le site sert 10 jours, la vue n'en montre que 7.
        // Comparer sur 10 attribuerait à Allociné une lacune qui n'est qu'une différence d'horizon.
        const pciKeys = new Map();
        for (const s of pci) {
            const at = minuteKey(s.start);
            if (!at || !DATES.includes(at.slice(0, 10))) continue;
            pciKeys.set(`${s.tid}|${at}`, s);
        }

        let filmBoth = 0, filmOnlyPci = 0, filmOnlyAllo = 0;

        for (const date of DATES) {
            const allo = await allocineDay(film.allocine_id, date);
            if (allo === null) { skipped++; continue; }   // lecture incomplète : on ne compare pas ce jour

            // Le périmètre s'enrichit de ce qu'Allociné vient de nommer en 75xxx : une salle qu'il rend
            // aujourd'hui prouve qu'elle est parisienne, même absente de notre référentiel.
            for (const [code, name] of allo.theaters) parisCodes.set(code, name);

            const dayPci = [...pciKeys.entries()].filter(([k]) => k.split('|')[1].startsWith(date));

            for (const [key, s] of dayPci) {
                const code = key.split('|')[0];
                // Hors référentiel : ni en base, ni jamais vue en 75xxx. On ne peut pas affirmer
                // qu'elle est parisienne, donc on ne la compte pas comme un gain — on la nomme à part.
                if (!parisCodes.has(code)) {
                    offPerimeter.set(code, s.title);
                    continue;
                }
                if (allo.keys.has(key)) { filmBoth++; continue; }
                filmOnlyPci++;
                const entry = gainedTheaters.get(code) ?? { name: s.title, seances: 0 };
                entry.seances++;
                gainedTheaters.set(code, entry);
            }

            // `allo.keys` ne porte que la journée demandée : pas de filtre de date à repasser ici.
            const pciKeySet = new Set(dayPci.map(([k]) => k));
            for (const key of allo.keys) if (!pciKeySet.has(key)) filmOnlyAllo++;
        }

        both += filmBoth; onlyPci += filmOnlyPci; onlyAllocine += filmOnlyAllo;

        const line = `${film.title} — ${filmBoth} communes`
            + (filmOnlyPci ? `, \x1b[1m+${filmOnlyPci} chez PCI seul\x1b[0m` : '')
            + (filmOnlyAllo ? `, ${filmOnlyAllo} chez Allociné seul` : '');
        (filmOnlyPci ? warn : ok)(line);
    }

    if (skipped) warn(`${skipped} journée(s) sautée(s) — lecture Allociné incomplète, jamais comptée comme une lacune`);

    console.log(`\n  Total : ${both} séances communes · \x1b[1m${onlyPci} vues seulement par paris-cine.info\x1b[0m · ${onlyAllocine} seulement par Allociné`);

    if (gainedTheaters.size) {
        warn(`${gainedTheaters.size} salle(s) que paris-cine.info rend et qu'Allociné ne rend pas :`);
        for (const [code, t] of [...gainedTheaters].sort((a, b) => b[1].seances - a[1].seances)) {
            console.log(`      · ${t.name} (${code}) — ${t.seances} séances`);
        }
        warn('  C\'est le cas « UGC Ciné Cité Les Halles » du 13/08. Un run isolé ne prouve rien :');
        warn('  c\'est sa RÉCURRENCE sur plusieurs jours qui fait la différence entre accident et structure.');
    } else if (both) {
        ok('aucune séance manquante chez Allociné sur cet échantillon — la lacune reste accidentelle');
    }

    if (onlyAllocine > both * 0.05) {
        warn(`${onlyAllocine} séances qu'Allociné a et pas PCI : au-delà du bruit, soupçonner une troncature`);
        warn('  (get_showtimes.php n\'expose aucune pagination — rien ne signalerait un résultat coupé)');
    }

    if (offPerimeter.size) {
        console.log(`\n  ${offPerimeter.size} salle(s) PCI hors référentiel, non comptées (périmètre non prouvé) :`);
        console.log(`      ${[...offPerimeter.values()].slice(0, 8).join(' · ')}`);
    }
};

// --- 4. Libellés d'événement ---------------------------------------------------------------------
//
// Le seul contrôle qui chiffre un gain **net**. Un `com` sur une salle UGC, Dulac ou MK2 ne nous
// apprend rien : nos trois connecteurs le trouvent déjà (657 lignes, un cache dédié, trois sitemaps).
// Un `com` ailleurs — Studio Galande, Ursulines, Le Louxor, L'Entrepôt, Saint-André des Arts — est un
// libellé qu'aucune ligne du projet ne sait produire aujourd'hui, et qu'aucune ne saura sans écrire un
// connecteur de plus par salle.
const checkLabels = async (films) => {
    console.log('\n\x1b[1mLibellés d\'événement (champ `com`)\x1b[0m');

    const scanned = films.slice(0, LABELS_MAX);
    if (films.length > scanned.length) {
        console.log(`  balayage : ${scanned.length}/${films.length} films (\x1b[2m--labels-max=N\x1b[0m)`);
    }

    let withCom = 0, total = 0;
    const covered = [], uncovered = [];

    for (const film of scanned) {
        const pci = await pciShowtimes(film.allocine_id);
        if (!Array.isArray(pci)) continue;

        for (const s of pci) {
            const at = minuteKey(s.start);
            if (!at || !DATES.includes(at.slice(0, 10))) continue;
            total++;
            if (!s.com) continue;
            withCom++;
            (isKnownExhibitorVenue(s.title) ? covered : uncovered)
                .push({ film: film.title, ...s, at });
        }
    }

    if (!total) { warn('aucune séance lue — rien à mesurer'); return; }

    ok(`${withCom} libellé(s) sur ${total} séances (${scanned.length} films)`);

    if (covered.length) {
        console.log(`\n  ${covered.length} dans une salle \x1b[2mdéjà couverte\x1b[0m par ugc.js / dulac.js / mk2.js :`);
        for (const s of covered.slice(0, 4)) console.log(`      · ${s.at.slice(0, 10)} ${s.title} — « ${s.com} »`);
        console.log('      → à recouper avec ce que nos connecteurs rendent : un désaccord serait le vrai signal.');
    }

    if (uncovered.length) {
        warn(`${uncovered.length} dans une salle qu'AUCUN connecteur ne couvre — gain net :`);
        for (const s of uncovered.slice(0, 6)) console.log(`      · ${s.at.slice(0, 10)} ${s.title} — « ${s.com} » (${s.film})`);
    } else if (withCom) {
        console.log('  aucun libellé hors des salles déjà couvertes sur ce relevé — le gain net est nul ici.');
    }

    // La provenance, telle que le site l'expose (son UI dit « vérifié par 2 sources »). Une séance dont
    // les sources ne contiennent pas « A » est une séance qu'il ne tient PAS d'Allociné : c'est la
    // preuve directe, dans le payload, qu'il y a bien une seconde source de listes derrière.
    const srcs = new Map();
    for (const list of pciCache.values()) {
        for (const s of list ?? []) srcs.set(s.srcs, (srcs.get(s.srcs) ?? 0) + 1);
    }
    if (srcs.size) {
        const nonAllocine = [...srcs].filter(([k]) => !String(k).includes('A')).reduce((n, [, v]) => n + v, 0);
        console.log(`\n  provenances (\`srcs\`) : ${[...srcs].map(([k, v]) => `${k}=${v}`).join(' · ')}`);
        (nonAllocine ? warn : ok)(`${nonAllocine} séance(s) publiée(s) sans Allociné dans leurs sources`);
    }
};

// --- Exécution -----------------------------------------------------------------------------------
console.log('\x1b[1m— Spike : paris-cine.info comme seconde source —\x1b[0m');

// Le périmètre parisien de référence : notre table `cinemas`, peuplée au fil des passages de la vue.
// Il s'enrichira en cours de route de ce qu'Allociné nomme en 75xxx.
const { data: cinemas } = await supabase.from('cinemas').select('code, name');
const parisCodes = new Map((cinemas ?? []).map(c => [c.code, c.name]));

// Nos films en salle, résolus. C'est exactement le périmètre de la vue Séances : mesurer sur
// l'affiche parisienne entière dirait quelque chose du site, pas de ce qu'il nous apporterait.
const { data: films, error } = await supabase
    .from('calendar')
    .select('title, allocine_id')
    .eq('state', 'inTheaters')
    .not('allocine_id', 'is', null);

if (error) { ko(`lecture calendar : ${error.message}`); process.exit(1); }
if (!films?.length) {
    warn('aucun film « en salle » résolu en base — ouvrir /seances une fois suffit à en peupler.');
    process.exit(0);
}

// ⚠️ Les films **à venir**, en plus, et seulement pour les libellés. Sans eux, le contrôle raterait
// structurellement l'événement le plus fréquent : une avant-première a lieu AVANT la sortie, donc son
// film n'est jamais `inTheaters` (c'est le cas *Fjord* qui a justifié `useUpcomingEvents`). Même
// fenêtre que lui — 21 jours —, pour mesurer la même population.
const HORIZON_UPCOMING = 21;
const { data: upcoming } = await supabase
    .from('calendar')
    .select('title, allocine_id')
    .eq('media', 'cinema')
    .eq('state', 'unseen')
    .not('allocine_id', 'is', null)
    .gte('release_date', isoDay(0))
    .lte('release_date', isoDay(HORIZON_UPCOMING));

const eventFilms = [...films, ...(upcoming ?? [])];

console.log(`${films.length} film(s) en salle · ${upcoming?.length ?? 0} à venir sous ${HORIZON_UPCOMING} j · `
    + `${parisCodes.size} salle(s) au référentiel · fenêtre ${DATES[0]} → ${DATES[DATES.length - 1]}`);

if (runs('contract')) await checkContract(films[0]?.allocine_id);
if (runs('join')) await checkJoin(films);
// La couverture se mesure sur les films **en salle** : un film à venir n'a presque aucune séance, il
// dirait surtout que les deux sources sont d'accord sur du vide.
if (runs('coverage')) await checkCoverage(films, parisCodes);
if (runs('labels')) await checkLabels(eventFilms);

console.log(broken
    ? `\n\x1b[31m${broken} contrôle(s) de contrat en échec.\x1b[0m Le format a bougé — c'est précisément le risque que ce canari surveille.`
    : '\n\x1b[32mContrat tenu.\x1b[0m Relancer quelques jours d\'affilée : la stabilité ne se mesure pas en un run.');
process.exit(broken ? 1 : 0);
