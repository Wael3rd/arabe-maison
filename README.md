# Arabe à la maison

Application web installable (PWA) pour apprendre l'arabe standard et le tunisien aux enfants, construite à partir du cours en 12 leçons.

## Mettre en ligne sur GitHub Pages (10 minutes, une seule fois)

1. Sur github.com, crée un dépôt public, par exemple `arabe-maison`.
2. Envoie le contenu de ce dossier à la racine du dépôt (bouton **Add file › Upload files**, glisser tout le dossier, puis **Commit**).
3. Dans le dépôt : **Settings › Pages › Build and deployment** : Source **Deploy from a branch**, branche `main`, dossier `/ (root)`, **Save**.
4. Une à deux minutes plus tard, le site est à l'adresse `https://<ton-compte>.github.io/arabe-maison/`.

## Installer sur la tablette Android

1. Ouvre l'adresse dans **Chrome**.
2. Menu ⋮ › **Ajouter à l'écran d'accueil** › **Installer**.
3. L'appli s'ouvre en plein écran et fonctionne ensuite hors connexion.

Voix arabe : Paramètres Android › Synthèse vocale › moteur Google › Installer les données vocales › Arabe. L'écran Réglages de l'espace parent permet de choisir la voix et de la tester.

## La semaine type

Une unité = une semaine. Le parcours indique pour chaque étape le jour où la faire :

| Jour | Séance | Étapes de l'appli |
| --- | --- | --- |
| Mardi | 20 min, lecture à voix haute | ⭐ Nouveaux mots |
| Jeudi | 20 min, écrit dans le cahier | 💬 Dialogue |
| Samedi | 45 min, oral en tunisien | 🇹🇳 Parle tunisien, 🏆 Révision, 🎁 Défi |

Le défi se lance le samedi et dure toute la semaine : il ne bloque pas le parcours (on commence l'unité suivante le mardi) et papa le valide quand il est réussi.

## Modifier le contenu

1. Espace parent (🔒, code choisi à la première ouverture) › **GitHub** : renseigne compte, dépôt, branche et un jeton *fine-grained* limité à ce dépôt avec la permission **Contents : Read and write**.
2. Onglet **Contenu** : modifie une unité (mots, dialogues, défi...). Les changements sont visibles tout de suite sur l'appareil (brouillon).
3. **Publier sur GitHub** : `content.json` est mis à jour dans le dépôt, GitHub Pages republie le site, les autres appareils reçoivent la nouvelle version à la prochaine ouverture.

On peut aussi exporter ou importer le fichier `content.json` à la main.

## Synchroniser la progression entre appareils

La progression des profils (XP, série, étapes, mots) peut être partagée entre plusieurs appareils, par exemple la tablette et un téléphone : chaque enfant passe de l'un à l'autre et voit où en est l'autre (écran « Qui joue ? » et Ligue).

1. Crée un dépôt **privé** `arabe-maison-progression` sur GitHub.
2. Donne au jeton fine-grained l'accès à ce dépôt (Repository access), en plus du dépôt du cours.
3. Espace parent › **GitHub** › **Synchroniser maintenant**.
4. **Jumeler un autre appareil** : ouvre le lien obtenu dans Chrome sur l'autre appareil. Il recopie la configuration GitHub et le code parent ; les profils du même prénom sont fusionnés.

La synchro se fait toute seule (à l'ouverture, après chaque leçon, toutes les 90 secondes). Hors ligne, l'appli continue de marcher et rattrape au retour du réseau. Les XP de chaque appareil s'additionnent, les étapes réussies se cumulent, une remise à zéro ou une suppression de profil s'applique partout.

## Organisation des fichiers

| Fichier | Rôle |
| --- | --- |
| `content.json` | Tout le cours : unités, vocabulaire, dialogues, défis, carnet papa |
| `js/engine.js` | Parcours, génération des exercices, déroulé d'une leçon |
| `js/app.js` | Écrans enfants : profils, parcours, entraînement, ligue, profil |
| `js/parent.js` | Espace parent : carnet, éditeur, réglages, publication GitHub |
| `js/store.js` | Progression, XP, série, cœurs (stockés sur l'appareil) |
| `js/cloud.js` | Synchronisation de la progression entre appareils (dépôt GitHub privé) |
| `js/tts.js` | Synthèse vocale et reconnaissance vocale du navigateur |
| `sw.js` | Fonctionnement hors ligne |

Sans synchro, la progression reste sur l'appareil (sauvegarde possible dans Espace parent › Enfants).
