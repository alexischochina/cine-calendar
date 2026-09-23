# Écrans d'authentification — mode d'emploi

Les cinq écrans qui entourent l'entrée dans Cinégenda : connexion, inscription, attente de
validation, demande de mot de passe oublié, et choix du nouveau mot de passe.

Plan de référence : [`_ressources/plans/2609231217-refonte-pages-auth.md`](plans/2609231217-refonte-pages-auth.md).
Maquettes source : `_ressources/tmpl/{Connexion,Inscription,Attente-validation,Mot-de-passe-oublie}.html`.

## Une chose à faire avant que le mot de passe oublié serve à quelque chose

Le code est complet, mais **le parcours ne fonctionne que si Supabase sait envoyer un e-mail**. Deux
réglages, tous deux dans le dashboard, aucun dans le dépôt :

1. **Authentication → URL Configuration → Redirect URLs** : y ajouter
   `http://localhost:3000/nouveau-mot-de-passe` et `<site de production>/nouveau-mot-de-passe`.
   Sans ça, Supabase ignore le `redirectTo` et renvoie sur le *Site URL* — le lien tombe à côté.
2. **Authentication → Emails / SMTP** : vérifier l'expéditeur. Le service intégré est plafonné à
   quelques messages par heure et, sur les projets récents, **n'écrit qu'aux adresses membres du
   projet**.

⚠️ **« Compte approuvé » et « adresse membre du projet Supabase » sont deux listes sans rapport.**
`profiles.approved` ouvre l'application ; l'autorisation d'envoi se règle dans les membres de
l'organisation Supabase. Un compte parfaitement approuvé peut ne jamais recevoir son lien. Si
l'adresse visée n'est pas membre, il faut un SMTP tiers (Brevo, Resend — offre gratuite suffisante
pour deux comptes).

En production, renseigner aussi `NUXT_PUBLIC_SITE_URL` : c'est elle qui compose le lien. Vide,
`useRequestURL().origin` prend le relais — acceptable en local, faux en production.

## La page d'erreur, et le bug qu'elle a révélé

`app/error.vue` rend le 404 de la maquette (`_ressources/tmpl/404.html`). Elle ne passe **ni par un
layout ni par un middleware** — c'est une sortie de secours, elle doit s'afficher quand le reste ne
peut pas — et refait donc son décor à partir des mêmes briques : `<Brand>`, `<AuthMarquee class="-muted">`,
`<AuthSubmitBtn>`.

⚠️ **Elle reçoit toutes les erreurs, pas seulement les 404.** Le gros chiffre affiche le code réel
(le caractère du milieu passe en rose : 4**0**4, 5**0**0) et le texte s'adapte. Un 500 rendu avec
« Cette bobine est introuvable » serait un mensonge.

⚠️ **Le bouton appelle `clearError({ redirect: '/' })`, pas un simple lien** : sans ça l'état
d'erreur de Nuxt subsiste et on peut rester coincé sur cet écran.

### `app/plugins/pinia-payload-guard.js` — sans lui, aucune page d'erreur ne s'affiche

En intégrant le 404, on a découvert que **le rendu des pages d'erreur était déjà cassé** — y compris
avec l'écran par défaut de Nuxt, donc antérieurement à ce chantier. Une 404 sortait en **500**.

La cause, mesurée : `@pinia/nuxt` 0.9 pose un *payload reducer* qui passe **chaque valeur du
payload** à `shouldHydrate()` de Pinia, laquelle appelle `obj.hasOwnProperty(…)`. Or le payload
racine de Nuxt est créé **sans prototype** (`Object.create(null)`) : il n'a pas de `hasOwnProperty`,
d'où un `TypeError` pendant la sérialisation, qui fait échouer le rendu de la page d'erreur.

Le plugin redéfinit ce reducer avec la garde manquante. Il ne change rien au comportement de
`skipHydrate`, que ce dépôt n'utilise nulle part (vérifié). **À retirer le jour où `@pinia/nuxt` est
mis à jour** avec le correctif amont.

## Les cinq écrans

| Route | Fichier | Middleware `auth` | Rôle |
|---|---|---|---|
| `/login` | `app/pages/login/index.vue` | non | Connexion (`signInWithPassword`) |
| `/register` | `app/pages/register/index.vue` | non | Inscription via `POST /api/auth/register` |
| `/pending` | `app/pages/pending.vue` | non | Compte créé, pas encore approuvé |
| `/mot-de-passe-oublie` | `app/pages/mot-de-passe-oublie.vue` | non | Demande du lien (`resetPasswordForEmail`) |
| `/nouveau-mot-de-passe` | `app/pages/nouveau-mot-de-passe.vue` | non | Saisie du nouveau mot de passe (`updateUser`) |

