-- Favoris de salle par utilisateur (plan 2609221212)
-- À exécuter une seule fois dans le SQL editor Supabase, APRÈS `2609221213-add-calendar-owner.sql`.
-- Idempotent.
--
-- `cinemas.favorite` est une colonne du référentiel, donc partagée : l'étoile posée par un compte
-- déplace les salles en tête de la vue Séances de **tous** les comptes. Invisible à un seul
-- utilisateur, absurde à deux — et silencieux, puisque rien n'échoue : les salles se réordonnent
-- toutes seules chez le voisin.
--
-- Le favori sort donc du référentiel et devient ce qu'il a toujours été : une relation entre un
-- utilisateur et une salle.
--
-- == Bénéfice de bord, et il est important ======================================================
--
-- `2608151000-tighten-cinemas-rls.sql` documentait une limite qu'il assumait faute de mieux :
--
--   « Postgres n'a pas de granularité "cette colonne seulement" dans une policy […] un compte
--     authentifié peut encore écrire une autre colonne s'il forge la requête. […] Le jour où un
--     second compte existe, la suite est un trigger qui rejette toute mise à jour touchant autre
--     chose que `favorite` / `updated_at`. »
--
-- Ce jour est arrivé, et la sortie est meilleure que le trigger annoncé : la bascule de favori était
-- **la seule écriture légitime du navigateur** sur `cinemas`. Elle part d'ici, donc la policy
-- d'`update` part avec elle, et il ne reste plus rien à filtrer. Pas de trigger à écrire, pas de
-- trigger à maintenir — la curation (`accepts_ugc`), le géocodage, les temps de trajet et les
-- signalements d'absence ne sont plus atteignables que par le `service_role` des scripts.

-- 1. La table ------------------------------------------------------------------------------------
--
-- Clé primaire composite `(user_id, code)` : un compte épingle une salle une fois. C'est aussi
-- l'index qui sert la lecture (`where user_id = …`), sans en ajouter un second.
--
-- Les deux `on delete cascade` disent la même chose dans deux directions : un compte supprimé
-- emporte ses favoris, une salle supprimée emporte les étoiles qui la visaient. Le second cas
-- n'arrive pas aujourd'hui — `2608151000` note que rien ne supprime jamais une salle, « une salle qui
-- ferme reste au référentiel » — mais une clé étrangère qui ne dit pas quoi faire à la suppression
-- bloquerait ce nettoyage le jour où il aurait lieu.

create table if not exists cinema_favorites (
  user_id    uuid        not null references auth.users on delete cascade,
  code       text        not null references cinemas (code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- 2. RLS -----------------------------------------------------------------------------------------
--
-- Trois droits, pas quatre : **pas d'`update`**. Un favori n'a pas d'état à modifier — il existe ou
-- il n'existe pas. `toggleFavorite` devient un `insert` ou un `delete` (cf. Step 16 du plan), jamais
-- une bascule de booléen. Un droit qu'aucun code n'exerce est un droit qu'on ne donne pas.
--
-- `with check` sur l'insertion pour la même raison qu'au fichier précédent : sans lui, un compte
-- pourrait poser une étoile au nom d'un autre.

alter table cinema_favorites enable row level security;

drop policy if exists "cinema_favorites: lecture de ses favoris" on cinema_favorites;
drop policy if exists "cinema_favorites: ajout d'un favori" on cinema_favorites;
drop policy if exists "cinema_favorites: retrait d'un favori" on cinema_favorites;

create policy "cinema_favorites: lecture de ses favoris" on cinema_favorites
  for select to authenticated using (user_id = auth.uid());

create policy "cinema_favorites: ajout d'un favori" on cinema_favorites
  for insert to authenticated with check (user_id = auth.uid());

create policy "cinema_favorites: retrait d'un favori" on cinema_favorites
  for delete to authenticated using (user_id = auth.uid());

-- 3. Backfill depuis la colonne partagée ---------------------------------------------------------
--
-- Les étoiles existantes sont celles d'Alexis : 4 salles sur 66 au relevé du 22/09/2026.
-- `on conflict do nothing` rend le rejeu inoffensif.

insert into cinema_favorites (user_id, code)
select (select id from auth.users where email = 'alexchoc521@gmail.com'), code
from cinemas
where favorite is true
on conflict (user_id, code) do nothing;

-- 4. Fermeture de l'écriture navigateur sur `cinemas` ---------------------------------------------
--
-- La bascule de favori était la seule ; elle n'existe plus ici.
--
-- ⚠️ La policy d'**insertion** reste, et ce n'est pas un oubli : `2608151000` la décrit comme
-- « UNE EXCEPTION, ET ELLE EST STRUCTURANTE ». `/api/allocine/refresh` fait entrer dans `cinemas`
-- toute salle croisée chez Allociné (`rememberTheaters`, `on conflict do nothing`) avec le client de
-- session de l'utilisateur. La retirer ferait disparaître de la vue filtrée toute salle nouvellement
-- découverte — le défaut constaté sur Les 3 Luxembourg. Elle devient d'ailleurs plus utile encore :
-- c'est par elle que les deux salles troyennes entreront au référentiel.

-- ⚠️ Toute policy d'`update`, quel que soit son nom — pas seulement celle que
-- `2608151000-tighten-cinemas-rls.sql` a nommée. Le nom est connu ici, mais une policy d'`update`
-- oubliée sous un autre nom rouvrirait le référentiel en écriture aux comptes authentifiés, et les
-- policies s'additionnent : il suffit d'une. On énumère donc au lieu de deviner.
--
-- ⚠️ Ciblé sur `cmd = 'UPDATE'` et **pas** une purge complète comme sur `calendar` : les policies de
-- lecture et de découverte de salle doivent survivre (cf. le paragraphe suivant).
do $$
declare
  nom text;
begin
  for nom in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'cinemas' and cmd = 'UPDATE'
  loop
    execute format('drop policy %I on cinemas', nom);
    raise notice 'Policy d''update supprimée sur cinemas : %', nom;
  end loop;
end $$;

-- 5. `cinemas.favorite` devient obsolète ----------------------------------------------------------
--
-- Conservée, pas supprimée. Elle est la trace du backfill ci-dessus : la supprimer rendrait
-- impossible de rejouer ce fichier ou de comprendre d'où viennent les lignes de `cinema_favorites`,
-- pour un gain nul. Plus personne ne la lit après Step 16 du plan.

comment on column cinemas.favorite is
  'OBSOLÈTE depuis 2609221214 — les favoris vivent dans `cinema_favorites`, par utilisateur. Conservée comme trace du backfill ; plus aucun code ne la lit.';
