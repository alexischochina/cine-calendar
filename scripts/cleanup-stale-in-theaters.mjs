// Nettoyage one-shot : les films d'années précédentes restés à l'état
// « inTheaters » (en salle maintenant) sont repassés « unseen » (pas vu).
//
// À lancer une fois. La date effective = manual_release_date sinon release_date.
//
//   node scripts/cleanup-stale-in-theaters.mjs --dry-run   # aperçu
//   node scripts/cleanup-stale-in-theaters.mjs             # écrit
//
// Requiert SUPABASE_URL + une clé qui contourne la RLS (SUPABASE_SERVICE_KEY),
// sinon fallback SUPABASE_KEY (anon — ne verra rien si la RLS l'exige).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const loadEnv = () => {
    try {
        const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
        for (const line of raw.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* .env absent */ }
};
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_KEY (ou SUPABASE_KEY).');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const currentYear = new Date().getFullYear();

const run = async () => {
    const { data: rows, error } = await supabase
        .from('calendar')
        .select('id, title, release_date, manual_release_date, state')
        .eq('state', 'inTheaters');

    if (error) { console.error('Lecture échouée :', error.message); process.exit(1); }

    const stale = (rows || []).filter(r => {
        const eff = r.manual_release_date || r.release_date;
        if (!eff) return false;
        const y = new Date(eff).getFullYear();
        return !isNaN(y) && y < currentYear;
    });

    console.log(`${stale.length} film(s) « en salle » d'années précédentes${DRY_RUN ? ' (dry-run)' : ''}.`);
    stale.forEach(r => console.log(`  ${DRY_RUN ? '[dry] ' : ''}${r.title} (${(r.manual_release_date || r.release_date)}) → pas vu`));
    if (!stale.length || DRY_RUN) return;

    const { error: upErr } = await supabase
        .from('calendar')
        .update({ state: 'unseen' })
        .in('id', stale.map(r => r.id));
    if (upErr) { console.error('Mise à jour échouée :', upErr.message); process.exit(1); }
    console.log(`Terminé : ${stale.length} film(s) repassé(s) « pas vu ».`);
};

run();