⚠️ **Aucune ne porte le middleware `auth`**, et c'est voulu : on arrive sur les cinq sans session
utilisable. `/pending` en particulier — c'est le middleware qui y envoie, l'y soumettre ferait une
boucle de redirection.

## Architecture

**`app/layouts/auth.vue`** — le décor commun : panneau visuel à gauche (logo, marquee, accroche),
colonne de formulaire à droite bornée à 40rem. C'est un **layout** et pas un composant parce que Nuxt
le garde monté d'une route à l'autre : le marquee ne se remonte pas entre `/login` et `/register`, et
la transition `view` ne reprend que la colonne de droite. C'est le basculement d'onglet de la
maquette, obtenu sans état de page.

**`app/components/auth/`** — cinq composants, créés dès qu'un élément sert à deux écrans :

| Composant | Rôle |
|---|---|
| `Marquee.vue` | Les quatre rangées de titres en contour. Liste en dur — ces écrans s'affichent avant toute session, il n'y a aucune liste d'utilisateur à lire. Variante `-muted` pour la page d'erreur (en retrait, sans accent). |
| `Tabs.vue` | Connexion / Inscription. État actif déduit de la route, jamais d'un `ref`. |
| `Field.vue` | Libellé + action facultative (« Oublié ? ») + le contrôle en slot. |
| `Input.vue` | Le champ, e-mail comme mot de passe. Bouton œil et jauge de robustesse en options. |
| `Notice.vue` | Message d'erreur, `role="alert"`. |
| `SubmitBtn.vue` | Bouton principal. `icon` (défaut flèche, `null` pour aucun) et `to` (rend un lien). |

La marque vit à part, dans `app/components/Brand.vue` : elle sert au layout **et** à la page
d'erreur, et n'appartient donc à aucun écran en particulier.

Les **cartes de ville** (inscription) et la **carte-ticket** (attente) restent dans leur page : un
seul emploi chacune, les sortir déplacerait le code sans le factoriser.

## Pièges

### `.btn` gagne sur `.flex` — une histoire d'ordre d'import

`main.scss` importe `components/_flex` **avant** `components/_btn`. À spécificité égale, le
`display: block` de `.btn` écrase donc le `display: flex` de `.flex`. Invisible sur un `<button>`,
que le navigateur centre nativement — mais la variante lien de `SubmitBtn` affichait son libellé
collé en haut à gauche. D'où le `display: flex` explicite dans `.auth-submit`. Même vigilance pour
tout futur élément qui porterait les deux classes.

### Ces écrans ont leur propre transition, `auth`, et pas celle du reste de l'app

Les cinq pages posent `pageTransition: { name: 'auth', mode: 'out-in' }` dans leur
`definePageMeta`, et les règles vivent dans `main.scss` à côté des `.view-*`. Deux raisons, toutes
deux constatées à l'écran :

1. **Le fondu croisé global (`view`) superposait les deux formulaires.** Ils n'ont ni la même
   hauteur ni le même contenu : pendant 200 ms, deux titres et deux sous-titres se chevauchaient.
   `out-in` fait sortir l'un avant de faire entrer l'autre — plus aucune superposition.
2. **`.view-leave-active` détache la vue sortante en `position: absolute; inset: 0`.** Sans ancêtre
   positionné dans ce layout, ce `inset: 0` se calait sur le **viewport** : le formulaire sortant
   s'étalait sur tout l'écran par-dessus le panneau, bouton rose en bande pleine largeur.

⚠️ La transition `auth` **ne doit pas** reprendre ce `position: absolute` : en out-in la vue sortante
est seule dans la colonne, la sortir du flux ferait s'effondrer celle-ci pendant qu'elle s'efface.
Et si l'on revenait un jour au fondu croisé, il faudrait remettre un `position: relative` sur
`.content > .inner` — c'est ce qui bornait la vue détachée à la colonne.

### Le motif de couleur du marquee se calcule sur la liste d'origine

Chaque rangée est rendue **deux fois** (le défilement va de 0 à -50 %). Le titre en rose est choisi
par `(rangée + position) % 4 === 1` — et **la position doit être celle dans la liste d'origine**
(`j % row.length`), pas dans la liste dupliquée. Sinon un titre rose dans la première moitié est un
contour dans la seconde : au moment où la boucle repart, le mot change d'apparence sous les yeux du
visiteur. Signalé en revue le 23/09/2026, c'était aussi le comportement de la maquette.

