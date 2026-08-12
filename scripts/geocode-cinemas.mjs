// Géocodage du référentiel des salles (plan 2608121539 — page « Séances »).
//
// Lit les lignes de `cinemas` sans coordonnées, interroge la Base Adresse Nationale (API publique
// de l'État, gratuite et sans clé), et écrit `lat` / `lng` / `geocode_score` / `geocoded_at` +
// `arrondissement` déduit de `properties.district` — plus fiable que découper le code postal.
//
// Idempotent et relançable : il ne travaille que sur les lignes non géocodées, donc on le rejoue à
// chaque nouvelle salle apparue dans le référentiel. À lancer APRÈS un premier affichage de la vue
// Séances, qui est ce qui peuple `cinemas`.
//
// Usage :
//   node scripts/geocode-cinemas.mjs            # écrit en base
//   node scripts/geocode-cinemas.mjs --dry-run  # affiche sans écrire
//   node scripts/geocode-cinemas.mjs --force    # reprend aussi les salles déjà géocodées
//
// Variables .env requises : SUPABASE_URL + une clé avec droit d'update (NUXT_SUPABASE_SECRET_KEY
// recommandée, elle contourne la RLS ; repli sur SUPABASE_KEY).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { promisePool } from '../app/utils/promisePool.js';

// --- chargement .env minimal (pas de dépendance dotenv) ---
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
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');


// En dessous, la BAN a rapproché l'adresse d'autre chose (voie approchante, commune seule) : on
// préfère une distance absente à une position fausse — l'UI n'affiche simplement rien.
const MIN_SCORE = 0.5;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// « Paris 6e Arrondissement » → 6 ; « Paris 1er Arrondissement » → 1.
const parseDistrict = (district, zip) => {
    const fromDistrict = String(district ?? '').match(/(\d{1,2})\s*(?:er|e|ème)?\s*arrondissement/i);
    if (fromDistrict) return Number(fromDistrict[1]);
    // Repli sur le code postal si la BAN ne renseigne pas `district`. `750xx` et `751xx` cohabitent
    // à Paris (75116 pour Passy) — ne traiter que la première famille perdrait ces salles.
    const fromZip = String(zip ?? '').match(/^75[01](\d{2})$/);
    if (!fromZip) return null;
    const n = Number(fromZip[1]);
    return n >= 1 && n <= 20 ? n : null;
};

// Abréviations maison d'Allociné, que la BAN ne reconnaît pas toujours.
const ABBREVIATIONS = [
    [/\bbd\b\.?/gi, 'boulevard'], [/\bbld\b\.?/gi, 'boulevard'], [/\bav\b\.?/gi, 'avenue'],
    [/\bpl\b\.?/gi, 'place'], [/\bprte\b\.?/gi, 'porte'], [/\bfg\b\.?/gi, 'faubourg'],
];

// Beaucoup d'adresses Allociné ne sont pas des adresses : elles empilent les entrées d'un même
// cinéma ou son contexte (« 30 Rue Saint-André des Arts : caisse, salles 1 & 2 - 12 rue Gît-le-Cœur »,
// « 2 Pl. de la Prte Maillot, Palais des Congres, les Boutiques du Palais », « 140, bd de Clichy et
// 8, av de Clichy »). On garde le premier segment et on déplie les abréviations : sur ces trois cas
// réels, le score passe de 0,37–0,47 à 0,97–0,98.
const cleanAddress = (address) => {
    let out = String(address ?? '')
        .split(/\s*:\s*|\s+-\s+|\s+et\s+\d|,\s*(?=(?:palais|les |centre|niveau|salle|caisse))/i)[0];
    out = out.split(',').slice(0, 2).join(',');
    for (const [pattern, full] of ABBREVIATIONS) out = out.replace(pattern, full);
    return out.trim().replace(/[,;]\s*$/, '');
};

const lookup = async (query) => {
    const res = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`,
        { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`BAN ${res.status}`);

    const feature = (await res.json()).features?.[0];
    if (!feature) return null;

    return {
        lat: feature.geometry?.coordinates?.[1] ?? null,
        lng: feature.geometry?.coordinates?.[0] ?? null,
        score: feature.properties?.score ?? 0,
        label: feature.properties?.label ?? '',
        arrondissement: parseDistrict(feature.properties?.district, feature.properties?.postcode),
    };
};

// Adresse telle quelle d'abord — quand elle est propre, c'est la plus précise. Seconde tentative
// sur l'adresse nettoyée uniquement si la première déçoit, pour ne pas dégrader les bons cas.
const geocode = async (cinema) => {
    const suffix = [cinema.zip, 'Paris'].filter(Boolean).join(' ');

    const direct = await lookup([cinema.address, suffix].filter(Boolean).join(' '));
    if (direct && direct.score >= MIN_SCORE) return direct;

    const cleaned = cleanAddress(cinema.address);
    if (!cleaned || cleaned === String(cinema.address ?? '').trim()) return direct;

    const retry = await lookup([cleaned, suffix].filter(Boolean).join(' '));
    // On garde la meilleure des deux : le nettoyage peut aussi rater.
    return (retry?.score ?? 0) > (direct?.score ?? 0) ? retry : direct;
};

const run = async () => {
    let query = supabase.from('cinemas').select('code, name, address, zip').order('code');
    if (!FORCE) query = query.is('lat', null);

    const { data: rows, error } = await query;
    if (error) {
        console.error('Lecture Supabase échouée :', error.message);
        process.exit(1);
    }

    console.log(`${rows.length} salle(s) à géocoder${DRY_RUN ? ' (dry-run)' : ''}${FORCE ? ' (force)' : ''}.`);
    if (!rows.length) return;

    let ok = 0, rejected = 0, failed = 0;
    const geocodedAt = new Date().toISOString();

    const tasks = rows.map((cinema) => async () => {
        try {
            const hit = await geocode(cinema);

            if (!hit || hit.score < MIN_SCORE || hit.lat == null) {
                rejected++;
                console.warn(`  ⚠ ${cinema.code} ${cinema.name} — score ${hit ? hit.score.toFixed(2) : 'n/a'} < ${MIN_SCORE}, laissé sans coordonnées (adresse : « ${cinema.address ?? '—'} »)`);
                return;
            }


            if (DRY_RUN) {
                console.log(`  [dry] ${cinema.code} ${cinema.name} → ${hit.lat.toFixed(5)},${hit.lng.toFixed(5)} | ${hit.arrondissement ?? '?'}e | score ${hit.score.toFixed(2)} | ${hit.label}`);
            } else {
                const { error: upErr } = await supabase
                    .from('cinemas')
                    .update({
                        lat: hit.lat,
                        lng: hit.lng,
                        geocode_score: hit.score,
                        geocoded_at: geocodedAt,
                        arrondissement: hit.arrondissement,
                        updated_at: geocodedAt,
                    })
                    .eq('code', cinema.code);
                if (upErr) throw new Error(upErr.message);
            }
            ok++;
        } catch (e) {
            failed++;
            console.error(`  ✗ ${cinema.code} ${cinema.name} : ${e.message}`);
        }
    });

    await promisePool(tasks, 8);
    console.log(`Terminé : ${ok} géocodée(s), ${rejected} rejetée(s) pour score faible, ${failed} échec(s).`);
};

run();
