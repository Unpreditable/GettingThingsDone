## 0.3.0

#### Nouveautés
- Voir ce que vous avez accompli : cliquez sur 🏆 dans le ruban pour voir les tâches terminées aujourd'hui, hier, cette semaine ou la semaine dernière, avec un graphique sur 10 semaines.
- Modifiez l'échéance ou la date planifiée d'une tâche depuis son menu contextuel.
- Une commande **Basculer la tâche terminée**, à côté de celles pour « en cours » et « annulée ».
- Les tâches qui ne peuvent pas encore commencer ou qui attendent une autre tâche sont estompées.
- Lit les champs de Tasks au format Dataview.

## 0.2.7

- Aucun changement. La 0.2.6 a été republiée pour passer un problème dans les vérifications de publication d'Obsidian.

## 0.2.6

#### Nouveautés
- **Filtre global des tâches** : une case ne compte comme tâche que si elle contient l'un des textes indiqués, comme dans le plugin Tasks. Des options incluent les sous-tâches et masquent le texte du filtre dans le panneau.
- **En cours et annulée** : des commandes de l'éditeur et des éléments du menu contextuel marquent une tâche en cours ou annulée. Les relancer la remet à l'état ouverte.

#### Corrections
- Les tâches des notes avec des fins de ligne Windows n'apparaissaient pas dans le panneau.
- Annuler dans la fenêtre d'édition de Tasks effaçait la ligne de la tâche.
- À examiner perdait une tâche tout juste cochée, et les tâches ignorées revenaient.
- La recherche laissait une catégorie à l'écran alors que tous ses résultats étaient masqués.

## 0.2.5

#### Nouveautés
- **Ouvrir les liens depuis le panneau** : cliquez sur un lien d'une tâche pour l'ouvrir.

#### Corrections
- Les #titres dans les wikiliens et les #fragments dans les URL disparaissaient du texte de la tâche dans le panneau.

## 0.2.4

#### Nouveautés
- **Modifier la tâche** : ouvrez une tâche dans la fenêtre d'édition du plugin Tasks depuis le menu contextuel.
- **Aller à la tâche** : ouvrir une tâche centre sa ligne, y place le curseur et la surligne brièvement.
- Chaque élément du menu contextuel a une icône quand les menus natifs sont désactivés dans Paramètres → Apparence.

## 0.2.3

#### Nouveautés
- **Plus d'états de case** : en cours `[/]`, transférée `[>]` et planifiée `[<]` s'affichent comme tâches ouvertes, et annulée `[-]` compte comme terminée.
- Le panneau affiche les icônes de votre thème pour ces états.

## 0.2.2

#### Nouveautés
- **Premier jour de la semaine** : choisissez-le dans les paramètres, et Cette semaine et Semaine prochaine le suivent.
- **Exclusions lors de l'analyse de tout le coffre** : ignorez les dossiers et fichiers choisis. Les listes de dossiers et de fichiers sont fusionnées en une seule.

#### Corrections
- Les sections personnalisées des paramètres s'affichent de nouveau correctement dans Obsidian 1.13 et versions ultérieures. La section « Getting Things Done » s'appelle désormais « Général ».
- Il manquait le badge ↖︎ à une sous-tâche dont la tâche parente n'est pas à l'écran. Son infobulle nomme maintenant la tâche parente.

## 0.2.1

#### Nouveautés
- **Date de la tâche** : classez les tâches selon leur échéance, leur date planifiée, la plus proche des deux, ou aucune.
- **Catégories triées par date** : les tâches sont triées par date dans une catégorie, celles sans date en dernier. Une catégorie ordonnée par glisser-déposer garde votre ordre.
- **Épingler et détacher** : épinglez une tâche à une catégorie, ou détachez-la pour qu'elle suive de nouveau ses dates.
- Des marques distinctes « en retard » et « mal classée », expliquées dans la fenêtre contextuelle.
- **Règle Tout (règle fourre-tout)** : prend chaque tâche datée qu'aucune catégorie au-dessus n'a prise. Un jour / Peut-être l'a par défaut.
- Les icônes suivent Obsidian et votre thème.

