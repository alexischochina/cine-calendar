-- Réserver l'écriture des tables partagées aux comptes approuvés
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- ⚠️ CORRECTIF DE SÉCURITÉ. À jouer sans attendre un redéploiement : les policies vivent dans la
-- base, donc ce fichier ferme la brèche à lui seul, sans toucher au code déployé.
--
-- == Ce qui n'allait pas =========================================================================
--
-- Le chantier multi-comptes (`2609221212` à `2609221215`) a ouvert une **inscription publique** et
-- resserré trois tables : `calendar`, `cinema_favorites`, `profiles`. Il en a laissé quatre autres
-- avec leur policy d'origine, écrite à l'époque où l'application n'avait qu'un compte :
--
--   showtimes_cache       for all to authenticated using (true) with check (true)
--   theater_events_cache  idem
--   event_detail_cache    idem
--   cinemas               for insert to authenticated with check (true)
--
-- Or `profiles.approved` **ne garde que l'application**, pas la base. `/api/auth/register` crée le
-- compte avec `email_confirm: true` : il est donc immédiatement connectable sur l'endpoint public
-- de Supabase, avec la clé anon qui est dans le bundle navigateur. Le jeton obtenu porte
-- `role: authenticated`, et PostgREST ne consulte jamais `approved`.
--
-- Conséquence, vérifiée en conditions réelles le 22/09/2026 (insertion forgée réussie, ligne
-- supprimée dans la foulée) : n'importe qui pouvait s'inscrire puis écrire directement dans ces
-- quatre tables, **sans traverser une seule route de l'application**. Donc injecter de faux
-- horaires, de fausses salles, ou une URL de billetterie pointant où il veut — `TimeChip.vue` la
-- rend dans un `href` et le filtre de schéma de `server/utils/allocine.js` ne s'applique qu'à
-- l'ingestion, pas à ce qui est déjà en base.
--
-- L'angle mort est net : on a cloisonné les données **personnelles** en ouvrant l'inscription, sans
-- se demander ce qu'un inconnu pourrait faire des tables **partagées**.
--
-- == Le principe retenu ==========================================================================
--
-- **Lecture ouverte à tout compte authentifié, écriture réservée aux comptes approuvés.**
--
-- La lecture reste large à dessein : ce sont des horaires publics, et `/api/allocine/showtimes` est
-- « le chemin le plus chaud du projet » (cf. `rateLimit.js`) — y ajouter un appel à `is_approved()`
-- à chaque lecture coûterait une sous-requête par ligne pour protéger une donnée qui n'est pas
-- sensible. Ce qui était ouvert et ne devait pas l'être, c'est l'**écriture**.

-- 1. Le prédicat -----------------------------------------------------------------------------------
--
-- ⚠️ `security definer` est indispensable : la fonction lit `profiles`, dont la policy ne rend que
-- la ligne de l'appelant. Sans ça elle fonctionnerait quand même ici (on interroge justement sa
-- propre ligne), mais elle deviendrait dépendante d'une policy qu'un futur resserrage pourrait
-- casser — et une fonction de garde qui rend `false` par accident casse l'application, tandis
-- qu'une qui rend `true` par accident ouvre la porte. On la rend indépendante.
--
-- ⚠️ `set search_path = public` : sans lui, une fonction `security definer` est vulnérable au
-- détournement de résolution de nom — un schéma placé devant `public` dans le `search_path` de
-- l'appelant pourrait fournir une fausse table `profiles`. C'est la précaution standard, et elle
-- n'est pas optionnelle sur une fonction qui décide d'un droit.
--
-- ⚠️ `coalesce(…, false)` : profil absent = non approuvé. Même règle que `requireUser` et
-- `useProfile` — une garde qui s'ouvre sur une donnée manquante n'est pas une garde.
--
-- `stable` et non `volatile` : le planificateur peut ainsi n'évaluer la fonction qu'une fois par
-- requête au lieu d'une fois par ligne.

create or replace function public.is_approved() returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce((select approved from profiles where user_id = auth.uid()), false);
$$;

-- `public` peut l'exécuter : elle ne rend qu'un booléen sur l'appelant lui-même, elle ne divulgue
-- rien sur les autres comptes.
grant execute on function public.is_approved() to authenticated, anon;

