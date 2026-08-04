// Script one-shot de backfill des notes Letterboxd (plan 2608031000).
//
// Parcourt les lignes `calendar` non vues et déjà sorties dont la note Letterboxd est
// absente ou périmée (> 7 j), scrape le JSON-LD de letterboxd.com/tmdb/{id}/ (concurrence
// limitée à 8) et écrit letterboxd_rating + letterboxd_rating_at en base. Idempotent :
// relançable sans effet de bord (les notes fraîches sont ignorées).
//
// À lancer après la migration SQL (colonnes letterboxd_rating / letterboxd_rating_at),
// pour éviter d'attendre la population paresseuse à la première ouverture de la vue Stats.
//
// Usage :
//   node scripts/backfill-letterboxd.mjs           # écrit en base
//   node scripts/backfill-letterboxd.mjs --dry-run  # affiche sans écrire
//
// Variables .env requises : SUPABASE_URL et une clé Supabase avec droit d'update
// (NUXT_SUPABASE_SECRET_KEY recommandé, contourne la RLS ; sinon fallback SUPABASE_KEY).

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

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Même extraction que server/api/movies/[id]/letterboxd.js : JSON-LD aggregateRating.
const extractRating = (html) => {
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!match) return null;
    const raw = match[1].replace(/\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\//, '').trim();
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    const rating = Number(data?.aggregateRating?.ratingValue);
    return Number.isFinite(rating) ? rating : null;
};

const fetchRating = async (movieId) => {
    const res = await fetch(`https://letterboxd.com/tmdb/${movieId}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cine-calendar/1.0)' },
    });
    if (!res.ok) return null;
    return extractRating(await res.text());
};

const run = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Non vus, déjà sortis, note absente ou périmée (> 7 j).
    const { data: rows, error } = await supabase
        .from('calendar')
        .select('id, movie_id, title, letterboxd_rating_at')
        .neq('state', 'seen')
        .not('release_date', 'is', null)
        .lte('release_date', today)
        .or(`letterboxd_rating_at.is.null,letterboxd_rating_at.lt.${staleBefore}`);

    if (error) {
        console.error('Lecture Supabase échouée :', error.message);
        process.exit(1);
    }

    console.log(`${rows.length} ligne(s) à backfiller${DRY_RUN ? ' (dry-run)' : ''}.`);
    if (!rows.length) return;

    const nowIso = new Date().toISOString();
    let ok = 0, failed = 0;
    const tasks = rows.map((row) => async () => {
        try {
            const rating = await fetchRating(row.movie_id);
            if (DRY_RUN) {
                console.log(`  [dry] ${row.movie_id} → ${row.title ?? '?'} | note: ${rating ?? '—'}`);
            } else {
                const { error: upErr } = await supabase
                    .from('calendar')
                    .update({ letterboxd_rating: rating, letterboxd_rating_at: nowIso })
                    .eq('id', row.id);
                if (upErr) throw new Error(upErr.message);
            }
            ok++;
        } catch (e) {
            failed++;
            console.error(`  ✗ ${row.movie_id} : ${e.message}`);
        }
    });

    await promisePool(tasks, 8);
    console.log(`Terminé : ${ok} ok, ${failed} échec(s).`);
};

run();