#### Corrections
- Les notes ajoutées après le démarrage d'Obsidian n'apparaissaient qu'après un redémarrage.

## 0.2.0

#### Nouveautés
- **Un ordre qui tient** : votre ordre de glisser-déposer survit aux modifications de fichiers, renommages, déplacements de dossiers et redémarrages.
- **Terminer via le plugin Tasks** : les tâches récurrentes obtiennent leur prochaine occurrence, et les dates ✅ suivent les règles de Tasks.
- Les tâches terminées restent dans le panneau jusqu'au rechargement.
- **Champs du plugin Tasks** : priorité, récurrence, dates et actions à la fin s'affichent en badges et dans la fenêtre au survol, avec des paramètres pour choisir lesquels.
- **Marques « en retard » et « mal classée »**, et une ligne d'échéance dans la fenêtre au survol.
- Une icône dans le ruban ouvre le panneau.

#### Corrections
- Une tâche glissée vers une autre catégorie atterrissait au mauvais endroit, et les sous-tâches s'éloignaient de leur tâche parente.
- Un second panneau s'ouvrait au rechargement ou à la mise à jour, et les catégories ne basculaient pas à minuit.
- Les métadonnées du plugin Tasks se retrouvaient dans le texte de la tâche, et des infobulles apparaissaient pendant le glisser.
- Le plugin demande avant d'ouvrir son lien GitHub pour les retours.

## 0.1.9

#### Nouveautés
- Chaque périmètre d'analyse (tout le coffre, dossiers, fichiers) garde sa propre liste.
- Un message quand aucun dossier ni fichier n'est choisi pour l'analyse.
- Les paramètres de comportement apparaissent dans la recherche des paramètres d'Obsidian (Obsidian 1.13 et versions ultérieures).
- Une bannière de remerciement dans les paramètres, avec un lien pour partager vos retours et idées.

#### Corrections
- Les références de bloc (^abc123) étaient perdues quand la catégorie d'une tâche était écrite.
- Des tâches obsolètes après un changement de périmètre d'analyse, et l'image de célébration qui n'apparaissait parfois pas.
- L'avis de changement de langue apparaissait lors de la première installation.

## 0.1.8

#### Corrections
- La mauvaise ligne s'ouvrait pour une tâche dans une note modifiée près du début.

## 0.1.7

#### Nouveautés
- **12 langues**, selon la langue d'Obsidian.
- Ouvrir une tâche utilise l'onglet de sa note s'il est déjà ouvert.
- Le texte de la tâche occupe toute la ligne ; les boutons de déplacement rapide apparaissent au survol.

## 0.1.6

#### Nouveautés
- Survoler une tâche affiche sa note et son numéro de ligne.

## 0.1.5

#### Nouveautés
- **Recherche** : filtrez le panneau pendant la saisie.
- Les versions publiées sont signées, pour que vous puissiez vérifier qu'elles proviennent du code source officiel.

## 0.1.4

#### Corrections
- Les tâches sous des puces simples apparaissaient comme sous-tâches d'une tâche sans rapport.

## 0.1.3

#### Nouveautés
- Le texte de la tâche affiche le gras, l'italique, le barré, le code, les surlignages et les liens, comme dans vos notes.

## 0.1.2

#### Nouveautés
- Les tâches terminées ont un bouton pour les ignorer, et **Tout ignorer** dans l'en-tête les retire d'un coup.

## 0.1.1

#### Nouveautés
- Les wikiliens du texte de la tâche s'affichent dans le panneau.
- Les compteurs de la barre d'état sont cliquables.

#### Corrections
- Les infobulles des tâches terminées, et les déplacements qui échouaient à cause de données de tâche obsolètes.

## 0.1.0

#### Nouveautés
- Le panneau GTD : les tâches de votre coffre regroupées en Aujourd'hui, Cette semaine, Un jour et plus.
- Déplacez les tâches en un clic ou par glisser-déposer.
- Les sous-tâches suivent leur tâche parente.
- Des compteurs de tâches par catégorie dans la barre d'état.
- Des animations de célébration quand vous terminez une tâche.
- Une vue compacte.
- La catégorie est stockée en étiquette en ligne (#gtd/today) ou en champ en ligne Dataview.
