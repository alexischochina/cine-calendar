-- Un propriétaire sur `calendar` (plan 2609221212)
-- À exécuter une seule fois dans le SQL editor Supabase, APRÈS `2609221212-add-profiles.sql`.
-- Idempotent.
--
-- La migration structurante du chantier. Jusqu'ici la table n'avait aucune notion de propriétaire :
-- `useMovieCalendar.getMovies` fait un `select('*')` sans filtre, et la policy disait
-- `for all to authenticated using (true)`. Sur une application à un seul compte, l'écart entre la
-- policy et le besoin ne se voyait pas. Au second compte, il devient le défaut : le nouveau venu ne
-- verrait pas une liste vide, il verrait **celle d'Alexis**, et ses ajouts atterriraient dedans.
--
-- ⚠️ ORDRE IMPÉRATIF, ET C'EST TOUT L'ENJEU DU FICHIER :
--
--   1. ajouter la colonne (nullable)
--   2. backfiller
--   3. vérifier qu'il ne reste aucun `null`
--   4. seulement ensuite : `not null`, `default`, et la nouvelle policy
--
-- Poser la policy avant le backfill rendrait les lignes invisibles à la requête de backfill
-- elle-même — `user_id = auth.uid()` ne matche rien tant que `user_id` est `null`. Le `update`
-- toucherait zéro ligne, sans erreur, et l'étape 3 attraperait le problème… après avoir donné
-- l'impression que tout s'est bien passé. D'où la vérification explicite plutôt qu'un enchaînement
-- de confiance.
--
-- ⚠️ Fais une sauvegarde Supabase avant de jouer ce fichier. Il touche la seule table qui porte des
-- données irremplaçables du projet — le reste (`showtimes_cache`, `theater_events_cache`,
-- `event_detail_cache`) se reconstruit tout seul depuis Allociné.
--
-- == Relevé sur la base réelle le 22/09/2026, avant écriture ======================================
--
-- La colonne `user_id` **existait déjà** et ses 444 lignes portaient toutes l'identifiant d'Alexis.
-- Le backfill n'a donc rien à réécrire, et ce fichier se réduit en pratique à poser les contraintes
-- et les policies. Les étapes 1 à 3 sont conservées telles quelles : elles deviennent des no-op sur
-- cette base, mais restent la bonne conduite si le fichier est rejoué ailleurs, et l'étape 3 vérifie
-- de toute façon ce qu'elle affirme au lieu de le supposer.

-- 1. La colonne ----------------------------------------------------------------------------------
--
-- Nullable à la création, le temps du backfill. `on delete cascade` : supprimer un compte emporte sa
-- liste. C'est le comportement voulu — une liste de films sans propriétaire n'aurait plus de lecteur
-- et resterait invisible sous la nouvelle policy, donc morte mais facturée.

alter table calendar
  add column if not exists user_id uuid references auth.users on delete cascade;

-- ⚠️ `add column if not exists` ne fait **rien** quand la colonne existe déjà — pas même poser la
-- clé étrangère. C'est exactement le cas ici (cf. le relevé en tête), donc sans ce bloc la colonne
-- resterait un `uuid` libre : rien n'empêcherait une ligne de désigner un compte supprimé, et la
-- suppression d'un compte laisserait sa liste orpheline au lieu de l'emporter.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'calendar'::regclass and contype = 'f'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'calendar'::regclass and attname = 'user_id')]
  ) then
    alter table calendar
      add constraint calendar_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
    raise notice 'Clé étrangère calendar.user_id → auth.users posée.';
  end if;
end $$;

-- 2. Backfill ------------------------------------------------------------------------------------
--
-- Toutes les lignes existantes sont celles d'Alexis : l'application n'a jamais eu d'autre compte.
--
-- ⚠️ Par sous-requête sur l'e-mail, jamais un UUID recopié (même raisonnement qu'au fichier
-- précédent). `where user_id is null` rend le rejeu inoffensif : une ligne déjà attribuée — y
-- compris à un autre compte — n'est pas réécrite.

update calendar
set user_id = (select id from auth.users where email = 'alexchoc521@gmail.com')
where user_id is null;

-- 3. Vérification --------------------------------------------------------------------------------
--
-- La porte de sortie. Si le backfill n'a rien fait (e-mail qui ne correspond à aucun compte), le
-- `not null` de l'étape suivante échouerait de toute façon — mais avec un message Postgres générique
-- sur une contrainte violée, qui n'aide pas à comprendre. Autant échouer ici, en le disant.

do $$
declare
  orphelines bigint;
