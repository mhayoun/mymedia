# Dossier de vérification Google (scope `drive`) et CASA

Projet Google Cloud : **mymedia-510719** (compte m0583212851@gmail.com), client web
`246067015646-63ga5nqjgihi3sd8mmb3ch0urb0i1q5m`, client Android `246067015646-hcjsb25d…`.
Le projet « MyMedia Free » (scope `drive.file`) n'a **pas** besoin de CASA.

| Fichier | Contenu |
|---|---|
| [1-justification.md](1-justification.md) | Textes à coller dans le formulaire de Google (anglais), avec traduction |
| [2-video.md](2-video.md) | Scénario de la vidéo de démonstration, plan par plan |
| [3-questionnaire.md](3-questionnaire.md) | Réponses préparées pour le questionnaire du laboratoire CASA (anglais) |
| [4-pre-audit.md](4-pre-audit.md) | Ce que le scan va regarder : déjà corrigé, reste à faire |

## Ordre des étapes

1. **Avant de soumettre** (voir 4-pre-audit.md)
   - [ ] Mettre en ligne les en-têtes de sécurité (fait dans `vercel.json`, en mode « rapport seulement »), vérifier la console, puis passer au mode strict.
   - [ ] Search Console : `media-keep.com` vérifié avec le compte m0583212851.
   - [ ] Écran de consentement de mymedia-510719 : nom « MyMedia », logo, e-mail d'assistance,
         page d'accueil `https://www.media-keep.com/about.html`,
         confidentialité `https://www.media-keep.com/privacy.html`, domaine autorisé `media-keep.com`.
   - [ ] Garder **un seul** scope restreint : `https://www.googleapis.com/auth/drive` (MyMedia ne demande rien d'autre).
         Retirer tout autre scope inutilisé de la liste « Accès aux données ».
2. **Tourner la vidéo** (2-video.md), la mettre sur YouTube en « Non répertoriée ».
3. **Soumettre** : Écran de consentement → Accès aux données → justification (1-justification.md) + lien vidéo → « Préparer la vérification ».
4. **Répondre aux e-mails de Google** (souvent 1 à 3 allers-retours, en anglais). Garder les réponses courtes et factuelles.
5. **Lettre CASA** : Google demande le « CASA Tier 2 ». Transférer l'e-mail à un laboratoire agréé
   (liste : https://appdefensealliance.dev/casa/casa-assessors — TAC Security, Leviathan, DEKRA…). Demander 2 devis.
6. **Évaluation** : questionnaire (3-questionnaire.md) + scan de `https://www.media-keep.com` et de `/api/models`.
   Corriger ce qui est trouvé, nouveau scan, le laboratoire envoie la « Letter of Validation » à Google.
7. **Approbation** : plus de limite de 100 comptes, plus d'avertissement. **À refaire chaque année.**

Budget indicatif : 1 500 à 6 000 $ / an pour le laboratoire ; durée totale 1 à 3 mois.