-- 2. Les trois caches ------------------------------------------------------------------------------
--
-- ⚠️ Purge **exhaustive** avant de reposer les bonnes policies, comme dans `2609221213` et pour la
-- même raison : les policies s'additionnent (OU logique). Supprimer par nom, c'est parier sur le nom
-- — et une seule policy permissive oubliée annule tout ce fichier, sans le moindre signal.

-- ⚠️ Écrit **table par table**, sans boucle ni SQL dynamique généré par `format()`. Une première
-- version bouclait sur un tableau de noms : plus court, mais impossible à relire d'un coup d'œil et
-- impossible à tester avant de le jouer. Sur un correctif de sécurité, le fichier doit pouvoir se
-- vérifier à la lecture — la répétition est le prix, et il est faible.

-- 2a. showtimes_cache
do $$
declare nom text;
begin
  for nom in select policyname from pg_policies where schemaname = 'public' and tablename = 'showtimes_cache'
  loop
    execute format('drop policy %I on showtimes_cache', nom);
    raise notice 'showtimes_cache — policy supprimée : %', nom;
  end loop;
end $$;

create policy "showtimes_cache: lecture authentifiée" on showtimes_cache
  for select to authenticated using (true);

create policy "showtimes_cache: écriture approuvée" on showtimes_cache
  for all to authenticated using (public.is_approved()) with check (public.is_approved());

-- 2b. theater_events_cache
do $$
declare nom text;
begin
  for nom in select policyname from pg_policies where schemaname = 'public' and tablename = 'theater_events_cache'
  loop
    execute format('drop policy %I on theater_events_cache', nom);
    raise notice 'theater_events_cache — policy supprimée : %', nom;
  end loop;
end $$;

create policy "theater_events_cache: lecture authentifiée" on theater_events_cache
  for select to authenticated using (true);

create policy "theater_events_cache: écriture approuvée" on theater_events_cache
  for all to authenticated using (public.is_approved()) with check (public.is_approved());

-- 2c. event_detail_cache
do $$
declare nom text;
begin
  for nom in select policyname from pg_policies where schemaname = 'public' and tablename = 'event_detail_cache'
  loop
    execute format('drop policy %I on event_detail_cache', nom);
    raise notice 'event_detail_cache — policy supprimée : %', nom;
  end loop;
end $$;

create policy "event_detail_cache: lecture authentifiée" on event_detail_cache
  for select to authenticated using (true);

create policy "event_detail_cache: écriture approuvée" on event_detail_cache
  for all to authenticated using (public.is_approved()) with check (public.is_approved());

-- 3. `cinemas` -------------------------------------------------------------------------------------
--
-- Traité à part : sa policy de lecture doit rester intacte et sa policy d'insertion a une raison
-- d'être documentée. `2608151000` l'appelle « UNE EXCEPTION, ET ELLE EST STRUCTURANTE » —
-- `/api/allocine/refresh` fait entrer toute salle croisée chez Allociné avec le client de session
-- de l'utilisateur, et la retirer ferait disparaître de la vue les salles nouvellement découvertes.
--
-- Elle reste donc, mais réservée aux comptes approuvés : ce sont les seuls à pouvoir atteindre
-- `/api/allocine/refresh`, qui est justement gardée par `requireUser`. La policy et la route disent
-- enfin la même chose.
--
-- ⚠️ Pas de purge exhaustive ici : `cinemas: lecture authentifiée` doit survivre.

drop policy if exists "cinemas: accès authentifié" on cinemas;
drop policy if exists "cinemas: découverte de salle" on cinemas;

create policy "cinemas: découverte de salle" on cinemas
  for insert to authenticated with check (public.is_approved());

-- 4. Contrôle ---------------------------------------------------------------------------------------
--
-- Vérifie ce que le fichier vient de faire plutôt que de le laisser supposer. Lève si une policy
-- autorise encore une écriture sans passer par `is_approved()`.

do $$
declare
  ouvertes text;
begin
  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ')
    into ouvertes
  from pg_policies
  where schemaname = 'public'
    and tablename in ('showtimes_cache', 'theater_events_cache', 'event_detail_cache', 'cinemas')
    and cmd <> 'SELECT'
    and coalesce(qual, '') || coalesce(with_check, '') not like '%is_approved%';

  if ouvertes is not null then
    raise exception 'Écriture encore ouverte sans contrôle d''approbation : %', ouvertes;
  end if;

  raise notice 'Tables partagées : lecture authentifiée, écriture réservée aux comptes approuvés.';
end $$;