begin
  select count(*) into orphelines from calendar where user_id is null;
  if orphelines > 0 then
    raise exception 'Backfill incomplet : % ligne(s) de calendar sans user_id. Vérifie que alexchoc521@gmail.com existe bien dans auth.users avant de continuer.', orphelines;
  end if;
end $$;

-- 4. Verrouillage --------------------------------------------------------------------------------
--
-- `not null` : à partir d'ici, une ligne sans propriétaire est impossible.
--
-- `default auth.uid()` : le filet. Les ~30 sites d'appel du navigateur posent `user_id` explicitement
-- (cf. Step 15 du plan), mais un oubli sur un chemin d'insertion rare écrirait une ligne orpheline
-- — invisible pour tout le monde sous la nouvelle policy, donc un film « ajouté » qui n'apparaît
-- jamais. Avec ce défaut, l'oubli est rattrapé silencieusement et correctement.
--
-- ⚠️ Le défaut ne dispense **pas** de poser `user_id` à l'insertion : il vaut `null` en service-role
-- (les scripts et le cron n'ont pas d'`auth.uid()`), où c'est justement le plus facile à oublier.

alter table calendar
  alter column user_id set not null,
  alter column user_id set default auth.uid();

-- La nouvelle policy filtre sur `user_id` à chaque lecture de la table, et la table entière est lue
-- au chargement de la timeline.
create index if not exists calendar_user_id_idx on calendar (user_id);

-- 5. RLS -----------------------------------------------------------------------------------------
--
-- Quatre policies distinctes plutôt qu'un `for all` : `insert` a besoin d'un `with check` et non
-- d'un `using`, et les écrire séparément rend lisible ce que chaque droit autorise.
--
-- ⚠️ `with check` sur l'insertion, c'est ce qui empêche une ligne de **naître au nom d'un autre**.
-- Un `using` seul ne s'applique qu'aux lignes existantes : sans `with check`, un compte pourrait
-- insérer une ligne portant le `user_id` du voisin — ligne qu'il ne reverrait jamais, mais qui
-- apparaîtrait dans la timeline du voisin. Sur `update`, les deux clauses sont posées : `using` dit
-- quelles lignes sont modifiables, `with check` empêche de les faire changer de propriétaire en
-- chemin.

alter table calendar enable row level security;

-- ⚠️⚠️ PURGE EXHAUSTIVE, ET C'EST LE POINT LE PLUS IMPORTANT DU FICHIER.
--
-- Supprimer par nom, c'est parier sur le nom : un `drop … if exists` qui le rate laisse survivre la
-- policy, or les policies s'**additionnent** (OU logique). Une seule permissive oubliée rouvre toute
-- la table et rend inutiles les quatre règles posées plus bas — sans le moindre signal. On énumère
-- donc ce qui existe. `pg_policies` n'est pas lisible depuis PostgREST, d'où ce bloc.
do $$
declare
  nom text;
begin
  for nom in select policyname from pg_policies where schemaname = 'public' and tablename = 'calendar'
  loop
    execute format('drop policy %I on calendar', nom);
    raise notice 'Policy supprimée sur calendar : %', nom;
  end loop;
end $$;

create policy "calendar: lecture de sa liste" on calendar
  for select to authenticated using (user_id = auth.uid());

create policy "calendar: ajout à sa liste" on calendar
  for insert to authenticated with check (user_id = auth.uid());

create policy "calendar: modification de sa liste" on calendar
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "calendar: retrait de sa liste" on calendar
  for delete to authenticated using (user_id = auth.uid());

-- 6. Contrôle final -----------------------------------------------------------------------------
--
-- Vérifie ce que le fichier vient de faire plutôt que de laisser le lecteur le supposer : exactement
-- quatre policies, toutes filtrées sur `auth.uid()`. Si ce bloc lève, la table est encore ouverte.
do $$
declare
  n int;
  permissives text;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'calendar';
  if n <> 4 then
    raise exception 'calendar porte % policy(ies), 4 attendues. Liste : %',
      n, (select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'calendar');
  end if;

  -- Une policy qui ne mentionne pas `auth.uid()` ne filtre pas par propriétaire.
  select string_agg(policyname, ', ') into permissives
  from pg_policies
  where schemaname = 'public' and tablename = 'calendar'
    and coalesce(qual, '') not like '%auth.uid()%'
    and coalesce(with_check, '') not like '%auth.uid()%';

  if permissives is not null then
    raise exception 'Policy(ies) sans filtre auth.uid() sur calendar : %', permissives;
  end if;

  raise notice 'calendar : 4 policies, toutes filtrées sur auth.uid(). Cloisonnement en place.';
end $$;
