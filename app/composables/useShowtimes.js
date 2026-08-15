// Accès aux séances Allociné : résolution des identifiants et chargement d'une journée. Extrait de
// `useSeances` parce que la vue et le contrôle « en salle » doivent partager le **même** cache L1 —
// chacun préchauffe l'autre.
//
// Deux niveaux de cache :
//   L1 — `useState` clé `allocineId:date`, portée visite.
//   L2 — table `showtimes_cache`, durable (cf. server/api/allocine/showtimes.js).

const RESOLVE_CONCURRENCY = 8;
const SHOWTIMES_CONCURRENCY = 4;

// Taille d'un paquet pour la lecture groupée du cache. **Doit rester sous le `MAX_IDS` de
// `server/api/allocine/showtimes.js`** (60), qui borne la longueur d'URL et la clause `in`.
// Au-delà la route répond 400, et l'appelant retombe sur un rafraîchissement unitaire par film —
// soit exactement le chemin coûteux que la lecture groupée existe pour éviter. Le contrôle « en
// salle » interroge ~91 films : il passait dessous sans ce découpage.
const CACHE_BATCH = 50;

// Un film cherché en vain reste introuvable un moment (il n'est pas à l'affiche) : on ne réessaie
// qu'au bout d'une semaine plutôt qu'à chaque ouverture de la page.
const RESOLVE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

// Chargements en vol, un par date. Atterrir sur `/seances` déclenche le chargement de la journée
// **et** le contrôle « en salle » à quelques millisecondes d'intervalle, sur la même date : les
// chaîner évite de sortir en double chez Allociné.
//
// ⚠️ Module-level, donc partagé entre toutes les requêtes dans un serveur Nitro — la promesse d'un
// visiteur chaînée à celle d'un autre. La garde `import.meta.server` rend le cas impossible plutôt
// qu'improbable.
const inFlightByDate = new Map();

