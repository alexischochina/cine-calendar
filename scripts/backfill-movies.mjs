// Script one-shot de backfill des métadonnées films (plan 2607241048).
//
// Lit toutes les lignes `calendar` sans `title`, résout title/poster_path/release_date
// via TMDB (concurrence limitée à 8 pour éviter le 429), et écrit le résultat en base.
//
// À lancer UNE SEULE FOIS, après la migration SQL (colonnes title/release_date/poster_path)
// et avant que les users rechargent le site.
//
// Usage :
//   node scripts/backfill-movies.mjs           # écrit en base
//   node scripts/backfill-movies.mjs --dry-run  # affiche sans écrire
//
// Variables .env requises : SUPABASE_URL, NUXT_API_BASE_URL, NUXT_API_KEY,
// et une clé Supabase avec droit d'update : NUXT_SUPABASE_SECRET_KEY (recommandé,
// contourne la RLS) sinon fallback SUPABASE_KEY (anon — l'update échouera si la RLS
// exige un user authentifié).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { promisePool } from '../app/utils/promisePool.js';
import { resolveFrenchReleaseDate, extractDirector, extractGenres, extractCountries } from '../server/utils/tmdbDates.js';

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
const API_BASE_URL = process.env.NUXT_API_BASE_URL;
const API_KEY = process.env.NUXT_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SUPABASE_KEY || !API_BASE_URL || !API_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY), NUXT_API_BASE_URL, NUXT_API_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const fetchMeta = async (movieId) => {
    const url = `${API_BASE_URL}/movie/${movieId}?api_key=${API_KEY}&language=fr-FR&region=FR&append_to_response=release_dates,credits`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status} pour ${movieId}`);
    const movie = await res.json();
    return {
        title: movie.title,
        poster_path: movie.poster_path,
        release_date: resolveFrenchReleaseDate(movie.release_dates),
        director: extractDirector(movie.credits),
        genres: extractGenres(movie),
        countries: extractCountries(movie),
    };
};

const run = async () => {
    // Lignes sans métadonnées (title null) OU déjà backfillées mais sans réalisateur / genres / pays.
    const { data: rows, error } = await supabase
        .from('calendar')
        .select('id, movie_id, title')
        .or('title.is.null,director.is.null,genres.is.null,countries.is.null');

    if (error) {
        console.error('Lecture Supabase échouée :', error.message);
        process.exit(1);
    }

    console.log(`${rows.length} ligne(s) à backfiller${DRY_RUN ? ' (dry-run)' : ''}.`);
    if (!rows.length) return;

    let ok = 0, failed = 0;
    const tasks = rows.map((row) => async () => {
        try {
            const meta = await fetchMeta(row.movie_id);
            if (DRY_RUN) {
                console.log(`  [dry] ${row.movie_id} → ${meta.title} | ${meta.release_date ?? 'sans date'} | ${meta.director ?? 'réal. inconnu'} | genres: ${meta.genres.join(', ') || '—'} | pays: ${meta.countries.join(', ') || '—'}`);
            } else {
                const { error: upErr } = await supabase
                    .from('calendar')
                    .update({ title: meta.title, poster_path: meta.poster_path, release_date: meta.release_date, director: meta.director, genres: meta.genres, countries: meta.countries })
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
