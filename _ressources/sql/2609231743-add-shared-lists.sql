-- Listes partagées entre comptes (plan 2609231743)
-- À exécuter une seule fois dans le SQL editor Supabase, APRÈS `2609231045`. Idempotent.
--
-- Ce fichier ouvre en lecture ce que `2609221213` avait fermé : un compte approuvé peut désormais
-- lire la liste des **autres** comptes, pour la voir dans l'onglet « Liste de … » et y piocher des
-- films. Le partage est mutuel par construction — il n'y a pas d'émetteur et de destinataire, il y a
-- des listes partagées et des listes qui ne le sont pas.
--
-- L'interrupteur est `profiles.display_name`, rempli à la main dans ce dashboard :
--
--     display_name renseigné  →  la liste est visible des autres comptes approuvés
--     display_name null       →  le compte n'apparaît nulle part, sa liste reste illisible
--
-- Un seul champ pour deux rôles (le libellé de l'onglet et le droit de lecture), et c'est voulu :
-- deux réglages distincts se désynchronisent, et l'état « nommé mais pas partagé » n'a aucun usage
-- ici. L'effacer retire le partage, en un geste.
--
-- ⚠️⚠️ CE FICHIER NE SE JOUE PAS SEUL, ET L'ORDRE EST IMPÉRATIF.
--
-- Quatre lectures du code supposaient jusqu'ici que RLS cloisonne, et ne portent donc **aucun**
-- filtre de propriétaire. Les jouer contre ces policies-ci, c'est :
--
--   - `useMovieCalendar.getMovies`  → ma timeline affiche les films de l'autre, mélangés aux miens ;
--   - `MovieAddForm.addMovie`       → `maybeSingle()` **lève** dès qu'on a un film en commun ;
--   - `useProfile.fetchProfile`     → `maybeSingle()` **lève** → repli fermé → tout le monde sur `/pending` ;
--   - `requireUser`                 → `maybeSingle()` **lève** → 503 sur les cinq routes gardées,
--                                     donc la vue Séances tombe.
--
-- Le Step 2 du plan pose le `.eq('user_id', …)` manquant sur ces quatre sites (plus le contrôle
-- d'existence de `addCatchupMovie`). **Il doit être écrit et déployé avant ce fichier.** Dans
-- l'autre sens, les deux comptes cassent en même temps, et le symptôme (« tout le monde sur
-- /pending ») ne ressemble pas du tout à sa cause.
--
-- ⚠️ À partir d'ici, le cloisonnement des **lectures** de `calendar` n'est plus porté par le SGBD
-- mais par le code. Les écritures, elles, restent strictement `user_id = auth.uid()` : personne ne
-- peut modifier la liste d'un autre, et ce fichier n'y touche pas.
--
-- ⚠️⚠️ REJOUER UNE MIGRATION ANTÉRIEURE ANNULE CELLE-CI, EN SILENCE.
--
--   - `2609221213` purge **toutes** les policies de `calendar` par énumération, puis en repose
--     quatre. La policy de partage disparaîtrait sans un mot, et son bloc de contrôle final
--     (« exactement 4 policies ») lèverait de toute façon, puisqu'il y en a cinq maintenant.
--   - `2609231045` vérifie que **toute** policy de `calendar` mentionne `auth.uid()`. La policy de
--     partage ne le mentionne pas — elle ne cloisonne pas par propriétaire, c'est précisément son
--     objet. Son bloc de contrôle lèverait donc aussi.
--
-- Dans les deux cas : **rejoue ce fichier derrière.** Il est idempotent et remet l'état voulu.

-- 1. Le nom d'affichage ---------------------------------------------------------------------------
--
-- Nullable, et `null` est l'état par défaut : un compte naît non partagé, comme il naît non
-- approuvé. Même principe que `approved` — l'ouverture est un geste, jamais un défaut.

alter table profiles
  add column if not exists display_name text;

-- ⚠️ La chaîne vide est le piège de ce fichier. `'' is not null` vaut **true** en SQL : un
-- `display_name` vidé au lieu d'être mis à `null` partagerait la liste sous un slug vide, donc sous
-- une URL cassée que personne ne saurait diagnostiquer. La contrainte l'interdit à la source plutôt
-- que de demander au code de s'en méfier.
--
-- 40 caractères : c'est ce que le rail sait afficher (22rem de large, libellé « Liste de … »).
-- Au-delà, le nom serait tronqué à l'écran sans que rien ne le dise.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'profiles'::regclass and conname = 'profiles_display_name_shape'
  ) then
    alter table profiles
      add constraint profiles_display_name_shape
      check (display_name is null or (btrim(display_name) <> '' and length(display_name) <= 40));
    raise notice 'Contrainte de forme posée sur profiles.display_name.';
  end if;
end $$;

