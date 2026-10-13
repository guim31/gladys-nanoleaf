# Nanoleaf

Pilotez vos panneaux lumineux **Nanoleaf** depuis Gladys Assistant, **en
réseau local**, par l'OpenAPI Nanoleaf : marche/arrêt, luminosité, couleur,
température de blanc, effets, et les **gestes tactiles** des panneaux comme
déclencheurs de scène. Pas de cloud, pas de compte.

> **Développée sans le matériel : vos retours sont les bienvenus.**
> L'intégration est construite et testée sur les réponses documentées par
> Nanoleaf, pas sur de vrais panneaux. Signalez ce qui marche et ce qui ne
> marche pas dans les [issues](https://github.com/guim31/gladys-nanoleaf/issues)
> (Developed without the hardware: feedback welcome).

Cette intégration n'est pas affiliée à Nanoleaf.

## Prérequis

- Gladys Assistant **5.1.0** ou plus récent.
- Des panneaux avec un contrôleur Wi-Fi qui parle l'OpenAPI Nanoleaf : **Light
  Panels** (Aurora), **Canvas**, **Shapes** (hexagones, triangles, mini
  triangles), **Elements** et **Lines**, sur le même réseau que Gladys.
- Les panneaux d'abord installés dans l'application Nanoleaf (réseau Wi-Fi).
- Les ampoules et rubans **Nanoleaf Essentials** (Matter / Thread) ne parlent
  pas l'OpenAPI : ajoutez-les à Gladys par Matter.

## Installation et appairage

1. Dans Gladys, ouvrez **Intégrations** → **Installer depuis GitHub** et
   saisissez `https://github.com/guim31/gladys-nanoleaf` (ou installez
   **Nanoleaf** depuis le catalogue une fois l'intégration publiée).
2. Ouvrez l'onglet **Configuration** de l'intégration. Les panneaux du même
   réseau que Gladys sont trouvés automatiquement (mDNS, et SSDP pour les
   anciens Light Panels). Si les vôtres ne sont pas trouvés, saisissez leur
   adresse IP dans **Adresses IP des contrôleurs Nanoleaf** (plusieurs
   adresses : séparez-les par des virgules).
3. Sur les panneaux, **maintenez le bouton marche 5 à 7 secondes** jusqu'à ce
   que les lumières clignotent, puis cliquez sur **Appairer** dans l'onglet
   Configuration **dans les 30 secondes**. Le message sous le bouton nomme les
   panneaux appairés. Pour n'appairer qu'une adresse, saisissez-la dans le
   champ **Adresse IP (facultatif)** du bouton.
4. Ouvrez l'onglet **Découverte** et ajoutez l'appareil.

**Langue des noms des appareils** : la langue des noms des fonctionnalités des
nouveaux appareils (français par défaut). Gladys garde les noms donnés à
l'ajout de l'appareil.

Le jeton d'appairage est gardé dans le volume `/data` de l'intégration, jamais
dans la configuration ni dans les journaux.

## L'appareil

Un appareil par contrôleur (un ensemble de panneaux), avec ces
fonctionnalités :

| Fonctionnalité             | Ce qu'elle fait                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Éclairage**              | Marche / arrêt.                                                                                                       |
| **Luminosité**             | 0 à 100 %. 0 éteint les panneaux.                                                                                     |
| **Couleur**                | N'importe quelle couleur (teinte et saturation). Pas sur Elements, qui n'affichent que du blanc.                      |
| **Température de couleur** | Le blanc, en kelvins, dans la plage du contrôleur (1200-6500 K sur la plupart).                                       |
| **Effet**                  | Les effets de **ce** contrôleur, comme dans l'application Nanoleaf. **Aucun** : retour à la couleur unie ou au blanc. |
| **Connecté**               | Lecture seule : le contrôleur répond. Coupés au mur, les panneaux sont aussi montrés éteints.                         |

Une luminosité, une couleur ou un blanc allume aussi les panneaux, comme les
autres lampes de Gladys. Un changement fait dans l'application Nanoleaf, avec
les boutons ou par un programme Nanoleaf apparaît dans Gladys en moins d'une
seconde. Un nouvel effet créé dans l'application rejoint la liste **Effet** en
moins d'une minute.

## Widget

Ajoutez le widget **Nanoleaf** à un tableau de bord et choisissez les panneaux
dans ses réglages. Il affiche :

- la luminosité, en direct ;
- **Éclairage** (allumé ou éteint), **Effet** (l'effet en cours, la couleur ou
  le blanc) et, sur les panneaux tactiles, **Dernier geste** avec le numéro du
  panneau ;
- jusqu'à quatre **effets favoris** en boutons (celui en cours porte une
  coche). Saisissez leurs noms dans **Effets favoris**, séparés par des
  virgules ; vide, les trois premiers effets de la liste sont affichés ;
- avec trois favoris ou moins, un bouton **Allumer** / **Éteindre**.

## Déclencheur de scène

**Geste sur un Nanoleaf** : une tape ou un balayage sur les panneaux tactiles
(Canvas, Shapes, Elements). Filtres, tous facultatifs :

- **Nanoleaf** : les panneaux ; vide pour tous ;
- **Geste** : **Simple tape**, **Double tape**, **Balayage vers le haut**,
  **Balayage vers le bas**, **Balayage vers la gauche**, **Balayage vers la
  droite** ; vide pour tous les gestes ;
- **Numéro du panneau** : pour les tapes seulement (un balayage couvre tout
  l'assemblage). Tapez le panneau, puis lisez son numéro sur la ligne
  **Dernier geste** du widget. Les numéros sont donnés par le contrôleur : ils
  changent si les panneaux sont réassemblés.

La scène peut utiliser le geste (`single_tap`, `double_tap`, `swipe_up`…) et
le numéro du panneau comme variables.

## Actions de scène

- **Lancer un effet Nanoleaf** : un effet par son nom, tel qu'il est écrit
  dans l'application Nanoleaf (majuscules et minuscules indifférentes), avec
  une luminosité facultative. Le nom de l'effet lancé est disponible pour les
  actions suivantes. Un nom inconnu fait échouer l'action et liste les effets.
- **Afficher une couleur sur un Nanoleaf** : une couleur de la liste, ou
  **Autre couleur** au format `#RRGGBB`, pendant un nombre de secondes (1 à
  3600), avec une luminosité facultative ; puis les panneaux reviennent à ce
  qu'ils affichaient avant (effet, couleur ou blanc, luminosité, allumés ou
  éteints). Une commande sur les panneaux entre-temps annule le retour. Pas
  sur Elements.

Allumer, éteindre, la luminosité, la couleur, le blanc et la liste des effets
sont aussi disponibles comme actions d'appareil habituelles de Gladys.

## Boutons de configuration

- **Appairer** : voir _Installation et appairage_.
- **Rechercher les contrôleurs Nanoleaf** : cherche à nouveau et liste les
  contrôleurs appairés (qui répondent ou non) et ceux encore à appairer.

## Exemples de scènes

- **Double tape pour éteindre le salon** : déclencheur _Geste sur un
  Nanoleaf_, geste _Double tape_ ; action : éteindre les lumières du salon.
- **Un panneau comme témoin de sonnette** : quand la sonnette sonne, _Afficher
  une couleur sur un Nanoleaf_, bleu, 20 secondes, luminosité 100 %.
- **Balayage pour l'ambiance du soir** : _Geste sur un Nanoleaf_, geste
  _Balayage vers le bas_ ; actions : _Lancer un effet Nanoleaf_ « Northern
  Lights » à 30 %, et baisser les autres lumières.
- **Coucher du soleil** : au coucher du soleil, _Lancer un effet Nanoleaf_
  « Sundown ».

## Rafraîchissement et usage du réseau

- Chaque contrôleur garde **une connexion ouverte** vers le flux d'événements
  de l'intégration (`/events` de l'OpenAPI Nanoleaf) : changements et gestes
  arrivent tout de suite.
