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
Home / Collection / History / Achievements / Stats / Account ; hamburger mobile (overlay) ; bouton + NEW TRADE flottant en bas ; saisie rapide (entry/exit MC + invested, ROI/PnL auto, hold time en chips) ; partage de carte (PNG canvas + "Look at my trade!") ; 29 achievements dont 4 de goal ; goal mensuel (éditable sur Stats, lecture seule sur Home) avec confettis + popup bottom-sheet ; connexion : email + mot de passe (+ reset), Google, wallet tracking par clé publique (anonyme), hCaptcha visible ; auto-import serveur (edge function `sync-trades`, cron 10 min + bouton SYNC) depuis les adresses Solana connectées (Pump.fun, Fomo, autre wallet) : achats SOL/USDC/USDT → reventes, 30 jours de backfill, seules les positions fermées deviennent des cartes ; couleur des cartes selon PnL.

- History : SELECT (multi-sélection) + CLEAR HISTORY ; suppression = corbeille (soft delete). Account > RECOVER TRADES : récupérer sélection / tout, ou supprimer définitivement. Purge auto à 30 jours.

## Limites connues
- Pump.fun et Fomo : pas d'API, mais leurs trades sont on-chain → on lit l'adresse du wallet. Ventes d'un bag acheté avant le suivi et swaps token↔token ignorés.
- Tickers : DexScreener → API pump.fun (`frontend-api-v3.pump.fun/coins-v2/<mint>`, non officielle) pour les mints en `pump` → métadonnées on-chain (Token-2022 ou Metaplex, gratuit) → Helius DAS si clé. Les cartes au ticker raccourci sont réparées à chaque run.
- Sans `HELIUS_API_KEY` (secret edge function) : RPC public, lent (120 tx / wallet / run) et tickers des tokens rugués illisibles.
- Positions dont le token account a été fermé : indétectables.
- "Iconly Pro" n'est pas utilisable (payant) : icônes maison.

## Reste à faire côté Maxence (dashboard)
1. ~~SQL de durcissement~~ : fait (v1 + v2 appliqués via le connecteur Supabase le 2026-09-28).
2. Auth > URL Configuration : Site URL = URL Vercel, seule redirection autorisée.
3. Auth > Providers : Email (password + Confirm email), Google, Anonymous sign-ins. Web3 Wallet désactivé (plus utilisé).
4. ~~Captcha~~ : hCaptcha activé et branché (site key dans app.js).
5. ~~Faux trades PUMPFUN~~ : aucun en base.
6. Auth > Rate Limits : baisser les envois d'email / sign-ins anonymes ; Auth > Sessions : durée max raisonnable.

## Sécurité
Voir README.md (CSP stricte dans vercel.json, PKCE, échappement, validation, RLS).

## Sécurité — rappel
- Si `vendor/supabase.js` change : recalculer le hash SRI dans index.html (`openssl dgst -sha384 -binary vendor/supabase.js | openssl base64 -A`).
- Nouvelle table = RLS + grants minimaux + checks, puis `get_advisors`.

## Auto-import
- Code : `supabase/functions/sync-trades/index.ts` (déployé via le connecteur, verify_jwt=false : auth maison = JWT user ou header x-cron-key vérifié en DB).
- Cron : job pg_cron `sync-trades` (*/10). Secret cron dans Vault (`sync_cron_key`).
- Redéployer après modif du fichier.

## Courbes réelles sur les cartes (bougies)
- Chandeliers du market cap : jusqu'à 2 min avant le 1er achat / 2 min après la dernière vente, bornés au 1er trade du coin. Taille de bougie auto (1 s → 5 min) pour ~50 bougies.
- Coins pump.fun : `sync-trades` lit le flux de trades pump.fun (`swap-api.pump.fun/v2/coins/<mint>/trades`, curseur `<x>-<timestamp_ms>` pour sauter à la bonne période) → bougies à la seconde + B/S posés exactement sur les transactions du wallet (prix de fill). Format `trades.chart` v2 : `{v:2, src, i, w, c:[[t,o,h,l,c]], m:[[t,'b'|'s',mc]]}`.
- Autres coins : bougies minute GeckoTerminal construites dans le navigateur (GeckoTerminal bloque les IP cloud ; pump.fun bloque les navigateurs).
- Trades manuels : ligne pointillée entrée → sortie.

## PnL : brut (comme Fomo / pump.fun) vs net
- `pnl` / `roi` / MC = prix du trade (ce que la pool / bonding curve a reçu ou payé, retrouvé via la contrepartie du token, en suivant jusqu'à 3 swaps intermédiaires). C'est ce qu'affichent Fomo et pump.fun.
- `pnl_net` = ce que le wallet a réellement gagné ; `fees_usd` = frais de plateforme + dépôts (écart net/brut). Affichés dans le détail d'une carte.
- Un rescan (cursor remis à zéro) met à jour les chiffres des cartes existantes via `ext_id` sans toucher à `deleted_at` ni au graphe.

## Partage (share.js)
- Feuille de partage : format POST 4:5 (1080×1350) ou STORY 9:16 (1080×1920), aperçu animé en boucle, option « cacher le $ » (% seulement), légende prête.
- SHARE IMAGE (PNG) ou SHARE VIDEO (6 s : fondu, compteur PnL, bougies qui se dessinent, B/S qui tombent, reflet lumineux). MP4 quand le navigateur sait l'enregistrer (iOS/Chrome récents), sinon WebM ; bouton caché si MediaRecorder absent.
- Envoi via la feuille de partage native (navigator.share) → Insta, X, TikTok… ; sinon téléchargement + légende copiée.
- Tout est dessiné en canvas, aucune requête externe. `window.__dcShareFrame` / `__dcShareRecord` = hooks de test visuel.
