-- Séances événement : marquage dans la vue Séances + mise en avant dans « Au ciné en ce moment »
-- À exécuter une seule fois dans le SQL editor Supabase. Idempotent.
--
-- Trois objets, pour trois besoins distincts.
--
-- == 1. theater_events_cache — la source des événements ==========================================
--
-- ⚠️ L'endpoint Allociné qui sert les horaires (`/_/showtimes/movie-{id}/near-{loc}/`) **ne
-- sélectionne aucun champ d'événement** : ni `isPreview`, ni les tags `Showtime.Event.*`. Seul
-- l'endpoint par salle (`/_/showtimes/theater-{code}/`) les porte — même séance, même `internalId`,
-- jeu de champs différent (vérifié le 14/08/2026). D'où une seconde passe, ciblée sur les seules
-- salles qui jouent des films de la liste (~25 par jour, contre ~53 pour tout Paris), avec son propre
-- cache durable : même architecture et même règle de fraîcheur que `showtimes_cache`, dont il est le
-- jumeau.
--
-- Payload : `{ events, seen, previews }`.
--   - events   : `{ internalId: [libellés] }`, uniquement les séances qui ont au moins un libellé. Une
--                salle rend ~50 séances par jour dont 0 à 1 événement — garder les vides multiplierait
--                la taille par cinquante pour n'y stocker que des tableaux vides.
--   - seen     : tous les `internalId` réellement rendus. ⚠️ Indispensable : cet endpoint est **creux**
--                (`theater-C0159` rendait 1 jour sur 7 là où l'endpoint film en rendait 6, mesuré le
--                13/08/2026), donc une séance absente n'est pas une séance sans événement — c'est une
--                séance dont on ne sait rien. Sans `seen`, on reproduirait le faux positif qui avait
--                fait déclarer Les Halles muette.
--   - previews : les `internalId` qui sont des avant-premières. À part des libellés parce que c'est la
--                seule qualification qui *décide* quelque chose en aval — la carte UGC ne couvre pas
--                les avant-premières — et qu'un booléen se teste là où un libellé se reformule.
--
-- Balayé chaque semaine par `useInTheatersSync`, avec `showtimes_cache` et sur le même critère.
--
-- == 2. calendar.events / events_checked_at — pour la rubrique « Événement à venir » ============
--
-- La vue Séances marque ses séances directement depuis le payload : elle n'a besoin d'aucune colonne.
-- Le rail « Au ciné en ce moment », lui, vit sur la timeline, qui ne lit que Supabase et ne sort
-- jamais sur le réseau. Sans ces deux colonnes, son badge n'apparaîtrait qu'après un passage par la
-- vue Séances — donc jamais au moment où il sert, puisque c'est lui qui doit donner envie d'y aller.
--
--   - events            : séances événement **datées** de ce film, `[{ date, cinema, labels }]`. Les
--                         libellés sont déjà traduits côté serveur (`showtimeEventLabels`,
--                         server/utils/allocine.js). La date est indispensable : la rubrique trie par
--                         imminence et affiche « demain » / « lun. 17 août » — un simple tableau de
--                         libellés ne disait pas s'il fallait y aller ce soir ou samedi.
--                         ⚠️ Accumulé et non remplacé au fil des journées consultées (chaque passage
--                         ne voit qu'une poignée de jours), mais **élagué du passé** : une
--                         avant-première jouée sort d'elle-même. Cf. `mergeEventEntries`.
--   - events_checked_at : horodatage du dernier relevé. Élague les **relevés** périmés, là où la date
--                         élague les **événements** passés : des entrées écrites avant le
--                         renouvellement des grilles ne disent plus rien de la programmation, même si
--                         leurs dates sont futures. Sert aussi de gate hebdomadaire au balayage des
--                         avant-premières (`useUpcomingEvents`).
--
-- Rien à rétro-remplir : tout se peuple de soi-même au prochain contrôle « en salle » (une fois par
-- semaine ciné, en tâche de fond) et à chaque journée affichée dans la vue Séances.

-- 1. Cache durable des événements par salle -----------------------------------------------------
--
-- Jumelle de `showtimes_cache` : même forme, même clé composite (upsert idempotent), même index de
-- ménage. `theater_code` en `text` comme `cinemas.code` — les codes salle Allociné sont
-- alphanumériques (C0097, W3140).

create table if not exists theater_events_cache (
  theater_code text        not null,
  date         date        not null,
  payload      jsonb       not null,
  fetched_at   timestamptz not null default now(),
  primary key (theater_code, date)
);

create index if not exists theater_events_cache_fetched_at_idx on theater_events_cache (fetched_at);

-- 2. Colonnes sur `calendar` --------------------------------------------------------------------

alter table calendar
  add column if not exists events jsonb,
  add column if not exists events_checked_at timestamptz;

-- Nettoyage : `event_labels` a existé dans une version antérieure de ce fichier, avant que la rubrique
-- « Événement à venir » n'impose des entrées datées. Elle n'a jamais servi. Si tu as joué la première
-- version, cette ligne la retire ; sinon elle ne fait rien.
alter table calendar
  drop column if exists event_labels;

-- 3. Cache des libellés d'exploitant ------------------------------------------------------------
--
-- Allociné ne décrit pas ses événements : son vocabulaire est fermé et rend « Avant-première », jamais
-- « en présence du réalisateur ». Ce texte-là vit chez la salle. Deux réseaux branchés à ce jour :
--   - **Dulac** (L'Arlequin, L'Escurial, Majestic Bastille, Majestic Passy, Reflet Médicis) — publie du
--     `schema.org/Event` en JSON-LD, donc de la donnée structurée et non du markup à parser, ce que le
--     projet s'était justement interdit ;
--   - **MK2** (~10 salles parisiennes) — pas de JSON-LD exploitable, on lit sa description SEO
--     (`og:description`). Moins sûr, mais une balise `og:` ne se remanie pas à la légère.
-- `source` retient lequel a répondu, pour savoir quoi re-diagnostiquer le jour où un libellé se tarit.
--
-- ⚠️ Ce cache mémorise **aussi les absences** (`detail is null`). C'est le point important : la plupart
-- des séances événement n'ont aucune source branchée, et sans cache négatif on ressortirait sur le
-- réseau à chaque relevé pour se faire répondre non. Une absence n'est pas définitive pour autant — la
-- fiche peut être publiée après coup — d'où la relecture à chaque nouvelle semaine ciné.
--
-- Clés normalisées (accents dépliés, minuscules) : sans quoi « L'Arlequin » et « l arlequin » feraient
-- deux lignes pour le même événement.

create table if not exists event_detail_cache (
  cinema_key text        not null,
  date       date        not null,
  title_key  text        not null,
  detail     text,
  url        text,
  source     text,
  fetched_at timestamptz not null default now(),
  primary key (cinema_key, date, title_key)
);

-- `source` est arrivée avec le second connecteur (MK2) : cette ligne rattrape une table déjà créée par
-- une version antérieure de ce fichier.
alter table event_detail_cache
  add column if not exists source text;

create index if not exists event_detail_cache_fetched_at_idx on event_detail_cache (fetched_at);

-- 4. RLS ----------------------------------------------------------------------------------------
--
-- Aligné sur `showtimes_cache` : app mono-utilisateur, horaires publics, mais pas d'écriture ouverte.

alter table theater_events_cache enable row level security;
alter table event_detail_cache enable row level security;

drop policy if exists "theater_events_cache: accès authentifié" on theater_events_cache;
create policy "theater_events_cache: accès authentifié" on theater_events_cache
  for all to authenticated using (true) with check (true);

drop policy if exists "event_detail_cache: accès authentifié" on event_detail_cache;
create policy "event_detail_cache: accès authentifié" on event_detail_cache
  for all to authenticated using (true) with check (true);
