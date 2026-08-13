// SPIKE — Cinéfil comme seconde source de séances.
//
// Question posée : est-ce qu'un second agrégateur nous rendrait ce qu'Allociné perd ? Née du
// 13/08/2026, où UGC Ciné Cité Les Halles a disparu de *toutes* les réponses Allociné (par film
// comme par salle, sur 7 jours) pendant que le cinéma affichait 7 séances par jour sur son site —
// et que paris-cine.info, lui, les avait. Son auteur décrit des « scripts maison qui récupèrent et
// recoupent les infos à plusieurs endroits » : c'est cette piste qu'on évalue ici.
//
//   node scripts/spike-cinefil.mjs
//
// Lecture seule, aucune écriture en base, ~10 requêtes sortantes.
//
// Le protocole tient en deux salles :
//   - une salle **saine** (UGC Ciné Cité Maillot), où les deux sources répondent : elle valide le
//     parseur. Un écart ici est un bug de parsing, pas une lacune de source.
//   - la salle **en panne** (Les Halles) : elle mesure ce que la seconde source rapporterait.
//
// ⚠️ Ce que ce spike ne dit pas : la stabilité du HTML de Cinéfil dans le temps. C'est le vrai coût
// de cette piste — le projet a justement abandonné le parsing HTML d'Allociné pour cette raison
// (cf. README, « Résolution aveugle à l'art et essai »). À relancer quelques jours de suite avant
// de s'engager.

import { isoDay, SEANCES_HORIZON_DAYS } from '../shared/utils/cineWeek.js';

const UA = 'Mozilla/5.0 (compatible; cine-calendar/1.0)';
const PARIS = 115755;
const DAYS = SEANCES_HORIZON_DAYS;

// Salles à comparer : slug Cinéfil ↔ code Allociné. Le mapping devra être persisté en base si la
// piste est retenue (une colonne `cinemas.cinefil_slug`) ; ici il est en dur, c'est un spike.
const THEATERS = [
    { label: 'UGC Ciné Cité Maillot (témoin sain)', slug: 'ugc-maillot-paris', code: 'C0175' },
    { label: 'UGC Ciné Cité Bercy (témoin sain)', slug: 'ugc-cine-cite-bercy-paris', code: 'C0026' },
    { label: 'UGC Ciné Cité Les Halles (en panne)', slug: 'ugc-cine-cite-les-halles-paris', code: 'C0159' },
];

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const ko = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

const dates = Array.from({ length: DAYS }, (_, i) => isoDay(i));

// Rapprochement de titres entre deux catalogues. Mêmes précautions que `normalizeTitle` côté
// serveur, **plus l'écrasement des espaces** : d'un côté un titre rédigé (« … Partie 2 : J'écris
// ton nom »), de l'autre un slug d'URL (« …-partie-2-jecris-ton-nom »). L'apostrophe y devient une
// soudure, pas une coupure — garder les espaces faisait échouer un rapprochement sur cinq alors que
// les deux sources disaient la même chose.
const norm = (s) => String(s ?? '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '').trim();

const get = async (url) => {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
        return r.ok ? r : null;
    } catch { return null; }
};

