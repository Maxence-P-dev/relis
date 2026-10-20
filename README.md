<p align="center">
  <img src="build/icon.png" alt="" width="96">
</p>

<h1 align="center">Relis</h1>

<p align="center"><b>Un raccourci clavier pour corriger tes fautes, partout.</b><br>Discord, navigateur, mails, Word : sélectionne ton texte (ou reste dans le champ), appuie sur <kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>Espace</kbd>, valide les corrections.</p>

## Comment ça marche

1. Relis tourne en fond : son icône est dans la zone de notification, à côté de l'horloge.
2. Dans n'importe quelle application, **sélectionne du texte** ou place simplement ton curseur dans le champ où tu écris.
3. Appuie sur **Ctrl + Maj + Espace**.
4. Une petite fenêtre s'ouvre près de la souris avec les fautes soulignées :
   - rouge : orthographe, orange : grammaire, bleu : typographie, violet : style ;
   - clique sur un mot pour voir l'explication et choisir une autre suggestion, le garder tel quel ou l'ajouter à ton dictionnaire ;
   - **Entrée** corrige tout, **Échap** annule.
5. Le texte corrigé remplace l'original dans ton application. Un **Ctrl + Z** dans l'application annule si besoin.

Ton presse-papiers est remis exactement comme avant.

## Réglages

Clic sur l'icône de Relis dans la zone de notification :

- **Raccourci** : Ctrl + Maj + Espace, Ctrl + Alt + C, Alt + C ou Ctrl + Maj + F12 ;
- **Correction exigeante** : signale aussi le style et la typographie fine ;
- **Démarrer avec Windows** ;
- **Dictionnaire perso** : les mots que tu as ajoutés (pseudos, noms propres, termes techniques), que tu peux retirer.

## Confidentialité

La correction est faite par [LanguageTool](https://languagetool.org) : le texte à corriger est envoyé à leurs serveurs, et à rien d'autre. Relis n'enregistre pas tes textes. L'API gratuite accepte environ 20 corrections par minute et 20 000 caractères par texte.

## Développement

```bash
npm install
npm start          # lance Relis
npm test           # tests de la logique de correction
npm run icons      # régénère les icônes
npm run dist       # installeur et version portable dans release/
```

`scripts/e2e.cjs` lance un test de bout en bout (vraie copie, correction et collage dans une fenêtre de test). Il ouvre une fenêtre et simule des touches : à lancer quand on n'utilise pas le clavier.

Windows uniquement. Licence MIT.
