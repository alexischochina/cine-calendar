// Contrôle de santé de la vue Séances.
//
// Répond à une seule question : « est-ce que la récupération des séances marche encore ? ».
// À lancer quand un doute survient, ou de temps en temps — typiquement le mercredi, jour où les
// salles renouvellent leur programmation.
//
// ⚠️ Lecture seule **sauf `--mute`**, qui persiste son verdict dans `cinemas.allocine_silent_since`
// et `allocine_checked_at` — c'est ce qui permet à la vue de dire « cette salle est absente
// d'Allociné depuis le … » au lieu de la passer sous silence (cf. `2608131800-add-cinema-silence.sql`).
//
//   node scripts/check-seances.mjs                 # tout
//   node scripts/check-seances.mjs --drift --mute  # seulement ces contrôles
//
// Cinq familles de contrôles. Les trois premières sont quasi instantanées, les deux dernières
// sortent sur le réseau (~1 min) — d'où les drapeaux, pour ne relancer que ce qu'on surveille.
//   1. `--contract`   — Allociné répond-il encore dans le format qu'attend le client ? C'est le
//                       canari : s'il renomme une route ou change sa forme, tout dégrade en silence
//                       (pages vides, films « non trouvés ») et rien d'autre ne le signalerait.
//   2. `--resolution` — combien de films en salle sont rapprochés d'une fiche, et depuis quand.
//   3. `--data`       — cache, puis salles sans géocodage / sans temps de trajet, donc arrivées
//                       après le dernier passage des scripts.
//   4. `--drift`      — ce qu'on **sert** est-il encore d'accord avec la source ? (cf. plus bas)
//   5. `--mute`       — une salle connue a-t-elle disparu d'Allociné ?
//
// Sort en code 1 si un contrôle de contrat échoue, pour être branchable sur une tâche planifiée.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// Mêmes règles que l'app et le serveur : un contrôle de santé qui daterait ses journées ou lirait
// ses erreurs autrement que le code qu'il surveille ne surveillerait plus rien.
import { isoDay, lastWednesday } from '../shared/utils/cineWeek.js';
import { isMissingSchema } from '../shared/utils/pgErrors.js';

const loadEnv = () => {
    try {
        const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
        for (const line of raw.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* .env absent : on compte sur l'environnement */ }
};
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.NUXT_SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
// Même identité que le client (`server/utils/allocine.js`) : un contrôle de santé qui ne se
// présenterait pas comme l'app ne contrôlerait pas ce que l'app subit.
const UA = 'cinegenda/1.0';
const PARIS = 115755;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const ko = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

const days = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

// Contrôles sélectifs : les deux derniers sortent sur le réseau et prennent une minute. Sans
// argument, tout tourne (comportement historique).
const ONLY = process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2));
const runs = (name) => !ONLY.length || ONLY.includes(name);

let broken = 0;

