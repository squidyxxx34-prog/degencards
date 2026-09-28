# HANDOFF — contexte pour reprendre le projet dans une autre conversation

## Le projet
DEGENCARDS : chaque trade crypto devient une carte collectible (rareté, grade, achievements, XP, goal mensuel). Aucune promesse de profit, pas de conseil financier.

## Stack / déploiement
- Site statique sans build : `index.html`, `styles.css`, `app.js`, `vendor/supabase.js` (supabase-js 2.117.2 auto-hébergé).
- Repo GitHub privé `squidyxxx34-prog/degencards`, branche `main`, déployé sur Vercel (degencards.vercel.app) à chaque push.
- Supabase projet `degencards`, ref `wlxyepkewatmwlziybfb`, région eu-west-3. Tables : `trades`, `connected_accounts`, `goals` (RLS par user).
- Email de commit : squidyxxx34@gmail.com

## Règles de travail (voulues par Maxence)
- Français informel, réponses très courtes, zéro blabla.
- Pas de lien d'artifact : modifier le fichier puis `git push` direct.
- Aucun emoji sur le site : icônes SVG maison (fonction `icon()` dans app.js).
- Prendre l'initiative, livrer fini, pas de questions inutiles.
- Tester avant de pousser (jsdom smoke test) : plusieurs régressions passées venaient de listeners perdus.

## Fonctions en place
Home / Collection / History / Achievements / Stats / Account ; hamburger mobile (overlay) ; bouton + NEW TRADE flottant en bas ; saisie rapide (entry/exit MC + invested, ROI/PnL auto, hold time en chips) ; partage de carte (PNG canvas + "Look at my trade!") ; 29 achievements dont 4 de goal ; goal mensuel (éditable sur Stats, lecture seule sur Home) avec confettis + popup bottom-sheet ; connexion : email magic link, Google, Solana/Ethereum (signInWithWeb3), clé publique seule (anonyme) ; import wallet Solana réel (30 derniers jours, positions fermées = balance 0) ; couleur des cartes selon PnL.

## Limites connues
- Pump.fun et Fomo : pas d'API publique. On lie juste le handle, aucun trade fabriqué.
- Positions dont le token account a été fermé : indétectables.
- "Iconly Pro" n'est pas utilisable (payant) : icônes maison.

## Reste à faire côté Maxence (dashboard)
1. Lancer `supabase/security_hardening.sql` dans Supabase > SQL Editor.
2. Auth > URL Configuration : Site URL = URL Vercel, seule redirection autorisée.
3. Auth > Providers : Web3 Wallet (Solana + Ethereum), Google (Client ID/Secret), Anonymous sign-ins.
4. Auth > Attack Protection : captcha.
5. Supprimer dans History les faux trades `PUMPFUN` créés avant le correctif.

## Sécurité
Voir README.md (CSP stricte dans vercel.json, PKCE, échappement, validation, RLS).
