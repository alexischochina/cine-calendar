// Script de backfill des données Letterboxd (plans 2608031000 et 2608161000).
//
// Deux choses, lues dans le **même** JSON-LD de letterboxd.com/tmdb/{id}/ (une requête par film,
// concurrence limitée à 8) :
//   - la note, pour les lignes non vues et déjà sorties dont la note est absente ou périmée (> 7 j) ;
//   - les liens réalisateurs, pour **toute** ligne qui a un réalisateur et pas encore ses liens —
//     y compris les films vus et à venir, que la vue Stats ne rafraîchit jamais mais que la
//     timeline affiche.
// Idempotent, relançable sans effet de bord. À lancer après les migrations SQL correspondantes.
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
import { parseLetterboxdFilm } from '../shared/utils/letterboxdFilm.js';

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

const fetchFilm = async (movieId) => {
    const res = await fetch(`https://letterboxd.com/tmdb/${movieId}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cinegenda/1.0)' },
    });
    if (!res.ok) return { rating: null, count: null, directors: [] };
    return parseLetterboxdFilm(await res.text());
};

// PostgREST plafonne les réponses (`max-rows`, 1000 par défaut) : sans pagination, une bibliothèque
// qui dépasse ce seuil serait traitée en partie pendant que le script annonce « Terminé ».
const PAGE = 500;

const fetchAllRows = async () => {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from('calendar')
            .select('id, movie_id, title, state, release_date, director, letterboxd_rating_at, letterboxd_directors')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...data);
        if (data.length < PAGE) return rows;
    }
};

const run = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const staleBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;

    let rows;
    try {
        rows = await fetchAllRows();
    } catch (e) {
        console.error('Lecture Supabase échouée :', e.message);
        process.exit(1);
    }

    // Deux raisons distinctes de sortir chez Letterboxd, une seule requête quand les deux valent.
    // ⚠️ Comparaison sur des instants, pas sur des chaînes : PostgREST sérialise en `…+00:00` là où
    // `toISOString()` produit `…Z`, et `'+' < 'Z'` ferait passer un horodatage identique pour périmé.
    const needsRating = (r) => r.state !== 'seen'
        && r.release_date && r.release_date <= today
        && (!r.letterboxd_rating_at || new Date(r.letterboxd_rating_at).getTime() < staleBefore);
    const needsDirectors = (r) => Boolean(r.director) && !r.letterboxd_directors?.length;

    const todo = rows.filter(r => needsRating(r) || needsDirectors(r));
    console.log(`${todo.length} ligne(s) à backfiller sur ${rows.length}${DRY_RUN ? ' (dry-run)' : ''}.`);
    console.log(`  dont note : ${todo.filter(needsRating).length} | dont réalisateurs : ${todo.filter(needsDirectors).length}`);
    if (!todo.length) return;

    const nowIso = new Date().toISOString();
    let ok = 0, failed = 0;
    const tasks = todo.map((row) => async () => {
        try {
            const { rating, directors } = await fetchFilm(row.movie_id);

            const patch = {};
            if (needsRating(row)) {
                // Scrape raté mais note déjà en base : on la garde et on repousse le prochain check.
                // Jamais notée → on n'horodate pas.
                if (rating != null) patch.letterboxd_rating = rating;
                if (rating != null || row.letterboxd_rating_at) patch.letterboxd_rating_at = nowIso;
            }
            if (needsDirectors(row) && directors.length) patch.letterboxd_directors = directors;
            if (!Object.keys(patch).length) return;

            if (DRY_RUN) {
                const links = patch.letterboxd_directors?.map(d => d.url.split('/director/')[1].replace('/', '')).join(', ');
                console.log(`  [dry] ${row.movie_id} → ${row.title ?? '?'} | note: ${patch.letterboxd_rating ?? '—'} | réals: ${links ?? '—'}`);
            } else {
                const { error: upErr } = await supabase.from('calendar').update(patch).eq('id', row.id);
                if (upErr) throw new Error(upErr.message);
            }
            ok++;
        } catch (e) {
            failed++;
            console.error(`  ✗ ${row.movie_id} : ${e.message}`);
        }
    });

    await promisePool(tasks, 8);
    console.log(`Terminé : ${ok} écrite(s), ${failed} échec(s).`);
};

run();