-- Unicité, parce que le nom porte le **slug d'URL** : deux « Papa » rendraient `/2026/listes/papa`
-- ambigu, et la page ouvrirait la liste du premier profil trouvé — au hasard de l'ordre de tri.
--
-- Un index unique et non une contrainte : `create unique index if not exists` est idempotent, là où
-- `add constraint` ne l'est pas. Et l'index sert de toute façon à la résolution par nom.
--
-- Sur `lower(…)` : « Papa » et « papa » produisent le même slug, donc la même URL. Sans le `lower`,
-- la base les accepterait tous les deux et l'ambiguïté reviendrait par la bande.
--
-- ⚠️ La normalisation du slug va **plus loin** que `lower` : elle retire aussi les diacritiques et
-- la ponctuation (cf. `listSlug` dans `app/utils/sharedLists.js`). « Jean-Éric » et « Jean Eric »
-- donnent donc le même slug sans que cet index les refuse. Écart assumé : `unaccent` n'est pas
-- garantie installée, et le cas ne se présente pas à deux comptes. Le code s'en protège en
-- choisissant de façon déterministe et en le signalant dans la console.
create unique index if not exists profiles_display_name_lower_key
  on profiles (lower(display_name));

-- 2. Qui partage sa liste -------------------------------------------------------------------------
--
-- ⚠️ `security definer`, pour la raison écrite en tête de `is_approved()` dans `2609231006` : la
-- fonction lit `profiles`, dont les policies sont justement ce que ce fichier modifie. Une fonction
-- qui décide d'un droit ne doit pas dépendre d'une policy qu'un futur resserrage pourrait casser.
--
-- ⚠️ `set search_path = public` : précaution standard et non optionnelle sur une `security definer`
-- — sans elle, un schéma placé devant `public` dans le `search_path` de l'appelant pourrait fournir
-- une fausse table `profiles`.
--
-- ⚠️⚠️ **Sans argument, et c'est un choix de performance, pas de style.** Une variante
-- `is_shared_list_owner(uid uuid)` serait appelée **une fois par ligne** de `calendar` — sur la
-- lecture la plus chaude du projet (toute la liste, à chaque chargement de page). Sans argument et
-- `stable`, le planificateur peut la replier en InitPlan et ne l'évaluer qu'une fois par requête.
--
-- `coalesce(…, '{}')` : `array_agg` sur zéro ligne rend `null`, et `user_id = any(null)` vaut `null`
-- — donc « pas vrai », donc refusé. Le repli est déjà fermé, mais l'écrire évite d'avoir à le
-- redémontrer à chaque relecture.
--
-- `approved and display_name is not null` : les deux conditions, toujours. Un compte nommé mais pas
-- encore approuvé ne partage rien — sinon l'inscription publique suffirait à se faire lire.

create or replace function public.shared_list_owner_ids() returns uuid[]
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}'::uuid[])
  from profiles
  where approved and display_name is not null;
$$;

-- ⚠️⚠️ **CES DEUX LIGNES NE FERMENT RIEN — voir `2609241150`, à rejouer après ce fichier.**
-- `create function` accorde `execute` à `public`, dont `anon` est membre. Conservé tel quel pour que
-- la migration reste le reflet de ce qui a été joué.
grant execute on function public.shared_list_owner_ids() to authenticated;
revoke execute on function public.shared_list_owner_ids() from anon;

-- 3. Lire les profils partagés --------------------------------------------------------------------
--
-- ⚠️ **Revirement explicite de `2609221212`**, qui écrivait : « Pas de policy `select` ouverte à
-- `authenticated` sur toute la table, même "juste pour voir" : elle permettrait d'énumérer les
-- comptes existants depuis n'importe quelle session. »
--
-- L'avertissement reste juste, et la policy ci-dessous ne l'enfreint pas : elle ne rend **pas** la
-- table. Elle rend les profils qui portent un nom écrit à la main dans ce dashboard, et seulement à
-- un appelant lui-même approuvé. Deux conditions, dont une qui ne peut être remplie que par Alexis.
-- Un compte en attente ne voit toujours rien ; un compte approuvé mais anonyme reste invisible.
--
-- Ce qui sort, pour être dit sans détour : `user_id`, `display_name`, `city`, `approved`,
-- `created_at` des comptes partagés. Aucune adresse e-mail — `profiles` n'en porte pas, elles vivent
-- dans `auth.users`, que rien n'expose ici.
--
-- Elle **s'ajoute** à « profiles: lecture de son profil », qui reste inchangée : les policies
-- s'additionnent, et mon propre profil doit rester lisible que je sois nommé ou non.

drop policy if exists "profiles: lecture des profils partagés" on profiles;
create policy "profiles: lecture des profils partagés" on profiles
  for select to authenticated
  using (display_name is not null and approved and public.is_approved());

