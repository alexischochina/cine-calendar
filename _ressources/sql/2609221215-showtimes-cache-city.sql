-- Dimension ville dans le cache des séances (plan 2609221212)
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- `showtimes_cache` a pour clé primaire `(allocine_id, date)`, et son `payload` ne contient que des
-- salles parisiennes — le filtre `/^75/` d'alors, devenu `belongsToCity`. La ville n'était nulle part parce
-- qu'il n'y en avait qu'une.
--
-- ⚠️⚠️ C'EST LE DÉFAUT LE PLUS SILENCIEUX DU CHANTIER. Sans cette colonne, Alexis et son père se
-- disputent la même ligne pour le même film au même jour : le dernier à rafraîchir écrase les
-- séances de l'autre. Rien ne plante, rien n'est journalisé — chacun voit par intermittence les
-- salles de la ville du voisin, au rythme des rafraîchissements. Un bug d'affichage qui ressemble à
-- une bizarrerie d'Allociné, et qu'on chercherait longtemps ailleurs.
--
-- Les deux tables jumelles ne sont **pas** touchées, et c'est délibéré :
--   - `theater_events_cache` a pour clé `(theater_code, date)` ;
--   - `event_detail_cache` a pour clé `(cinema_key, date, title_key)`.
-- Un code de salle appartient à une ville et à une seule. La dimension y est donc déjà présente,
-- portée par la clé elle-même. Leur ajouter une colonne `city` serait une donnée dérivée, qui peut
-- diverger — exactement ce que ce fichier corrige ailleurs.

-- 1. La colonne ----------------------------------------------------------------------------------
--
-- ⚠️ `default 'paris'` sert **uniquement** à migrer les lignes existantes sans les réécrire une à
-- une. Il est retiré à l'étape 4, et ce retrait n'est pas cosmétique : gardé, il ferait qu'un appel
-- serveur ayant perdu sa ville en chemin écrirait des séances troyennes sous l'étiquette « paris »,
-- sans la moindre erreur. On veut qu'une écriture sans ville **échoue**, pas qu'elle mente.
--
-- Le défaut est exact pour les lignes existantes, pas supposé : leur payload ne peut contenir que
-- des salles 75xxx, c'est le filtre qui les a produites.

alter table showtimes_cache
  add column if not exists city text not null default 'paris';

-- 2. Contrainte de domaine -----------------------------------------------------------------------
--
-- Mêmes valeurs que `profiles.city`, pour la même raison : une ville inconnue ferait sortir le
-- serveur sur une localisation Allociné inexistante.

alter table showtimes_cache
  drop constraint if exists showtimes_cache_city_check;

alter table showtimes_cache
  add constraint showtimes_cache_city_check check (city in ('paris', 'troyes'));

-- 3. Nouvelle clé primaire -----------------------------------------------------------------------
--
-- `(allocine_id, city, date)` — 179 entrées en base au relevé du 22/09/2026, toutes parisiennes.
-- L'upsert de `refreshShowtimes` la vise par
-- `onConflict: 'allocine_id,city,date'` — les deux doivent bouger ensemble.
--
-- ⚠️ Le nom de la contrainte n'est **pas** supposé : il est lu dans `pg_constraint`. La version
-- précédente écrivait `showtimes_cache_pkey` en dur, qui est le nom que Postgres donne par défaut —
-- mais une table créée autrement, ou renommée, en porte un autre, et le `drop` aurait alors échoué
-- au milieu du fichier, après l'ajout de la colonne et avant la nouvelle clé. `pg_constraint` n'étant
-- pas lisible depuis PostgREST, on ne pouvait pas le vérifier d'avance : autant ne pas en dépendre.

do $$
declare
  pk_nom text;
  pk_cols int;
begin
  select conname, array_length(conkey, 1) into pk_nom, pk_cols
  from pg_constraint
  where conrelid = 'showtimes_cache'::regclass and contype = 'p';

  if pk_nom is null then
    alter table showtimes_cache add primary key (allocine_id, city, date);
    raise notice 'Aucune clé primaire trouvée — clé (allocine_id, city, date) créée.';
  elsif pk_cols = 2 then
    execute format('alter table showtimes_cache drop constraint %I', pk_nom);
    alter table showtimes_cache add primary key (allocine_id, city, date);
    raise notice 'Clé primaire % (2 colonnes) remplacée par (allocine_id, city, date).', pk_nom;
  else
    raise notice 'Clé primaire % déjà à % colonnes — rien à faire.', pk_nom, pk_cols;
  end if;
end $$;

-- 4. Retrait du défaut ---------------------------------------------------------------------------
--
-- Les lignes existantes portent maintenant toutes `city = 'paris'`. À partir d'ici, une écriture qui
-- omet la ville viole `not null` et échoue bruyamment — ce qu'on veut.

alter table showtimes_cache
  alter column city drop default;

-- 5. Vérification --------------------------------------------------------------------------------

do $$
declare
  cle text;
begin
  select string_agg(a.attname, ', ' order by k.ord) into cle
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'showtimes_cache'::regclass and c.contype = 'p';

  raise notice 'showtimes_cache — clé primaire : (%)', cle;

  if cle is distinct from 'allocine_id, city, date' then
    raise exception 'Clé primaire inattendue : (%). Attendu (allocine_id, city, date).', cle;
  end if;
end $$;
