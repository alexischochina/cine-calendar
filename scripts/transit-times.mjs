// Temps de trajet domicile → salles, en transports en commun (plan 2608121539 — suite).
//
// Le domicile est fixe : le trajet vers une salle donnée est une **constante**. On la calcule une
// fois ici et on la stocke dans `cinemas.transit_minutes` — la page ne fait alors aucun appel
// sortant. Idempotent et relançable : seules les salles géocodées et sans temps de trajet sont
// traitées, donc on le rejoue à chaque nouvelle salle apparue.
//
// Source : API PRIM d'Île-de-France Mobilités (moteur Navitia), gratuite après inscription sur
// https://prim.iledefrance-mobilites.fr — c'est la référence pour l'Île-de-France.
//
// Usage :
//   node scripts/transit-times.mjs --dry-run              # affiche sans écrire
//   node scripts/transit-times.mjs                        # écriture
//   node scripts/transit-times.mjs --force                # recalcule tout
//   node scripts/transit-times.mjs --datetime 20260815T203000   # autre créneau de référence
//
// Variables .env requises :
//   PRIM_TOKEN            jeton PRIM
//   NUXT_PUBLIC_HOME_LAT  / NUXT_PUBLIC_HOME_LNG   domicile (déjà posés pour la distance)
//   SUPABASE_URL + NUXT_SUPABASE_SECRET_KEY (ou SUPABASE_KEY)

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { promisePool } from '../app/utils/promisePool.js';

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
const PRIM_TOKEN = process.env.PRIM_TOKEN;
const HOME_LAT = Number(process.env.NUXT_PUBLIC_HOME_LAT);
const HOME_LNG = Number(process.env.NUXT_PUBLIC_HOME_LNG);

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Créneau de référence : un vendredi soir, heure typique de séance. Le trajet dépend de l'heure
// (fréquences, dernier métro) — on fige un créneau représentatif plutôt que « maintenant », pour que
// deux salles restent comparables et que relancer le script ne fasse pas bouger les chiffres.
const datetimeArg = process.argv.indexOf('--datetime');
const DATETIME = datetimeArg !== -1 ? process.argv[datetimeArg + 1] : nextFridayEvening();

function nextFridayEvening() {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}
if (!PRIM_TOKEN) {
    console.error('PRIM_TOKEN manquant dans .env. Jeton gratuit sur https://prim.iledefrance-mobilites.fr');
    process.exit(1);
}
if (!Number.isFinite(HOME_LAT) || !Number.isFinite(HOME_LNG)) {
    console.error('NUXT_PUBLIC_HOME_LAT / NUXT_PUBLIC_HOME_LNG manquants dans .env.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PRIM_JOURNEYS = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys';

// Navitia attend `longitude;latitude` — l'ordre inverse de l'usage courant, source d'erreur
// silencieuse (un trajet plausible mais faux).
const point = (lat, lng) => `${lng};${lat}`;

const fetchTransitMinutes = async (cinema) => {
    const url = `${PRIM_JOURNEYS}?from=${point(HOME_LAT, HOME_LNG)}&to=${point(cinema.lat, cinema.lng)}&datetime=${DATETIME}`;

    const res = await fetch(url, {
        headers: { apikey: PRIM_TOKEN, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`PRIM ${res.status} ${(await res.text()).slice(0, 120)}`);

    const journeys = (await res.json())?.journeys ?? [];
    // On garde le trajet le plus court parmi ceux proposés (Navitia en renvoie plusieurs :
    // le plus rapide, le moins de correspondances, le plus de marche…).
    const durations = journeys.map(j => Number(j?.duration)).filter(Number.isFinite);
    if (!durations.length) return null;

    return {
        minutes: Math.round(Math.min(...durations) / 60),
        transfers: journeys.find(j => Number(j.duration) === Math.min(...durations))?.nb_transfers ?? null,
    };
};

const run = async () => {
    let query = supabase
        .from('cinemas')
        .select('code, name, lat, lng, transit_minutes')
        .not('lat', 'is', null)
        .order('code');
    if (!FORCE) query = query.is('transit_minutes', null);

    const { data: rows, error } = await query;
    if (error) {
        console.error('Lecture Supabase échouée :', error.message);
        process.exit(1);
    }

    console.log(`${rows.length} salle(s) à calculer${DRY_RUN ? ' (dry-run)' : ''}${FORCE ? ' (force)' : ''} — créneau ${DATETIME}.`);
    if (!rows.length) {
        console.log('Rien à faire. Les salles sans coordonnées sont ignorées : lance d\'abord scripts/geocode-cinemas.mjs.');
        return;
    }

    let ok = 0, empty = 0, failed = 0;
    const checkedAt = new Date().toISOString();

    // Concurrence basse : c'est une API publique gratuite, on ne la bouscule pas pour 46 requêtes.
    const tasks = rows.map((cinema) => async () => {
        try {
            const hit = await fetchTransitMinutes(cinema);
            if (!hit) {
                empty++;
                console.warn(`  ⚠ ${cinema.code} ${cinema.name} — aucun itinéraire proposé, laissé à null`);
                return;
            }

            if (DRY_RUN) {
                console.log(`  [dry] ${cinema.code} ${cinema.name} → ${hit.minutes} min (${hit.transfers ?? '?'} corresp.)`);
            } else {
                const { error: upErr } = await supabase
                    .from('cinemas')
                    .update({ transit_minutes: hit.minutes, transit_checked_at: checkedAt, updated_at: checkedAt })
                    .eq('code', cinema.code);
                if (upErr) throw new Error(upErr.message);
            }
            ok++;
        } catch (e) {
            failed++;
            console.error(`  ✗ ${cinema.code} ${cinema.name} : ${e.message}`);
        }
    });

    await promisePool(tasks, 4);
    console.log(`Terminé : ${ok} calculé(s), ${empty} sans itinéraire, ${failed} échec(s).`);
};

run();
