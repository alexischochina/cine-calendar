// Écrêtage du trafic sur les routes de cache ouvertes aux anonymes (`showtimes`, `events`). Celles-ci
// se passent de `requireUser` parce qu'elles ne sortent jamais sur le réseau et que la garde coûterait
// un aller-retour sur le chemin le plus chaud du projet : ce qui restait ouvert n'était pas la donnée,
// que RLS protège, mais la **dépense** en invocations serverless.
//
// ⚠️ Ce que ça ne vaut pas, à dire pour que personne ne s'y fie trop : le compteur vit en mémoire
// d'instance. Plusieurs instances servent en parallèle, chacune tient le sien, et tout repart au cold
// start. Écrêtage de l'abus trivial, pas un WAF. Fenêtre fixe, donc deux fois la limite peut passer à
// cheval sur deux fenêtres — assumé.

// Large à dessein : la vue Événements balaie sept journées d'affilée. On écrête la boucle, jamais
// l'usage — y compris derrière un partage d'IP.
const WINDOW_MS = 60 * 1000;
const MAX_HITS = 120;

// Au-delà, purge des fenêtres expirées : borne la mémoire sans minuteur, qui survivrait mal au gel
// d'instance entre deux requêtes.
const SWEEP_AT = 1000;

const hits = new Map();

const sweep = (now) => {
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
};

// Renvoie `true` quand la requête est dans les clous, `false` quand elle dépasse.
export const withinRateLimit = (event, { max = MAX_HITS, windowMs = WINDOW_MS } = {}) => {
    const now = Date.now();
    if (hits.size > SWEEP_AT) sweep(now);

    // `xForwardedFor` : derrière le proxy de l'hébergeur, l'adresse de socket est celle du proxy et
    // rangerait tout le monde dans le même seau. Sans en-tête exploitable, la clé commune dégrade
    // l'écrêtage en limite globale — dégradé, jamais ouvert.
    const key = getRequestIP(event, { xForwardedFor: true }) ?? 'inconnu';
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }

    entry.count++;
    return entry.count <= max;
};

// Garde à poser en tête de handler. 429 + `Retry-After` ; notre client retombe sur son cache L1.
export const rateLimit = (event, options = {}) => {
    if (withinRateLimit(event, options)) return;

    const seconds = Math.ceil((options.windowMs ?? WINDOW_MS) / 1000);
    setResponseHeader(event, 'Retry-After', String(seconds));
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' });
};