### Une variante qui annule une règle doit en reprendre toute la chaîne

`&.-muted { .title.-hot { … } }` produit un sélecteur **moins spécifique** que le
`> .row > .item > .title.-hot` qu'il prétend annuler : la variante restait sans effet, et les titres
du marquee gardaient leur rose sur la page d'erreur. La neutralisation reprend donc toute la chaîne.
Le même piège guette toute variante ajoutée à un composant dont le SCSS est profondément imbriqué.

### Un `<legend>` ne suit pas le `gap` de son `<fieldset>`

Le navigateur extrait le `<legend>` du flux pour le poser sur la bordure du `fieldset` : **aucun
`gap` ne l'atteint**, même en `display: flex`. Le libellé « Ta ville » se retrouvait donc collé aux
cartes — mesuré à 0 px, quand tous les autres champs ont .8rem. L'écart se pose en `margin-bottom`
sur le `legend`, jamais en `gap` sur le `fieldset`.

### Le lien de récupération ne marche que dans le navigateur qui l'a demandé

`@nuxtjs/supabase` 2.x s'appuie sur `@supabase/ssr`, dont le client navigateur est en flux **PKCE** :
le vérificateur est stocké côté navigateur. Ouvrir le lien ailleurs (demande sur l'ordinateur, mail lu
sur le téléphone) fait échouer l'échange. **C'est un cas normal, pas un bug** — `/nouveau-mot-de-passe`
l'affiche comme « Lien expiré ou déjà utilisé » avec un retour vers la demande. Ne pas « corriger »
ça en tentant de forcer l'échange.

Ce même client **consomme le `code` de l'URL tout seul** au démarrage (`detectSessionInUrl`). D'où
l'ordre de la page : tenter l'échange, puis retomber sur `getSession()`, qui attend la fin de cette
initialisation et tranche pour de bon.

### L'écran « mot de passe oublié » ne lit même pas la réponse de Supabase

⚠️ **Aucune branche d'affichage ne dépend du retour de `resetPasswordForEmail`.** Ce n'est pas un
excès de prudence, c'est le correctif d'un oracle introduit puis refermé pendant ce chantier (revue
de sécurité du 23/09/2026) :

- `POST /auth/v1/recover` rend **200 pour une adresse inconnue** — c'est la protection
  anti-énumération de Supabase ;
- il ne rend **429 qu'après avoir résolu l'utilisateur**, quand la fréquence d'envoi par compte
  (60 s) est dépassée.

Un 429 ne peut donc désigner qu'une adresse **qui existe**. Une première version affichait « Trop de
demandes » dans ce cas : deux soumissions de la même adresse en moins d'une minute suffisaient à
savoir si elle avait un compte — exactement l'oracle que `25e9a24` et
`server/api/auth/register.post.js` avaient fermé, rouvert par une autre porte.

À la place, le délai est **décompté localement** : le bouton « Renvoyer le lien » est désactivé
pendant 60 s après un envoi, identiquement pour toute adresse. On empêche le visiteur de provoquer le
429 au lieu de lui en parler. Ne pas réintroduire de message dérivé de `error`, `status` ou d'un
délai renvoyé par le serveur.

### Le minimum de 8 caractères vit à deux endroits

`server/api/auth/register.post.js` (`MIN_PASSWORD`) pour l'inscription, et
`app/pages/nouveau-mot-de-passe.vue` pour la réinitialisation — Supabase refuserait sinon, avec un
message en anglais. Les deux doivent bouger ensemble. La **jauge de robustesse ne bloque jamais** :
elle informe, elle ne valide pas.

### Le responsive vient de la v2 des maquettes

Les maquettes ont été mises à jour le 23/09/2026 avec une déclinaison mobile. Par rapport à la
première version, trois valeurs seulement changent, et elles sont dans le code :

| | v1 | v2 (en vigueur) |
|---|---|---|
| Hauteur du panneau en mobile | 230px | **180px** (`18rem`) |
| Titre d'écran en mobile | 38px | **32px** (`3.2rem`) |
| Titres roses du marquee en mobile | oui | **aucun** — tout en contour |

⚠️ Le « plus de rose en mobile » est posé **en CSS** (neutralisation de `.-hot` sous le seuil) et non
par un état lié à `window.innerWidth` comme dans la maquette : une valeur de largeur lue au montage
divergerait entre le rendu serveur et le client.

