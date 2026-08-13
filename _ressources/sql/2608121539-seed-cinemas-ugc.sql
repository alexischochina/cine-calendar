-- Salles acceptant la carte UGC Illimité (plan 2608121539 — page « Séances »)
-- À exécuter APRÈS `2608121539-add-allocine-showtimes.sql` et après un premier affichage de la vue
-- Séances (c'est elle qui peuple `cinemas`). Relançable : idempotent, il repose l'état complet.
--
-- ✅ Liste **validée par l'utilisateur le 12/08/2026**, puis réalignée le même jour après l'audit
-- décrit ci-dessous : 40 salles sur les 52 du référentiel.
--
-- Point de départ : le champ `loyaltyCards` d'Allociné, repris uniquement pour ne pas partir d'une
-- page blanche. La liste reste **curée à la main** : Allociné porte bien cette donnée mais a déjà
-- été pris en flagrant délit d'erreur dessus (cas rapporté : une salle annoncée comme prenant la
-- carte CIP, contredite par toutes les autres sources).
--
-- ⚠️ Ce fichier ne se prononce **que sur les salles qu'il nomme**. Sa première version faisait
-- l'inverse — `update … set accepts_ugc = false where code not in (…)` — et c'était un piège : le
-- relevé de départ couvrait 48 salles, mais `cinemas` se peuple au fil des films consultés. Toute
-- salle découverte ensuite tombait dans le `not in` et se voyait affirmer « n'accepte pas la
-- carte » sans avoir jamais été examinée. Dix cinémas d'art et essai (Les 3 Luxembourg, Le Balzac,
-- Luminor Hôtel de Ville, Le Grand Action…) ont été marqués à tort et sont devenus invisibles
-- derrière le pré-filtre carte, actif par défaut, sans le moindre signal.
--
-- Pour détecter la dérive : `node scripts/set-cinema-ugc.mjs --audit` (aucune requête sortante,
-- il relit le `loyaltyCards` déjà capté dans le cache des séances).

-- Salles où la carte passe -----------------------------------------------------------------------
update cinemas set accepts_ugc = true, updated_at = now() where code in (
  'C0159',         -- UGC Ciné Cité Les Halles (75001)
  'C0065',         -- Le Grand Rex (75002)
  'C0050',         -- MK2 Beaubourg (75003)
  'C0013',         -- Luminor Hôtel de Ville (75004)
  'W7504',         -- Epée de bois (75005)
  'C0072',         -- Le Grand Action (75005)
  'C0074',         -- Reflet Medicis (75005) — CIP, apparue après le seed initial (13/08/2026)
  'C0102',         -- UGC Danton (75006)
  'C0100',         -- Saint-André des Arts (75006)
  'C0103',         -- UGC Montparnasse (75006)
  'C0105',         -- UGC Rotonde (75006)
  'C0041',         -- Nouvel Odéon (75006)
  'C0104',         -- UGC Odéon (75006)
  'C0097',         -- MK2 Odéon (Côté St Germain) (75006)
  'C0054',         -- L'Arlequin (75006)
  'C0093',         -- Lucernaire (75006)
  'C0095',         -- Les 3 Luxembourg (75006)
  'C0009',         -- Le Balzac (75008)
  'C0126',         -- UGC Opéra (75009)
  'C0012',         -- Les Cinq Caumartin (75009)
  'W7510',         -- Le Louxor - Palais du cinéma (75010)
  'C0134',         -- L'Archipel (75010)
  'C0023',         -- Le Brady (75010)
  'C0140',         -- MK2 Bastille (côté Beaumarchais) (75011)
  'C0139',         -- Majestic Bastille (75011)
  'C0026',         -- UGC Ciné Cité Bercy (75012)
  'C0146',         -- UGC Lyon Bastille (75012)
  'C2954',         -- MK2 Bibliothèque (75013)
  'C0147',         -- Escurial (75013)
  'C0150',         -- UGC Gobelins (75013)
  'C0005',         -- L'Entrepôt (75014)
  'C0025',         -- Sept Parnassiens (75014)
  'C0153',         -- Cinéma Chaplin Denfert (75014)
  'W7515',         -- Cinéma Chaplin Saint Lambert (75015)
  'C0120',         -- Majestic Passy (75016)
  'C0175',         -- UGC Ciné Cité Maillot (75017)
  'C0004',         -- Le Cinéma des Cinéastes (75017)
  'C1621',         -- MK2 Quai de Loire (75019)
  'W7509',         -- UGC Ciné Cité Paris 19 (75019)
  'C0003',         -- MK2 Quai de Seine (75019)
  'C0192'          -- MK2 Gambetta (75020)
);

-- Salles où elle ne passe pas --------------------------------------------------------------------
-- Essentiellement le circuit Pathé, qui a sa propre carte. Pour amender : déplacer une ligne d'un
-- bloc à l'autre, puis rejouer ce fichier.
update cinemas set accepts_ugc = false, updated_at = now() where code in (
  'C0060',         -- Pathé BNP Paribas (ex Opéra premier) (75002)
  'C0024',         -- Pathé Les Fauvettes (75013)
  'C0158',         -- Pathé Parnasse - Premium (75014)
  'C0037',         -- Pathé Alésia - Dolby Cinema (75014)
  'C0161',         -- Pathé Convention (75015)
  'C0116',         -- Pathé Aquaboulevard (75015)
  'W7502',         -- Pathé Beaugrenelle - Dolby Cinema (75015)
  'P7517',         -- 7 Batignolles (75017)
  'G0G46',         -- Le CiNey (75018)
  'C0179',         -- Pathé Wepler (75018)
  'W7520',         -- Pathé La Villette - IMAX (75019)
  'W7519'          -- CGR Paris - Lilas (75020)
);
