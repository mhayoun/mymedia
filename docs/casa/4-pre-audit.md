# 4. Pré-audit (ce que le scan CASA va regarder)

Le laboratoire lance un scan automatique (en général OWASP ZAP ou équivalent, sur le site et l'API) et vérifie les
réponses du questionnaire. État au 2026-11-06.

## Fait dans le code (pas encore en ligne : à mettre dans la prochaine release)

| # | Point | Changement |
|---|---|---|
| 1 | En-têtes de sécurité absents (seul HSTS était là) | `vercel.json` : `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (caméra, micro, position, paiement coupés) |
| 2 | Pas de Content-Security-Policy | Ajoutée en **mode rapport seulement** (`Content-Security-Policy-Report-Only`) : rien n'est bloqué, le navigateur écrit seulement dans la console ce qu'elle bloquerait |
| 3 | Dépendance `undici` signalée (serveur) | `npm audit fix` : `@vercel/blob` 2.8.2, `undici` 6.29.1 |
| 4 | Le jeton Google passait dans l'adresse de `tokeninfo` (peut finir dans des journaux) | Envoyé dans le corps d'une requête POST (serveur et application) |
| 5 | Le cache des jetons du serveur ne se vidait jamais | Les jetons expirés sont oubliés |

## À faire ensuite

| # | Point | Quoi faire |
|---|---|---|
| A | Passer la CSP en mode strict | Après la release : utiliser MyMedia normalement (connexion, photos, vidéo, reconnaissance, partage, page d'un lien, Pro/PayPal) avec la console ouverte. Chercher les lignes « Content-Security-Policy … report-only ». Si aucune : renommer l'en-tête en `Content-Security-Policy` |
| B | `zod` signalé (via `@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config`) | Côté serveur seulement, et il ne lit pas les données des utilisateurs. Pas de correction sans casser (`--force`) : attendre une mise à jour de `@vercel/blob`, et l'expliquer au laboratoire si le scan le relève |
| C | Jeton d'accès dans `localStorage` | Souvent relevé. Réponse : durée 1 heure, pas de jeton de renouvellement (refresh token), effacé à la déconnexion, aucun script tiers à part Google, et la CSP limite les scripts. Alternative si le laboratoire insiste : `sessionStorage` (il faudrait se reconnecter à chaque nouvel onglet) |
| D | `Cross-Origin-Opener-Policy` | Google recommande `same-origin-allow-popups` pour la fenêtre de connexion. À essayer avec la CSP stricte, puis à tester (connexion et passage à Pro) |
| E | Limite de requêtes sur `/api/models` | Activer une règle de limite dans le pare-feu Vercel (Firewall → Rate limiting), par exemple 60 requêtes par minute par adresse IP |
| F | Clé d'API publique dans `config.json` | Normal : elle est limitée à l'API Drive et aux sites de MyMedia. Le dire au laboratoire |
| G | Boutique de modèles : les empreintes publiées viennent des photos du vendeur | C'est le vendeur qui choisit de publier, et ce ne sont pas des photos. C'est déjà écrit dans la politique de confidentialité ; le redire dans le questionnaire |
| H | Comptes | Activer la double authentification (2FA) sur Vercel, GitHub et le compte Google m0583212851 si ce n'est pas déjà fait |