export function useShowtimes() {
    const client = useSupabaseClient();
    const { movies } = useMovieCalendar();

    // L1. Clé historique conservée : c'est le même cache qu'avant l'extraction.
    const payloads = useState('seancesPayloads', () => ({}));

    const cacheKey = (allocineId, date) => `${allocineId}:${date}`;

    const payloadFor = (movie, date) =>
        movie?.allocine_id ? (payloads.value[cacheKey(movie.allocine_id, date)] ?? null) : null;

    // Résout les identifiants Allociné manquants de `list` et les persiste. Même discipline que
    // `recheckUpcomingCinema` : pool borné, un seul réassign de `movies.value` à la fin.
    const resolveAllocineIds = async (list) => {
        const staleBefore = Date.now() - RESOLVE_RETRY_MS;
        const toResolve = list.filter(m =>
            !m.allocine_id &&
            m.title &&
            (!m.allocine_checked_at || Date.parse(m.allocine_checked_at) < staleBefore)
        );
        if (!toResolve.length) return;

        const checkedAt = new Date().toISOString();
        const patches = new Map();

        await promisePool(toResolve.map(movie => async () => {
            try {
                const { allocine_id, unavailable } = await $fetch('/api/allocine/resolve', {
                    query: {
                        title: movie.title,
                        release_date: movie.release_date || '',
                        // Départage les homonymes (remakes, re-sorties) plus sûrement que la date.
                        director: movie.director || '',
                    },
                });

                // ⚠️ Allociné injoignable ≠ film introuvable. Horodater dans ce cas épinglerait le
                // film comme « pas chez Allociné » pendant une semaine pour un simple hoquet réseau.
                // On ne touche à rien : la prochaine ouverture de la vue réessaiera.
                if (unavailable) return;

                // Un « pas trouvé » avéré, lui, est horodaté : sans ça on relancerait une recherche
                // à chaque ouverture pour un film qui n'est tout simplement pas au catalogue.
                const patch = { allocine_id: allocine_id ?? null, allocine_checked_at: checkedAt };
                await client.from('calendar').update(patch).eq('id', movie.id);
                patches.set(movie.id, patch);
            } catch (e) {
                console.error('Résolution Allociné échouée pour', movie.title, e);
            }
        }), RESOLVE_CONCURRENCY);

        if (!patches.size) return;
        movies.value = movies.value.map(m => {
            const patch = patches.get(m.id);
            return patch ? { ...m, ...patch } : m;
        });
    };

    // Séances du jour, pour les seuls films résolus et pas déjà en cache L1. Deux temps : lecture
    // **groupée** du cache (1 requête pour tout le jour), puis rafraîchissement film par film de ce qui
    // manque. Le cas courant se règle en un aller-retour ; le cas froid garde l'éventail côté client,
    // où chaque appel reste court.
    //
    // Renvoie `{ requested, failures }` — à l'appelant de décider ce qu'un échec veut dire chez lui.
    const loadShowtimes = (list, date, { force = false } = {}) => {
        // Côté serveur, on court-circuite la file : elle vit au niveau module et serait partagée
        // entre visiteurs (cf. `inFlightByDate`). Le rendu serveur n'appelle pas cette fonction
        // aujourd'hui — cette ligne est là pour que ça reste vrai demain.
        if (import.meta.server) return fetchMissing(list, date, force);

        // File d'attente par date : on ne calcule ce qui manque qu'une fois le chargement précédent
        // de cette journée terminé, donc sur un L1 à jour.
        const chained = (inFlightByDate.get(date) ?? Promise.resolve())
            .catch(() => {})
            .then(() => fetchMissing(list, date, force));

        inFlightByDate.set(date, chained);
        // On ne retire que si personne ne s'est enchaîné derrière entre-temps.
        //
        // ⚠️ Le `catch` avant le `finally` n'est pas décoratif : `chained.finally(…)` rend une
        // promesse **dérivée**, distincte de celle qu'on retourne. Si `chained` rejette, l'appelant
        // traite bien la sienne, mais la dérivée n'a aucun consommateur — le navigateur remonte alors
        // un `unhandledrejection` pour une erreur pourtant déjà gérée.
        chained
            .catch(() => {})
            .finally(() => {
                if (inFlightByDate.get(date) === chained) inFlightByDate.delete(date);
            });
        return chained;
    };

    const fetchMissing = async (list, date, force = false) => {
        // Forcé : les deux caches sont hors-jeu, c'est tout l'objet du geste.
        const pending = list.filter(m => m.allocine_id && (force || !payloads.value[cacheKey(m.allocine_id, date)]));
        if (!pending.length) return { requested: 0, failures: 0 };

        const ids = [...new Set(pending.map(m => m.allocine_id))];
        const fetched = {};
        const toRefresh = force ? [...ids] : [];

        const batches = [];
        if (!force) for (let i = 0; i < ids.length; i += CACHE_BATCH) batches.push(ids.slice(i, i + CACHE_BATCH));

        // Les paquets partent ensemble : ils ne font que lire le cache, et il y en a au plus deux.
        await Promise.all(batches.map(async (batch) => {
            try {
                const { movies: cached, missing } = await $fetch('/api/allocine/showtimes', {
                    query: { ids: batch.join(','), date },
                });
                for (const [id, payload] of Object.entries(cached ?? {})) fetched[cacheKey(id, date)] = payload;
                toRefresh.push(...(missing ?? []));
            } catch (e) {
                // Cache illisible : on ne renonce pas, ce paquet part au rafraîchissement.
                console.error('Lecture groupée des séances échouée', e);
                toRefresh.push(...batch);
            }
        }));

        let failures = 0;
        if (toRefresh.length) {
            await promisePool(toRefresh.map(id => async () => {
                try {
                    const payload = await $fetch('/api/allocine/refresh', {
                        query: force ? { id, date, force: 1 } : { id, date },
                    });

                    // ⚠️ `refresh` ne throw pas quand Allociné est injoignable : il répond 200 avec
                    // `{ theaters: [], error: true }`. Sans ce test, le `catch` ne se déclenchait
                    // jamais et une panne réseau s'affichait comme « aucune séance pour ces
                    // critères » — le pire des messages, puisqu'il désigne les filtres. Le payload
                    // en échec n'entre pas non plus en cache L1, sans quoi aucun nouvel essai
                    // n'aurait lieu avant la fin de la session.
                    if (payload?.error) {
                        failures++;
                        return;
                    }
                    fetched[cacheKey(id, date)] = payload;
                } catch (e) {
                    failures++;
                    console.error('Séances indisponibles pour le film', id, e);
                }
            }), SHOWTIMES_CONCURRENCY);
        }

        // Un seul réassign : le L1 est lu par tous les `computed` en aval.
        if (Object.keys(fetched).length) payloads.value = { ...payloads.value, ...fetched };

        return { requested: ids.length, failures };
    };

    // Purge le L1 d'une journée, pour forcer un nouvel appel (le L2 décidera de son côté s'il
    // retape Allociné ou s'il ressert du périmé).
    const forgetDay = (date) => {
        payloads.value = Object.fromEntries(
            Object.entries(payloads.value).filter(([key]) => !key.endsWith(`:${date}`))
        );
    };

    // Oublie tout ce qui concerne des journées révolues. Appelé quand la page franchit minuit : ces
    // entrées ne seront plus jamais lues, et elles porteraient la mémoire de la veille dans une
    // visite qui parle désormais d'un autre jour.
    const forgetBefore = (date) => {
        payloads.value = Object.fromEntries(
            Object.entries(payloads.value).filter(([key]) => (key.split(':')[1] ?? '') >= date)
        );
    };

    // Oublie une liste précise de films pour une date. Le contrôle « en salle » charge ~91 films pour
    // n'en garder qu'une douzaine : sans ce balai, ~0,5 Mo resteraient en mémoire pour la visite. Le L2
    // les conserve, lui.
    const forget = (allocineIds, date) => {
        const drop = new Set(allocineIds.map(id => cacheKey(id, date)));
        if (!drop.size) return;
        payloads.value = Object.fromEntries(
            Object.entries(payloads.value).filter(([key]) => !drop.has(key))
        );
    };

    return { payloads, payloadFor, resolveAllocineIds, loadShowtimes, forgetDay, forgetBefore, forget };
}
