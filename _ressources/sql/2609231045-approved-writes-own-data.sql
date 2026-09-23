-- Un compte non approuvé ne stocke rien, même chez lui
-- À exécuter une seule fois dans le SQL editor Supabase, APRÈS `2609231006`. Idempotent.
--
-- Suite de `2609231006`, qui a réservé aux comptes approuvés l'écriture des tables **partagées**.
-- Restait une asymétrie : un compte non approuvé pouvait encore écrire dans **sa propre** liste et
-- ses propres favoris. Rien d'exploitable — ce sont ses données, personne d'autre ne les lit — mais
-- ça rendait fausse l'affirmation que ce chantier répète partout, « un compte non approuvé est
-- inerte ».
--
-- Une garantie approximative est pire qu'une garantie absente : on finit par s'y fier.
--
-- ⚠️ **Seules les écritures sont gardées, jamais la lecture.** Un compte dont l'approbation serait
-- retirée doit continuer à voir ses propres films — les lui masquer ressemblerait à une perte de
-- données, alors qu'il s'agit d'une suspension. Même principe que sur les tables partagées : lecture
-- large, écriture contrôlée.
--
-- ⚠️ `is_approved()` est posée par `2609231006`. Si ce fichier lève sur une fonction inconnue, c'est
-- que la migration précédente n'a pas été jouée — la jouer d'abord, pas contourner.

-- 1. calendar --------------------------------------------------------------------------------------
--
-- Les quatre policies de `2609221213` sont reposées à l'identique **sauf** que les trois écritures
-- gagnent `and public.is_approved()`. La lecture est inchangée.
--
-- ⚠️ `user_id = auth.uid()` reste en tête de chaque condition et n'est pas remplacé : c'est lui qui
-- cloisonne. `is_approved()` ne dit pas *à qui* appartient la ligne, seulement si l'appelant a le
-- droit d'écrire. Les deux sont nécessaires, et confondre les deux rôles ouvrirait la liste de l'un
-- à l'autre dès que les deux comptes sont approuvés.

drop policy if exists "calendar: ajout à sa liste" on calendar;
drop policy if exists "calendar: modification de sa liste" on calendar;
drop policy if exists "calendar: retrait de sa liste" on calendar;

create policy "calendar: ajout à sa liste" on calendar
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

create policy "calendar: modification de sa liste" on calendar
  for update to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

create policy "calendar: retrait de sa liste" on calendar
  for delete to authenticated
  using (user_id = auth.uid() and public.is_approved());

-- 2. cinema_favorites ------------------------------------------------------------------------------
--
-- Même traitement. Pas de policy `update` ici non plus : un favori existe ou n'existe pas.

drop policy if exists "cinema_favorites: ajout d'un favori" on cinema_favorites;
drop policy if exists "cinema_favorites: retrait d'un favori" on cinema_favorites;

create policy "cinema_favorites: ajout d'un favori" on cinema_favorites
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

create policy "cinema_favorites: retrait d'un favori" on cinema_favorites
  for delete to authenticated
  using (user_id = auth.uid() and public.is_approved());

-- 3. Contrôle --------------------------------------------------------------------------------------
--
-- Deux invariants, et ils sont distincts : toute écriture passe par l'approbation, **et** toute
-- policy — lecture comprise — cloisonne encore par propriétaire. Vérifier le premier sans le second
-- laisserait passer une policy qui aurait perdu son `auth.uid()` en chemin.

do $$
declare
  sans_approbation text;
  sans_proprietaire text;
begin
  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ')
    into sans_approbation
  from pg_policies
  where schemaname = 'public'
    and tablename in ('calendar', 'cinema_favorites')
    and cmd <> 'SELECT'
    and coalesce(qual, '') || coalesce(with_check, '') not like '%is_approved%';

  if sans_approbation is not null then
    raise exception 'Écriture sans contrôle d''approbation : %', sans_approbation;
  end if;

  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ')
    into sans_proprietaire
  from pg_policies
  where schemaname = 'public'
    and tablename in ('calendar', 'cinema_favorites')
    and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%';

  if sans_proprietaire is not null then
    raise exception 'Policy sans cloisonnement par propriétaire : %', sans_proprietaire;
  end if;

  raise notice 'calendar et cinema_favorites : lecture par propriétaire, écriture réservée aux comptes approuvés.';
end $$;