- Chaque contrôleur est aussi **lu une fois par minute** (quelques
  kilo-octets), pour suivre la liste des effets et remarquer un contrôleur
  disparu.
- Le réseau est **recherché toutes les 15 minutes** (par Gladys), pour suivre
  une adresse qui a changé.
- Tout reste sur le réseau local : port 16021 des contrôleurs, pas de cloud.
  L'OpenAPI ne publie pas de quota ; l'intégration reste loin de ce que fait
  l'application Nanoleaf.

## Dépannage

- **« Aucun Nanoleaf en mode appairage »** : maintenez le bouton marche plus
  longtemps (5 à 7 secondes, jusqu'à ce que les lumières clignotent), puis
  cliquez sur **Appairer** tout de suite : la fenêtre d'appairage dure 30
  secondes.
- **« Aucun Nanoleaf trouvé »** : vérifiez que les panneaux sont sur le même
  réseau que Gladys (pas un réseau invité), puis saisissez leur adresse IP
  (affichée dans l'application Nanoleaf ou dans votre box).
- **« Un Nanoleaf refuse son jeton d'accès »** : le contrôleur a été
  réinitialisé ou ses jetons supprimés. Appairez-le de nouveau : l'appareil
  garde ses fonctionnalités et son historique.
- **L'appareil reste « ne répond pas »** : le contrôleur est coupé au mur, ou
  son adresse a changé et la recherche ne l'a pas trouvé. Cliquez sur
  **Rechercher les contrôleurs Nanoleaf**, ou saisissez la nouvelle adresse.
- **Un geste ne fait rien** : seuls Canvas, Shapes et Elements sont tactiles ;
  vérifiez que le tactile n'est pas désactivé dans l'application Nanoleaf, et
  que l'appareil est choisi dans le déclencheur (ou laissé vide).
- Plus de détails dans les journaux de l'intégration avec `LOG_LEVEL=debug`.

## Limites

- Développée sans le matériel : les réponses des contrôleurs viennent de la
  documentation Nanoleaf.
- Les Nanoleaf **Essentials** (Matter / Thread), le kit **4D / Screen Mirror**
  et le **Skylight** ne sont pas couverts.
- Le mode musique **Rhythm**, les scènes et programmes de l'application
  Nanoleaf, l'assemblage et les couleurs panneau par panneau ne sont pas
  disponibles.
- Le toucher de chaque panneau (flux temps réel) demande un port UDP que le
  conteneur de Gladys ne peut pas ouvrir : seuls les gestes sont disponibles.
- Les effets dont le nom commence ou finit par une espace sont écartés de la
  liste.
- Le retour après **Afficher une couleur sur un Nanoleaf** ne survit pas à un
  redémarrage de l'intégration pendant l'attente.
