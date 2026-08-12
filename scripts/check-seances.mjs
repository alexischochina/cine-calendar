// Contrôle de santé de la vue Séances (plan 2608121539).
//
// Répond à une seule question : « est-ce que la récupération des séances marche encore ? ».
// Lecture seule, aucune écriture, ~4 requêtes sortantes. À lancer quand un doute survient, ou de
// temps en temps — typiquement le mercredi, jour où les salles renouvellent leur programmation.
//
//   node scripts/check-seances.mjs
//
// Trois familles de contrôles :
//   1. CONTRAT   — Allociné répond-il encore dans le format qu'attend le client ? C'est le canari :
//                  si Allociné renomme une route ou change sa forme, tout dégrade en silence
//                  (pages vides, films « non trouvés ») et rien d'autre ne le signalerait.
//   2. RÉSOLUTION— combien de films en salle sont rapprochés d'une fiche, et depuis quand.
//   3. RÉFÉRENTIEL — salles sans géocodage / sans temps de trajet, donc arrivées après le dernier
//                  passage des scripts.
//
// Sort en code 1 si un contrôle de contrat échoue, pour être branchable sur une tâche planifiée.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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
const UA = 'Mozilla/5.0 (compatible; cine-calendar/1.0)';
const PARIS = 115755;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const ko = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

const isoDay = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const days = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

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

    const { data, error } = await supabase
        .from('calendar')
        .select('title, allocine_id, allocine_checked_at')
        .eq('state', 'inTheaters');
    if (error) { ko(`lecture calendar : ${error.message}`); broken++; return; }

    const resolved = data.filter(m => m.allocine_id);
    const unresolved = data.filter(m => !m.allocine_id);

    ok(`${resolved.length}/${data.length} rapprochés d'une fiche Allociné`);

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

console.log('\x1b[1m— Contrôle de santé « Séances » —\x1b[0m');
await checkContract();
await checkResolution();
await checkData();

console.log(broken
    ? `\n\x1b[31m${broken} contrôle(s) de contrat en échec.\x1b[0m Voir server/utils/allocine.js — c'est le seul fichier à corriger.`
    : '\n\x1b[32mTout est opérationnel.\x1b[0m');
process.exit(broken ? 1 : 0);
