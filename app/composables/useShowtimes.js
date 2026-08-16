// Accès aux séances Allociné : résolution des identifiants et chargement d'une journée. Extrait de
// `useSeances` parce que la vue et le contrôle « en salle » doivent partager le **même** cache L1 —
// chacun préchauffe l'autre.
//
// Trois niveaux de cache :
//   L0 — `localStorage`, instantané du L1 (cf. `app/utils/seancesSnapshot.js`), affiché au chargement.
//   L1 — `useState` clé `allocineId:date`, portée visite.
//   L2 — table `showtimes_cache`, durable (cf. server/api/allocine/showtimes.js).
//
// ⚠️ Deux accesseurs, et la distinction n'est pas cosmétique :
//   `payloadFor`     — L1 puis L0. Pour **afficher**.
//   `livePayloadFor` — L1 seul. Pour **décider** : un instantané d'hier n'est une preuve de rien.
//
// Le L0 ne dispense jamais d'un appel — `fetchMissing` n'établit ce qui manque que sur le L1. C'est un
// stale-while-revalidate, pas un cache de plus.

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

// Branchement global à la visite : `useShowtimes` a quatre appelants, qui poseraient sinon quatre
// observateurs d'écriture. Écrits côté client uniquement, donc sans partage entre requêtes Nitro.
let snapshotWired = false;
let snapshotWritable = true;   // coupé après un dépassement de quota : réessayer relancerait l'erreur

export function useShowtimes() {
    const client = useSupabaseClient();
    const { movies } = useMovieCalendar();

    const payloads = useState('seancesPayloads', () => ({}));   // L1
    const snapshot = useState('seancesSnapshot', () => ({}));   // L0, hydraté après le montage

    const cacheKey = (allocineId, date) => `${allocineId}:${date}`;

    // Pour afficher : le L1 d'abord, l'instantané en secours.
    const payloadFor = (movie, date) =>
        movie?.allocine_id
            ? (payloads.value[cacheKey(movie.allocine_id, date)] ?? snapshot.value[cacheKey(movie.allocine_id, date)] ?? null)
            : null;

    // Pour décider. ⚠️ Ne jamais remplacer par `payloadFor` « pour simplifier » : ses appelants
    // écrivent en base ou sortent sur le réseau sur la foi de ce qu'ils lisent ici — leur servir un
    // instantané d'hier, c'est écrire hier. `payloadFor` n'appartient qu'au code qui **affiche** ;
    // `grep -n "payloadFor" app/composables/` le vérifie.
    const livePayloadFor = (movie, date) =>
        movie?.allocine_id ? (payloads.value[cacheKey(movie.allocine_id, date)] ?? null) : null;

    // Relit l'instantané et branche son entretien. Appelé au premier chargement de la vue Séances,
    // donc **après** l'hydratation : lire `localStorage` dans l'initialiseur d'un `useState` ferait
    // diverger le rendu serveur du premier rendu client.
    const wireSnapshot = () => {
        if (!import.meta.client || snapshotWired) return;
        snapshotWired = true;

        const bounds = () => ({ today: isoDay(0), freshSince: lastWednesday() });

        try {
            const raw = localStorage.getItem(SNAPSHOT_KEY);
            if (raw) snapshot.value = pruneSnapshot(JSON.parse(raw), bounds());
        } catch (e) {
            // Instantané illisible (format changé à la main, écriture interrompue) : on repart de
            // rien plutôt que de tenter de sauver les meubles.
            console.warn('Instantané des séances illisible, ignoré', e);
            try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* mode privé */ }
        }

        // Le L1 fait autorité sur l'instantané. Débounce parce que `fetchMissing`, `graftEvents` et le
        // contrôle « en salle » réassignent `payloads` coup sur coup.
        let timer = null;

        const persist = () => {
            if (!snapshotWritable) return;
            clearTimeout(timer);
            timer = null;

            const limits = bounds();

            // ⚠️ Filtré sur le périmètre de la vue, pas seulement plafonné : le contrôle « en salle »
            // charge ~91 films et `forget()` ne passe qu'après. Un débounce tombant entre les deux
            // remplissait l'instantané de films non affichés, qui évinçaient les journées lointaines.
            const scope = new Set(
                movies.value
                    .filter(m => m.allocine_id && isSeanceFilm(m, limits.today))
                    .map(m => String(m.allocine_id))
            );

            const candidate = Object.fromEntries(
                Object.entries({ ...snapshot.value, ...payloads.value })
                    .filter(([key]) => scope.has(key.slice(0, key.indexOf(':'))))
            );

            const merged = pruneSnapshot(candidate, limits);
            snapshot.value = merged;
            try {
                localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(merged));
            } catch (e) {
                snapshotWritable = false;
                console.warn('Instantané des séances non écrit (quota ?), désactivé pour la visite', e);
                try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* mode privé */ }
            }
        };

        // ⚠️ Portée **détachée**, jamais arrêtée : appelé depuis le `onMounted` de la page, un `watch`
        // nu mourrait au passage sur Timeline — et `snapshotWired` interdisant la ré-inscription, plus
        // rien ne serait persisté de la session.
        effectScope(true).run(() => watch(payloads, () => {
            if (!snapshotWritable) return;
            clearTimeout(timer);
            timer = setTimeout(persist, 400);
        }));

        // Ferme la fenêtre du débounce. `visibilitychange` et non `beforeunload` : un onglet tué en
        // arrière-plan ne repasse jamais par `unload`, sur mobile surtout.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && timer) persist();
        });
    };

    // Retire des deux niveaux de mémoire. L'instantané doit suivre le L1 sur les oublis, sinon
    // `payloadFor` ressusciterait par le L0 exactement ce que l'appelant vient d'écarter.
    const dropKeys = (matches) => {
        payloads.value = Object.fromEntries(
            Object.entries(payloads.value).filter(([key]) => !matches(key))
        );
        snapshot.value = Object.fromEntries(
            Object.entries(snapshot.value).filter(([key]) => !matches(key))
        );
    };

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
    //
    // ⚠️ L'instantané, lui, **survit** : c'est le seul oubli des trois où on le garde. « Actualiser »
    // et « Réessayer » veulent une donnée neuve, pas un écran vide pendant qu'on la cherche — laisser
    // le dernier état connu à l'écran, daté, est précisément ce que le L0 existe pour faire.
    const forgetDay = (date) => {
        payloads.value = Object.fromEntries(
            Object.entries(payloads.value).filter(([key]) => !key.endsWith(`:${date}`))
        );
    };

    // Oublie tout ce qui concerne des journées révolues. Appelé quand la page franchit minuit : ces
    // entrées ne seront plus jamais lues, et elles porteraient la mémoire de la veille dans une
    // visite qui parle désormais d'un autre jour.
    const forgetBefore = (date) => dropKeys(key => (key.split(':')[1] ?? '') < date);

    // Oublie une liste précise de films pour une date. Le contrôle « en salle » charge ~91 films pour
    // n'en garder qu'une douzaine : sans ce balai, ~0,5 Mo resteraient en mémoire pour la visite — et,
    // depuis le L0, dans le `localStorage` du navigateur. Le L2 les conserve, lui.
    const forget = (allocineIds, date) => {
        const drop = new Set(allocineIds.map(id => cacheKey(id, date)));
        if (!drop.size) return;
        dropKeys(key => drop.has(key));
    };

    return {
        payloads, payloadFor, livePayloadFor, wireSnapshot,
        resolveAllocineIds, loadShowtimes, forgetDay, forgetBefore, forget,
    };
}
