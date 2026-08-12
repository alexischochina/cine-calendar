// Édition de la liste des salles acceptant la carte UGC Illimité (plan 2608121539).
//
// La liste est **curée à la main** et jamais scrapée : Allociné porte bien l'info (`loyaltyCards`)
// mais a déjà été pris en flagrant délit d'erreur dessus. Ce script est le moyen courant de
// l'amender ; `_ressources/sql/2608121539-seed-cinemas-ugc.sql` reste la remise à plat complète.
//
// Usage :
//   node scripts/set-cinema-ugc.mjs --list            # toutes les salles et leur état
//   node scripts/set-cinema-ugc.mjs --list --ugc      # seulement celles qui acceptent la carte
//   node scripts/set-cinema-ugc.mjs "MK2 Nation" on   # par fragment de nom…
//   node scripts/set-cinema-ugc.mjs C0102 off         # …ou par code salle Allociné
//
// Le fragment de nom est insensible à la casse et aux accents. S'il matche plusieurs salles, le
// script les liste et ne touche à rien — à toi de préciser.
//
// Variables .env requises : SUPABASE_URL + une clé avec droit d'update
// (NUXT_SUPABASE_SECRET_KEY recommandée, elle contourne la RLS ; repli sur SUPABASE_KEY).

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

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Variables manquantes. Requis : SUPABASE_URL, SUPABASE_KEY (ou NUXT_SUPABASE_SECRET_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const fetchCinemas = async () => {
    const { data, error } = await supabase
        .from('cinemas')
        .select('code, name, zip, arrondissement, accepts_ugc, lat')
        .order('accepts_ugc', { ascending: false })
        .order('zip');
    if (error) {
        console.error('Lecture Supabase échouée :', error.message);
        process.exit(1);
    }
    return data ?? [];
};

const printTable = (rows) => {
    for (const c of rows) {
        const mark = c.accepts_ugc ? '★' : ' ';
        const geo = c.lat == null ? ' (non géocodée)' : '';
        console.log(`${mark} ${c.code.padEnd(7)} ${String(c.zip ?? '—').padEnd(6)} ${c.name}${geo}`);
    }
};

const run = async () => {
    const rows = await fetchCinemas();

    if (flags.has('--list') || !positional.length) {
        const shown = flags.has('--ugc') ? rows.filter(c => c.accepts_ugc) : rows;
        printTable(shown);
        console.log(`\n${rows.filter(c => c.accepts_ugc).length} salle(s) acceptent la carte sur ${rows.length}. ★ = carte acceptée.`);
        if (!positional.length && !flags.has('--list')) {
            console.log('\nPour modifier :  node scripts/set-cinema-ugc.mjs "MK2 Nation" on');
        }
        return;
    }

    const [target, rawValue] = positional;
    if (!['on', 'off', 'true', 'false'].includes(String(rawValue ?? '').toLowerCase())) {
        console.error('Second argument attendu : on | off');
        process.exit(1);
    }
    const value = ['on', 'true'].includes(String(rawValue).toLowerCase());

    // Code exact d'abord (sans ambiguïté possible), fragment de nom ensuite.
    const byCode = rows.filter(c => norm(c.code) === norm(target));
    const matches = byCode.length ? byCode : rows.filter(c => norm(c.name).includes(norm(target)));

    if (!matches.length) {
        console.error(`Aucune salle ne correspond à « ${target} ». Lance --list pour voir le référentiel.`);
        process.exit(1);
    }
    if (matches.length > 1) {
        console.error(`« ${target} » correspond à ${matches.length} salles — précise le code :`);
        printTable(matches);
        process.exit(1);
    }

    const cinema = matches[0];
    if (cinema.accepts_ugc === value) {
        console.log(`${cinema.name} (${cinema.code}) est déjà ${value ? 'marquée' : 'non marquée'} carte UGC. Rien à faire.`);
        return;
    }

    const { error } = await supabase
        .from('cinemas')
        .update({ accepts_ugc: value, updated_at: new Date().toISOString() })
        .eq('code', cinema.code);
    if (error) {
        console.error('Écriture échouée :', error.message);
        process.exit(1);
    }

    console.log(`${cinema.name} (${cinema.code}) → carte UGC ${value ? 'acceptée ★' : 'non acceptée'}.`);
    console.log('⚠️ Pense à reporter le changement dans _ressources/sql/2608121539-seed-cinemas-ugc.sql,');
    console.log('   qui reste la remise à plat de référence.');
};

run();