// --- Source A : Cinéfil (HTML) ------------------------------------------------------------------
//
// Markup exploitable et daté : chaque film porte un panneau par jour,
// `<div id="seances-<n>-<YYYY-MM-DD>"> … <span class="seance-time">09:00</span> …`.
// Le titre n'est pas dans le panneau : on le retrouve au dernier lien `/film/<slug>` qui précède,
// ce qui donne au passage un identifiant stable côté Cinéfil.
const fetchCinefil = async (slug) => {
    const r = await get(`https://www.cinefil.com/cinema/${slug}/programmation`);
    if (!r) return null;
    const html = await r.text();

    const links = [...html.matchAll(/href="https:\/\/www\.cinefil\.com\/film\/([a-z0-9-]+)"/g)]
        .map(m => ({ at: m.index, slug: m[1] }));

    const titleBefore = (position) => {
        let found = null;
        for (const link of links) {
            if (link.at > position) break;
            found = link.slug;
        }
        return found;
    };

    const byDate = new Map(dates.map(d => [d, new Map()]));

    for (const panel of html.matchAll(/<div[^>]*id="seances-\d+-(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/ul>/g)) {
        const [, date, body] = panel;
        if (!byDate.has(date)) continue;

        const title = titleBefore(panel.index);
        if (!title) continue;

        const times = [...body.matchAll(/<span class="seance-time">\s*([\d]{1,2}:[\d]{2})\s*<\/span>/g)].map(m => m[1]);
        if (!times.length) continue;

        const bucket = byDate.get(date);
        bucket.set(title, [...(bucket.get(title) ?? []), ...times]);
    }

    return byDate;
};

// --- Source B : Allociné (JSON, ce qu'on utilise déjà) -------------------------------------------
const fetchAllocine = async (code) => {
    const byDate = new Map(dates.map(d => [d, new Map()]));

    for (const date of dates) {
        let page = 1, total = 1;
        while (page <= total) {
            const r = await get(`https://www.allocine.fr/_/showtimes/theater-${code}/d-${date}/p-${page}/`);
            if (!r) break;
            const j = await r.json();
            if (j?.error) break;
            total = Number(j?.pagination?.totalPages) || 1;

            for (const entry of j.results ?? []) {
                const title = entry?.movie?.title;
                const times = Object.values(entry.showtimes ?? {}).flat()
                    .map(s => String(s?.startsAt ?? '').slice(11, 16)).filter(Boolean);
                if (!title || !times.length) continue;
                // ⚠️ Cumuler et non écraser : un même film revient dans plusieurs buckets de version
                // (VO, VF, VOST…), chacun avec ses horaires. Un `set` sec ne gardait que le dernier
                // et sous-comptait Allociné d'un facteur 3 — de quoi conclure à tort que Cinéfil est
                // bien plus riche.
                const bucket = byDate.get(date);
                bucket.set(title, [...(bucket.get(title) ?? []), ...times]);
            }
            page++;
        }
    }
    return byDate;
};

// --- Comparaison --------------------------------------------------------------------------------
const compare = async ({ label, slug, code }) => {
    console.log(`\n\x1b[1m${label}\x1b[0m`);

    const [cinefil, allocine] = await Promise.all([fetchCinefil(slug), fetchAllocine(code)]);
    if (!cinefil) { ko('page Cinéfil illisible — parseur ou URL à revoir'); return; }

    let cTotal = 0, aTotal = 0, onlyCinefil = 0, onlyAllocine = 0, both = 0;
    const examples = [];

    for (const date of dates) {
        const c = cinefil.get(date) ?? new Map();
        const a = allocine.get(date) ?? new Map();

        // Index des titres Allociné sous forme normalisée : les deux catalogues ne rédigent pas
        // les titres pareil (« La fin d'Oak Street » vs « La Fin d’Oak Street »).
        const aNorm = new Map([...a.entries()].map(([t, times]) => [norm(t), times]));

        cTotal += [...c.values()].flat().length;
        aTotal += [...a.values()].flat().length;

        for (const [cTitle, times] of c) {
            // Le slug Cinéfil est une forme de titre : `la-fin-d-oak-street` → « la fin d oak street ».
            const key = norm(cTitle);
            const match = [...aNorm.keys()].find(k => k === key || k.includes(key) || key.includes(k));
            if (match) { both += times.length; continue; }
            onlyCinefil += times.length;
            if (examples.length < 6) examples.push(`${date} · ${cTitle} (${times.length} séances)`);
        }

        for (const [aTitle, times] of a) {
            const key = norm(aTitle);
            const found = [...c.keys()].some(t => {
                const k = norm(t);
                return k === key || k.includes(key) || key.includes(k);
            });
            if (!found) onlyAllocine += times.length;
        }
    }

    // Profondeur de publication : combien des 7 jours affichables chaque source couvre réellement.
    // C'est le chiffre décisif, découvert en cours de spike — Allociné ne publie pas la même
    // profondeur pour toutes les salles (3 jours pour Bercy et Les Halles, 7 pour Maillot au
    // 13/08/2026), là où Cinéfil rend la semaine entière. Une vue à 7 jours adossée à la seule
    // source courte est aveugle sur la moitié de sa fenêtre, sans rien qui le signale.
    const depth = (byDate) => dates.filter(d => (byDate.get(d)?.size ?? 0) > 0).length;

    console.log(`  Cinéfil : ${cTotal} séances · ${depth(cinefil)}/${DAYS} jours couverts`);
    console.log(`  Allociné: ${aTotal} séances · ${depth(allocine)}/${DAYS} jours couverts`);

    if (!aTotal && cTotal) {
        warn(`Allociné ne rend RIEN pour cette salle — Cinéfil rapporterait ${cTotal} séances`);
    } else if (aTotal) {
        const agreement = aTotal ? Math.round(100 * both / Math.max(cTotal, 1)) : 0;
        (agreement >= 90 ? ok : warn)(`${agreement} % des séances Cinéfil retrouvées chez Allociné (recoupement)`);
        if (onlyCinefil) warn(`${onlyCinefil} séances vues seulement par Cinéfil`);
        if (onlyAllocine) warn(`${onlyAllocine} séances vues seulement par Allociné`);
    }

    for (const e of examples) console.log(`      · ${e}`);
};

console.log('\x1b[1m— Spike : Cinéfil comme seconde source —\x1b[0m');
console.log(`fenêtre : ${dates[0]} → ${dates[dates.length - 1]}`);
for (const t of THEATERS) await compare(t);
console.log('\nRappel : ce spike mesure la couverture, pas la stabilité du HTML dans le temps.');
