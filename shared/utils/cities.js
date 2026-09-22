// Les villes couvertes par la vue Séances — **une seule définition**, app, serveur et scripts.
//
// Quatrième invariant de `shared/`, pour la raison qui y a mis les trois autres (cf. l'en-tête de
// `cineWeek.js`) : une copie divergente s'y traduit par un bug silencieux. Ici il serait
// particulièrement fourbe — la ville décide à la fois **ce qu'on demande à Allociné** (la
// localisation), **ce qu'on garde de sa réponse** (le filtre de salles) et **sous quelle clé on
// l'écrit en cache** (`showtimes_cache.city`). Deux tables divergentes feraient afficher une ville et
// mettre en cache l'autre, sans qu'aucune requête n'échoue.
//
// ⚠️ Aucune dépendance, volontairement : `shared/` est auto-importé des deux côtés depuis Nuxt 3.14
// et doit rester chargeable depuis un script Node nu.

// Repli quand la ville est absente ou inconnue. Paris parce que c'est l'état du monde avant ce
// chantier : toutes les lignes de `showtimes_cache` antérieures sont parisiennes, et un profil qui
// n'aurait pas de ville doit retrouver le comportement historique plutôt qu'un écran vide.
export const DEFAULT_CITY = 'paris';

// `zips` / `theaterCodes` : deux façons de répondre à « cette salle est-elle dans le périmètre ? »,
// et une seule est utilisée par ville. Le choix n'est pas stylistique, cf. les commentaires de
// chaque entrée.
//
// Les trois drapeaux de capacité pilotent l'interface (Step 17 du plan). Ils décrivent la ville, pas
// un réglage : ce sont des faits sur le terrain, pas des préférences.
export const CITIES = {
    paris: {
        key: 'paris',
        label: 'Paris',
        // Le périmètre réellement couvert, tel qu'on l'annonce au visiteur. Distinct de `label` :
        // celui-ci nomme la ville, celui-là décrit ce que la vue montre — et les deux ne coïncident
        // pas (la localisation Allociné ratisse la couronne, on n'en garde que l'intra-muros ;
        // à Troyes on montre une salle qui est dans la commune voisine).
        scopeLabel: 'Paris intra-muros',
        // ⚠️ Cet identifiant ratisse Paris **+ toute la couronne** (mesuré : 73 salles dont 22
        // seulement en 75xxx sur un blockbuster). D'où le filtre ci-dessous, qui n'est pas cosmétique.
        allocineLocalization: 115755,
        // Préfixe de code postal, et non une liste de codes salle : Paris compte ~50 salles, la
        // liste vieillirait à chaque ouverture ou fermeture. Le périmètre voulu est « intra-muros »,
        // que le code postal exprime exactement.
        zips: ['75'],
        theaterCodes: null,
        // La carte UGC illimitée, le temps de trajet pré-calculé depuis le domicile, et le
        // regroupement par arrondissement : les trois n'ont de sens qu'ici.
        hasUgcCard: true,
        hasTransitTimes: true,
        groupsByArrondissement: true,
    },

    troyes: {
        key: 'troyes',
        label: 'Troyes',
        scopeLabel: 'Troyes et Pont-Sainte-Marie',
        // Relevé le 22/09/2026 sur `/_/localization_city/troyes`. Vérifié sur l'endpoint séances :
        // `near-87008` répond exactement comme `near-115755`, même forme de charge utile.
        allocineLocalization: 87008,
        // Liste blanche de deux codes, **et non un préfixe `10`**. `near-87008` ne rend aujourd'hui
        // que ces deux salles, donc les deux règles donneraient le même résultat — mais un préfixe
        // laisserait entrer sans préavis toute salle auboise qu'Allociné rattacherait plus tard à
        // Troyes. La demande nomme deux cinémas ; la règle en nomme deux.
        //
        //   P0983  CGR Troyes                  10000 Troyes
        //   W1015  Utopia Pont-Sainte-Marie    10150 Pont-Sainte-Marie
        //
        // ⚠️ « Utopia Troyes » n'existe pas sous ce nom chez Allociné : l'enseigne est à
        // Pont-Sainte-Marie, commune limitrophe. C'est bien celle visée — ne pas « corriger » le
        // libellé en cherchant une salle intra-muros, il n'y en a pas.
        zips: null,
        theaterCodes: ['P0983', 'W1015'],
        // Aucune des trois : pas de salle UGC à Troyes, le `transit_minutes` du référentiel est
        // calculé depuis un domicile parisien (`scripts/transit-times.mjs`), et un code postal
        // aubois n'a pas d'arrondissement.
        hasUgcCard: false,
        hasTransitTimes: false,
        groupsByArrondissement: false,
    },
};

export const CITY_KEYS = Object.keys(CITIES);

export const isCityKey = (value) => Object.hasOwn(CITIES, String(value ?? ''));

// Normalise n'importe quelle entrée en clé de ville utilisable. **Toujours passer par ici** plutôt
// que d'indexer `CITIES` directement : une ville absente ou mal orthographiée rendrait `undefined`,
// et l'appelant lirait `undefined.allocineLocalization` — une panne serveur là où on veut une vue
// parisienne.
export const cityOf = (value) => (isCityKey(value) ? String(value) : DEFAULT_CITY);

// Raccourci de lecture, avec le même repli.
export const cityConfig = (value) => CITIES[cityOf(value)];

// Cette salle fait-elle partie du périmètre de la ville ?
//
// Prend une salle **déjà réduite** à `{ code, zip }` plutôt que la réponse brute d'Allociné : ce
// fichier ne doit rien savoir de la forme du payload d'un tiers, sinon un changement chez Allociné
// se répercuterait jusque dans `shared/`. La conversion se fait au point d'appel
// (`server/utils/allocine.js`), qui est déjà le seul endroit à connaître ce format.
//
// ⚠️ Le code est comparé en majuscules : Allociné rend `C0159`, mais le référentiel local a déjà
// reçu des codes d'autres sources. Une comparaison sensible à la casse ferait disparaître une salle
// de la vue sans rien signaler.
export const belongsToCity = (theater, city) => {
    const config = cityConfig(city);

    if (config.theaterCodes) {
        const code = String(theater?.code ?? '').toUpperCase();
        return code ? config.theaterCodes.includes(code) : false;
    }

    const zip = String(theater?.zip ?? '');
    return config.zips.some(prefix => zip.startsWith(prefix));
};