La prop `forceMobile` des maquettes v2 n'a pas d'équivalent ici : c'est un outil de prévisualisation
de l'éditeur, pas une règle de design.

### Trois détails d'intégration qui se « corrigent » à tort

- **Le seuil responsive est à 960px** (`$tablet-portrait`), pas aux 860px de la maquette : c'est le
  token le plus proche du projet, et n'en créer un sixième pour cinq pages n'en valait pas le coût.
- **Les inset de `.4rem`** (conteneur d'onglets, bouton œil, gap de la jauge) ne suivent pas l'arrondi
  de `f-scss-spacing-rounding` : ce sont des filets, que la règle exclut déjà. L'arrondi les enverrait
  à 0 ou au double.
- **Le picto du bouton n'est pas systématique.** « Se connecter », « Créer mon compte » et « Ma
  demande a été validée » portent la flèche ; « Envoyer le lien » et « Retour à la connexion » non.

### Le logo est la seule exception à `currentColor`

`app/assets/svg/logo.svg` garde ses trois couleurs : c'est une illustration bicolore, pas une icône.
Les quatre autres pictos ajoutés (`arrow-right`, `arrow-left`, `eye`, `check`) suivent la convention
du dépôt.

### L'autofill de Chrome

`_form.scss` était **commenté dans `main.scss`** et posait un fond **blanc**, vestige d'un thème
clair : les champs auto-remplis s'affichaient en bleu pâle sur fond sombre. La règle est maintenant
active et sombre. Son `!important` est nécessaire — le SCSS scoped d'un composant est plus spécifique
et reprendrait la main au focus. Contrepartie : un champ auto-rempli n'affiche pas le halo de focus,
seulement sa bordure rose.

## Accessibilité

Le reset du projet coupe les contours de tout le document
(`html:not(.a11y):not(.no-js) * { outline: none }`, `_reset.scss`), derrière une classe opt-in que
rien n'active. **Chaque élément focalisable de ces écrans porte donc `@include focusRing()`**, sauf
les champs, dont le halo de focus tient ce rôle.

Cas particulier : le **radio de ville** est masqué (`srOnly`) mais reste un vrai radio — il porte le
groupe, la navigation aux flèches et l'état coché. L'anneau de focus est remonté sur la carte par
`:has(.radio:focus-visible)`. Vérifié : la carte reçoit bien `outline: 2px solid #ff6d97` quand le
radio caché prend le focus au clavier.

Marquee, jauge de robustesse et perforation du ticket sont `aria-hidden` : décoratifs. Le marquee et
la pastille d'attente s'arrêtent sous `prefers-reduced-motion`.

## Re-vérifier le rendu

Captures headless, **Chrome système piloté par script** — Playwright n'est installé ni dans le projet
ni globalement, et l'installer n'est pas nécessaire :

```bash
npm run dev          # dans un terminal
node <scratchpad>/shot.mjs <dossier> http://localhost:3000/login …
```

Le script vit dans le scratchpad de session, pas dans le dépôt. Il lance Chrome en
`--headless=new --remote-debugging-port=… --user-data-dir=<temp>`, capture en 1440×900 et 390×844,
et signale tout débordement horizontal ou erreur console. Node 22 expose `WebSocket` en global, donc
aucune dépendance à installer.

⚠️ `/pending` demande une session. Son rendu se vérifie avec un patch temporaire des trois cellules
(sauvegarde du fichier, patch, capture, restauration, contrôle du hash) — ou avec un vrai compte
non approuvé.

⚠️ Ne pas lancer `npm run build` pendant que le serveur de dev tourne (cf. `CLAUDE.md`).

## Un durcissement possible, non activé

`updateUser({ password })` n'exige pas le mot de passe courant : « Secure password change » est
désactivé par défaut chez Supabase. Conjugué au cookie d'un an (`nuxt.config.ts`), quelqu'un ayant un
accès bref au navigateur d'un compte connecté peut changer le mot de passe et garder le compte. C'est
le flux Supabase canonique et ça demande un accès physique à la machine — donc pas un défaut du
chantier, mais un arbitrage : si le modèle de menace inclut l'ordinateur partagé, l'option s'active
dans le dashboard (Authentication → Providers → Email), sans changement de code.

## Hors périmètre

Changement de mot de passe depuis un compte connecté (l'application n'a pas d'écran de réglages),
changement de ville depuis l'interface, vérification d'adresse à l'inscription (`email_confirm: true`
la court-circuite à dessein), et interface d'administration des comptes — l'approbation reste un
geste manuel dans le dashboard Supabase.
