// ⚠️ **Sans ce plugin, aucune page d'erreur ne s'affiche** : une 404 sort en 500 avec l'écran
// interne de Nuxt. Défaut antérieur à `app/error.vue` — il existait avec l'écran par défaut.
//
// Cause mesurée : le *payload reducer* de `@pinia/nuxt` 0.9 passe chaque valeur du payload à
// `shouldHydrate()`, qui fait `obj.hasOwnProperty(…)`. Or le payload racine de Nuxt est créé sans
// prototype, donc sans `hasOwnProperty` : `TypeError` pendant la sérialisation. On redéfinit le
// reducer avec la garde manquante — `skipHydrate` n'est utilisé nulle part ici (vérifié).
//
// ⚠️ `enforce: 'post'` est load-bearing : sans lui le plugin ne passe plus forcément après celui du
// module, et les pages d'erreur repasseraient en 500 **sans bruit**. Ne pas retirer.
//
// À supprimer quand `@pinia/nuxt` sera mis à jour. Contrôle :
// `curl -so /dev/null -w '%{http_code}' -H 'Accept: text/html' localhost:3000/rien` → `404`.
import { shouldHydrate } from 'pinia';

export default definePayloadPlugin({
    name: 'pinia-payload-guard',
    enforce: 'post',
    setup() {
        definePayloadReducer('skipHydrate', (data) => {
            if (data && typeof data === 'object' && Object.getPrototypeOf(data) === null) return false;
            return !shouldHydrate(data) && 1;
        });
    },
});
