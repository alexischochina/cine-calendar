# Spikes — exploratoire, non maintenu

Ces scripts ont servi **une fois**, à trancher une question. Ils ne sont appelés par rien, ne sont
couverts par aucun test, et ne sont pas tenus à jour quand le code autour d'eux bouge. Les lire comme
du code vivant ferait perdre du temps : ce qu'ils ont établi est dans
`_ressources/README-seances.md`, qui est la version qui compte.

Ils restent ici parce qu'une mesure se rejoue. Si la question se repose — « est-ce qu'une seconde
source nous rendrait ce qu'Allociné perd ? » — repartir du script coûte moins que de refaire le
protocole, et surtout on compare deux relevés faits pareil.

| Script       | Question posée                                                         | Verdict |
|--------------|------------------------------------------------------------------------|---------|
| `cinefil.mjs` | Cinéfil comme seconde source de séances ?                              | Non — rapprochement par titre à 83 %, il faut un identifiant. |
| `pci.mjs`     | paris-cine.info, dont les identifiants **sont** ceux d'Allociné ?      | Cf. `README-seances.md`. |

⚠️ Attendre d'eux qu'ils tournent tels quels est optimiste : ils lisent des sources tierces qui ont
pu changer de forme depuis. En cas d'échec, c'est le protocole qu'on reprend, pas le script qu'on
répare.