// --- 1. Contrat Allociné ------------------------------------------------------------------------
const checkContract = async () => {
    console.log('\n\x1b[1mContrat Allociné\x1b[0m');

    // a. Recherche : c'est elle qui résout titre → identifiant.
    try {
        const r = await fetch(`https://www.allocine.fr/_/autocomplete/${encodeURIComponent('Toy Story')}`,
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        const movie = (j?.results ?? []).find(x => x.entity_type === 'movie');
        if (!movie) throw new Error('aucun film dans les résultats');
        for (const field of ['entity_id', 'label', 'original_label']) {
            if (!(field in movie)) throw new Error(`champ « ${field} » disparu`);
        }
        ok(`recherche : ${j.results.length} résultats, champs attendus présents`);
    } catch (e) {
        ko(`recherche cassée — ${e.message}. La résolution des nouveaux films ne fonctionnera plus.`);
        broken++;
    }

    // b. Séances : la route et la forme du payload.
    try {
        const r = await fetch(`https://www.allocine.fr/_/showtimes/movie-313256/near-${PARIS}/d-${isoDay(1)}/p-1/`,
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();

        if (!('pagination' in j) || !('results' in j)) throw new Error('enveloppe { pagination, results } disparue');
        const first = j.results?.[0];
        if (first) {
            for (const path of [['theater', 'internalId'], ['theater', 'location', 'zip'], ['showtimes']]) {
                let node = first;
                for (const key of path) node = node?.[key];
                if (node === undefined) throw new Error(`champ « ${path.join('.')} » disparu`);
            }
            const showtime = Object.values(first.showtimes ?? {}).flat()[0];
            for (const field of ['startsAt', 'diffusionVersion', 'tags']) {
                if (showtime && !(field in showtime)) throw new Error(`champ séance « ${field} » disparu`);
            }
        }
        ok(`séances : ${j.results?.length ?? 0} salles page 1, forme du payload conforme`);
    } catch (e) {
        ko(`séances cassées — ${e.message}. La vue se videra sans autre signal.`);
        broken++;
    }
};

// --- 2. Résolution des films --------------------------------------------------------------------
const checkResolution = async () => {
    console.log('\n\x1b[1mFilms en salle\x1b[0m');

    let { data, error } = await supabase
        .from('calendar')
        .select('title, allocine_id, allocine_checked_at, in_theaters_checked_at')
        .eq('state', 'inTheaters');

    // Migration du contrôle hebdomadaire pas encore jouée : on continue sans elle plutôt que de
    // perdre les deux autres familles de contrôles.
    let checkColumn = true;
    if (isMissingSchema(error)) {
        checkColumn = false;
        warn('colonne `in_theaters_checked_at` absente → joue _ressources/sql/2608131000-add-in-theaters-check.sql (le contrôle « en salle » est inactif)');
        ({ data, error } = await supabase
            .from('calendar')
            .select('title, allocine_id, allocine_checked_at')
            .eq('state', 'inTheaters'));
    }
    if (error) { ko(`lecture calendar : ${error.message}`); broken++; return; }

    const resolved = data.filter(m => m.allocine_id);
    const unresolved = data.filter(m => !m.allocine_id);

    ok(`${resolved.length}/${data.length} rapprochés d'une fiche Allociné`);

    // L'état « en salle » est contrôlé une fois par semaine ciné (mercredi). Un horodatage plus
    // vieux que le dernier mercredi veut dire que le contrôle ne tourne plus — auquel cas la liste
    // se fige et redevient ce qu'elle était avant : collante.
    const stamped = data.filter(m => m.in_theaters_checked_at);
    if (stamped.length) {
        const stale = stamped.filter(m => Date.parse(m.in_theaters_checked_at) < lastWednesday());
        if (stale.length) warn(`${stale.length}/${stamped.length} film(s) non recontrôlés depuis le dernier mercredi — ouvrir l'app suffit à relancer le contrôle`);
        else ok(`affiche contrôlée cette semaine (${stamped.length} film(s))`);
    } else if (checkColumn && data.length) {
        warn('aucun film encore contrôlé sur ses séances — ouvrir l\'app lance le premier passage');
    }

    for (const m of unresolved) {
        const age = m.allocine_checked_at ? `${days(m.allocine_checked_at)} j` : 'jamais tenté';
        warn(`« ${m.title} » non trouvé (dernière tentative : ${age}) — nouvel essai automatique après 7 j`);
    }
    if (unresolved.length > data.length / 2) {
        ko(`plus de la moitié des films non résolus : suspecter une panne de la recherche plutôt que le catalogue`);
        broken++;
    }
};

// --- 3. Cache et référentiel --------------------------------------------------------------------
const checkData = async () => {
    console.log('\n\x1b[1mCache des séances\x1b[0m');

    const { data: cache } = await supabase
        .from('showtimes_cache')
        .select('allocine_id, date, fetched_at')
        .gte('date', isoDay(0));

    const today = (cache ?? []).filter(c => c.date === isoDay(0));
    ok(`${cache?.length ?? 0} entrées à venir, dont ${today.length} pour aujourd'hui`);
    const oldest = (cache ?? []).map(c => c.fetched_at).sort()[0];
    if (oldest) ok(`plus ancienne écriture : il y a ${days(oldest)} j (invalidation forcée chaque mercredi)`);

    console.log('\n\x1b[1mRéférentiel des salles\x1b[0m');
    const { data: cinemas, error } = await supabase
        .from('cinemas')
        .select('code, name, accepts_ugc, lat, transit_minutes');
    if (error) { ko(`lecture cinemas : ${error.message}`); broken++; return; }

    const noGeo = cinemas.filter(c => c.lat == null);
    const noTransit = cinemas.filter(c => c.transit_minutes == null);
    ok(`${cinemas.length} salles · ${cinemas.filter(c => c.accepts_ugc).length} acceptent la carte UGC`);

    if (noGeo.length) warn(`${noGeo.length} sans coordonnées → node scripts/geocode-cinemas.mjs  (${noGeo.map(c => c.name).join(', ')})`);
    else ok('toutes géocodées');

    if (noTransit.length) warn(`${noTransit.length} sans temps de trajet → node scripts/transit-times.mjs  (${noTransit.map(c => c.name).join(', ')})`);
    else ok('toutes avec un temps de trajet');

    // Une salle apparue après le seed prend l'acceptation annoncée par Allociné : à relire à l'œil.
    const recent = cinemas.filter(c => c.lat == null || c.transit_minutes == null);
    if (recent.length) warn('salles récentes : contrôler leur statut carte UGC → node scripts/set-cinema-ugc.mjs --audit');
};

// --- 4. Écart cache / Allociné ------------------------------------------------------------------
//
// Le canari qui manquait. Le contrôle de contrat dit si Allociné répond *dans le bon format* ; il ne
// dit rien de ce qu'on **sert** à l'écran, qui vient du cache et peut avoir vieilli. Or c'est par là
// qu'on se fait avoir : le 13/08/2026, l'entrée du dimanche pour « La fin d'Oak Street » portait 23
// salles au lieu de 24 — UGC Ciné Cité Les Halles avait ouvert ses ventes après l'écriture. Rien,
// nulle part, ne le signalait : il a fallu ouvrir ugc.fr à côté pour s'en apercevoir.
//
// Ce contrôle rejoue donc ce que l'œil a fait : pour quelques films, il compare l'entrée en cache à
// une lecture fraîche d'Allociné, et nomme les salles qui manquent. Il ne suppose aucune cause —
// TTL trop long, page perdue, salle disparue du référentiel donnent tous le même symptôme, et c'est
// ce symptôme qu'on mesure.
const SAMPLE_MOVIES = 3;
const SAMPLE_OFFSET = 3;   // un jour « lointain » : c'est là que le TTL est le plus long

const fetchParisTheaters = async (allocineId, date) => {
    const page = async (p) => {
        try {
            const r = await fetch(`https://www.allocine.fr/_/showtimes/movie-${allocineId}/near-${PARIS}/d-${date}/p-${p}/`,
                { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
            return await r.json();
        } catch { return null; }
    };

    const first = await page(1);
    if (!first) return null;
    if (first.error) return [];

    const total = Number(first.pagination?.totalPages) || 1;
    const rest = [];
    for (let p = 2; p <= total; p++) rest.push(await page(p));
    if (rest.some(r => !r)) return null;   // lecture incomplète : on ne compare pas, on se tairait à tort

    return [first, ...rest]
        .flatMap(payload => payload.results ?? [])
        .filter(r => r?.theater?.internalId && /^75/.test(String(r.theater.location?.zip ?? '')))
        .map(r => ({ code: r.theater.internalId, name: r.theater.name }));
};

const checkDrift = async () => {
    const date = isoDay(SAMPLE_OFFSET);
    console.log(`\n\x1b[1mÉcart cache / Allociné (${date})\x1b[0m`);

    const { data: cached } = await supabase
        .from('showtimes_cache')
        .select('allocine_id, payload, fetched_at')
        .eq('date', date)
        // Ordre explicite : sans lui, l'échantillon change à chaque exécution et deux runs ne sont
        // plus comparables. Les entrées les plus fraîches sont aussi les plus révélatrices — un
        // écart sur elles ne peut pas s'expliquer par l'âge.
        .order('fetched_at', { ascending: false })
        .limit(SAMPLE_MOVIES);

    if (!cached?.length) { ok('aucune entrée en cache pour ce jour — rien à comparer'); return; }

    const { data: films } = await supabase
        .from('calendar')
        .select('title, allocine_id')
        .in('allocine_id', cached.map(c => c.allocine_id));
    const titleOf = (id) => films?.find(f => f.allocine_id === id)?.title ?? `film ${id}`;

    let drifted = 0;

    for (const entry of cached) {
        const live = await fetchParisTheaters(entry.allocine_id, date);
        if (live === null) { warn(`${titleOf(entry.allocine_id)} — Allociné injoignable, comparaison sautée`); continue; }

        const inCache = new Set((entry.payload?.theaters ?? []).map(t => t.code));
        const missing = live.filter(t => !inCache.has(t.code));
        const extra = [...inCache].filter(code => !live.some(t => t.code === code));
        const age = Math.round((Date.now() - Date.parse(entry.fetched_at)) / 60000);

        if (!missing.length && !extra.length) {
            ok(`${titleOf(entry.allocine_id)} — ${inCache.size} salles, identique à Allociné (relevé il y a ${age} min)`);
            continue;
        }

        drifted++;
        // Manquantes = ce que l'utilisateur ne voit pas alors que ça existe. C'est le cas grave :
        // l'inverse (des salles en trop) se corrige tout seul à l'expiration et ne cache rien.
        if (missing.length) warn(`${titleOf(entry.allocine_id)} — ${missing.length} salle(s) absente(s) du cache après ${age} min : ${missing.map(t => t.name).join(', ')}`);
        if (extra.length) warn(`${titleOf(entry.allocine_id)} — ${extra.length} salle(s) en cache qu'Allociné ne rend plus`);
    }

    if (drifted) {
        warn(`TTL des jours lointains : 3 h (server/utils/showtimesFreshness.js). Un écart passager est normal —`);
        warn(`  un écart **systématique**, lui, veut dire qu'il faut raccourcir encore, ou soupçonner une page perdue.`);
    }
};

// --- 5. Salles muettes --------------------------------------------------------------------------
//
// Le canari nº 4 compare ce qu'on sert à ce qu'Allociné dit. Celui-ci va plus loin : il vérifie
// qu'Allocino **dit encore quelque chose** sur les salles qu'on connaît.
//
// Cas fondateur, 13/08/2026 : UGC Ciné Cité Les Halles a disparu d'Allociné — non pas d'un film,
// mais de *tout*. Interrogée par film comme par salle, sur les 7 jours, la réponse était `0 film`,
// alors qu'ugc.fr affichait 7 séances par jour et qu'UGC Maillot rendait ses 16 films normalement.
// Aucune ligne de notre pipeline ne peut inventer ces séances : la lacune est en amont. Ce qui est
// en notre pouvoir, c'est de ne pas la subir en silence — un multiplexe qui ne joue rien de la
// semaine n'existe pas, et c'est cette invraisemblance qu'on teste.
// ⚠️ Deux endpoints, deux vérités. `theater-<code>` est **creux** : mesuré le 13/08/2026, il ne rend
// que 1 à 2 jours sur 7 là où `movie-<id>/near-Paris` en rend 6 pour les mêmes salles (Bercy 2 vs 6,
// Les Halles 1 vs 6). Une salle « muette » vue par lui peut donc être parfaitement programmée dans
// l'endpoint qu'on utilise réellement. Un contrôle qui s'arrêterait là ferait afficher à la vue un
// avertissement faux — pire que pas d'avertissement du tout.
//
// D'où deux temps : `theater-` sert de **filtre** (il est direct et peu coûteux), et toute salle
// qu'il accuse est **confirmée** par l'endpoint de production sur un film largement diffusé.
const MUTE_CONCURRENCY = 4;

// Cherche une salle dans les réponses `movie-` d'un film témoin. `true` = elle y est (donc pas
// muette), `false` = absente partout, `null` = on n'a pas pu se prononcer.
const seenInMovieEndpoint = async (code, allocineId, dates) => {
    let reachable = false;

    for (const date of dates) {
        let page = 1, total = 1;
        while (page <= total) {
            try {
                const r = await fetch(`https://www.allocine.fr/_/showtimes/movie-${allocineId}/near-${PARIS}/d-${date}/p-${page}/`,
                    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
                const j = await r.json();
                reachable = true;
                if (j?.error) break;
                total = Number(j?.pagination?.totalPages) || 1;
                if ((j.results ?? []).some(x => x?.theater?.internalId === code)) return true;
            } catch { /* page perdue : on continue, le verdict restera prudent */ }
            page++;
        }
    }
    return reachable ? false : null;
};

const theaterDay = async (code, date) => {
    try {
        const r = await fetch(`https://www.allocine.fr/_/showtimes/theater-${code}/d-${date}/p-1/`,
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        return Number(j?.pagination?.totalItems) || 0;
    } catch { return null; }
};

const checkMuteTheaters = async () => {
    console.log('\n\x1b[1mSalles muettes chez Allociné\x1b[0m');

    const { data: cinemas, error } = await supabase
        .from('cinemas')
        .select('code, name, accepts_ugc')
        .eq('accepts_ugc', true);
    if (error) { ko(`lecture cinemas : ${error.message}`); broken++; return; }

    const near = isoDay(1);
    const far = isoDay(3);
    const suspects = [];
    let unreachable = 0;

    const queue = [...cinemas];
    await Promise.all(Array.from({ length: MUTE_CONCURRENCY }, async () => {
        while (queue.length) {
            const c = queue.shift();
            const first = await theaterDay(c.code, near);
            if (first === null) { unreachable++; continue; }
            if (first > 0) continue;

            // Vide demain : deuxième avis sur un jour plus loin avant de crier au loup — une salle
            // peut fermer une journée (travaux, relâche), pas toute la semaine.
            const second = await theaterDay(c.code, far);
            if (second === 0) suspects.push(c);
        }
    }));

    if (unreachable) warn(`${unreachable} salle(s) non interrogeables (réseau)`);

    // Confirmation par l'endpoint de production (cf. l'avertissement au-dessus). Le film témoin est
    // celui qui touche le plus de salles dans notre cache : plus il est diffusé, plus son absence
    // d'une salle est significative.
    const mute = [];
    if (suspects.length) {
        const { data: cache } = await supabase
            .from('showtimes_cache')
            .select('allocine_id, payload')
            .gte('date', isoDay(0));

        const widest = (cache ?? [])
            .map(c => ({ id: c.allocine_id, reach: (c.payload?.theaters ?? []).length }))
            .sort((a, b) => b.reach - a.reach)[0];

        if (!widest?.id) {
            warn('aucun film témoin en cache — confirmation impossible, verdicts laissés en suspens');
            return;
        }

        for (const c of suspects) {
            const seen = await seenInMovieEndpoint(c.code, widest.id, [isoDay(0), near, far]);
            if (seen === true) {
                ok(`« ${c.name} » vue creuse par /theater/ mais bien programmée par /movie/ — faux positif écarté`);
                continue;
            }
            if (seen === null) { warn(`« ${c.name} » — confirmation impossible (réseau), verdict suspendu`); continue; }
            mute.push(c);
        }
    }

    // Le verdict est **persisté** : c'est lui qui permet à la vue de dire « cette salle est absente
    // d'Allociné depuis le … » au lieu de la passer sous silence. Seule écriture de ce script, et
    // elle est réversible — une salle qui reparle est immédiatement réhabilitée.
    const today = isoDay(0);
    const now = new Date().toISOString();
    const muteCodes = new Set(mute.map(c => c.code));

    // Muettes : on ne réécrit pas `allocine_silent_since` si elle est déjà posée, sinon la date
    // avancerait à chaque contrôle et « depuis le … » ne voudrait plus rien dire.
    //
    // Une lecture groupée puis deux écritures groupées, là où c'était deux requêtes **par salle** :
    // les salles muettes arrivent par vagues (la panne du 13/08/2026 en a fait tomber plusieurs d'un
    // coup), et c'est précisément le jour où le contrôle doit rendre la main vite.
    if (mute.length) {
        const muted = mute.map(c => c.code);
        const { data: rows, error: readErr } = await supabase
            .from('cinemas').select('code, allocine_silent_since').in('code', muted);

        if (isMissingSchema(readErr)) {
            warn('colonnes de silence absentes → joue _ressources/sql/2608131800-add-cinema-silence.sql (sans elles, la vue ne peut pas signaler cette absence)');
        } else {
            // Déjà signalées : on ne touche qu'à l'horodatage du contrôle. Nouvelles : on pose la date
            // du jour, qui est ce que la vue affichera (« absente depuis le 13/08 »).
            const known = new Set((rows ?? []).filter(r => r.allocine_silent_since).map(r => r.code));
            const fresh = muted.filter(code => !known.has(code));

            for (const [codes, patch] of [
                [[...known], { allocine_checked_at: now }],
                [fresh, { allocine_silent_since: today, allocine_checked_at: now }],
            ]) {
                if (!codes.length) continue;
                const { error: upErr } = await supabase.from('cinemas').update(patch).in('code', codes);
                if (isMissingSchema(upErr)) {
                    warn('colonnes de silence absentes → joue _ressources/sql/2608131800-add-cinema-silence.sql (sans elles, la vue ne peut pas signaler cette absence)');
                    break;
                }
                if (upErr) warn(`écriture du silence échouée : ${upErr.message}`);
            }
        }
    }

    // Les autres reparlent : on efface.
    const speaking = cinemas.filter(c => !muteCodes.has(c.code)).map(c => c.code);
    if (speaking.length) {
        const { error: clearErr } = await supabase.from('cinemas')
            .update({ allocine_silent_since: null, allocine_checked_at: now })
            .in('code', speaking);
        if (clearErr && !isMissingSchema(clearErr)) warn(`remise à zéro du silence échouée : ${clearErr.message}`);
    }

    if (!mute.length) {
        ok(`${cinemas.length} salles carte UGC interrogées, toutes programmées`);
        return;
    }

    for (const c of mute) {
        warn(`« ${c.name} » (${c.code}) ne rend aucune séance sur ${near} ni ${far} — vérifier sur le site de la salle`);
    }
    warn('  une salle muette toute la semaine est une lacune d\'Allociné, pas du cache : ses séances');
    warn('  sont invisibles dans la vue tant qu\'Allociné ne les republie pas. La vue le signale désormais.');
};

console.log('\x1b[1m— Contrôle de santé « Séances » —\x1b[0m');
if (runs('contract')) await checkContract();
if (runs('resolution')) await checkResolution();
if (runs('data')) await checkData();
if (runs('drift')) await checkDrift();
if (runs('mute')) await checkMuteTheaters();

console.log(broken
    ? `\n\x1b[31m${broken} contrôle(s) de contrat en échec.\x1b[0m Voir server/utils/allocine.js — c'est le seul fichier à corriger.`
    : '\n\x1b[32mTout est opérationnel.\x1b[0m');
process.exit(broken ? 1 : 0);