-- 4. Lire les listes partagées --------------------------------------------------------------------
--
-- La cinquième policy de `calendar`, et la seule qui ne filtre pas par propriétaire.
--
-- ⚠️ Elle **s'ajoute** aux quatre de `2609221213` / `2609231045`, dont aucune n'est touchée. En
-- particulier « calendar: lecture de sa liste » reste : ma liste doit m'être lisible même si je n'ai
-- pas de `display_name`, c'est-à-dire même si je ne partage rien.
--
-- ⚠️ Les trois policies d'écriture restent `user_id = auth.uid() and is_approved()`. Voir la liste
-- de quelqu'un ne donne **aucun** droit dessus : une tentative d'écriture sur sa ligne touche zéro
-- ligne, sans erreur. C'est pour ça que l'interface de la liste partagée est en lecture seule de
-- bout en bout (cf. Step 12 du plan) — un contrôle qui a l'air d'écrire et n'écrit pas ne
-- produirait aucun signal.

drop policy if exists "calendar: lecture des listes partagées" on calendar;
create policy "calendar: lecture des listes partagées" on calendar
  for select to authenticated
  using (public.is_approved() and user_id = any(public.shared_list_owner_ids()));

-- 5. Contrôle -------------------------------------------------------------------------------------
--
-- Vérifie ce que le fichier vient de faire plutôt que de laisser le lecteur le supposer — même
-- conduite que les migrations précédentes. Quatre invariants, et les deux derniers sont les plus
-- importants : ce fichier ouvre la lecture, il ne doit avoir touché **ni** les écritures **ni** le
-- cloisonnement de ma propre liste.

do $$
declare
  n int;
  ecritures_ouvertes text;
  non_approuves int;
begin
  -- a. Cinq policies sur `calendar` : les quatre d'origine, plus le partage.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'calendar';
  if n <> 5 then
    raise exception 'calendar porte % policy(ies), 5 attendues. Liste : %',
      n, (select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'calendar');
  end if;

  -- b. Deux policies sur `profiles` : la sienne, plus les profils partagés.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'profiles';
  if n <> 2 then
    raise exception 'profiles porte % policy(ies), 2 attendues. Liste : %',
      n, (select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'profiles');
  end if;

  -- c. ⚠️ Les écritures n'ont pas bougé : toujours cloisonnées ET réservées aux comptes approuvés.
  -- C'est l'invariant que ce fichier avait le plus de chances de casser par accident.
  select string_agg(format('%s (%s)', policyname, cmd), ', ') into ecritures_ouvertes
  from pg_policies
  where schemaname = 'public' and tablename = 'calendar' and cmd <> 'SELECT'
    and (coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%'
      or coalesce(qual, '') || coalesce(with_check, '') not like '%is_approved%');

  if ecritures_ouvertes is not null then
    raise exception 'Écriture sur calendar sans cloisonnement ou sans approbation : %', ecritures_ouvertes;
  end if;

  -- d. La lecture de sa propre liste survit : sans elle, un compte non partagé ne verrait plus rien.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar' and cmd = 'SELECT'
      and coalesce(qual, '') like '%auth.uid()%'
  ) then
    raise exception 'La policy de lecture de sa propre liste a disparu de calendar.';
  end if;

  -- e. `shared_list_owner_ids()` ne rend que des comptes approuvés.
  select count(*) into non_approuves
  from profiles
  where user_id = any(public.shared_list_owner_ids()) and not approved;

  if non_approuves > 0 then
    raise exception 'shared_list_owner_ids() rend % compte(s) non approuvé(s).', non_approuves;
  end if;

  raise notice 'Listes partagées en place : lecture ouverte aux profils nommés, écritures inchangées.';
  raise notice 'Comptes partageant leur liste : %',
    coalesce((select string_agg(display_name, ', ' order by display_name)
              from profiles where approved and display_name is not null), '(aucun)');
end $$;

-- 6. Nommer les comptes ---------------------------------------------------------------------------
--
-- La dernière étape est manuelle, et c'est le point de la fonctionnalité : rien n'est partagé tant
-- qu'aucun nom n'est écrit. À faire ici, dans le dashboard, une ligne par compte à ouvrir.
--
-- ⚠️ Par sous-requête sur l'e-mail, jamais un UUID recopié à la main — même raisonnement que dans
-- `2609221212` et `2609221213` : un identifiant collé de travers donnerait silencieusement un nom
-- (donc un partage) au mauvais compte.
--
--   update profiles set display_name = 'Alexis'
--   where user_id = (select id from auth.users where email = 'alexchoc521@gmail.com');
--
--   update profiles set display_name = 'Papa'
--   where user_id = (select id from auth.users where email = '<adresse du second compte>');
--
-- Pour refermer un partage : `update profiles set display_name = null where …`. ⚠️ `null`, pas `''`
-- — la contrainte de forme posée en 1 refuse la chaîne vide, précisément pour que cette confusion
-- lève au lieu de partager sous un slug vide.
