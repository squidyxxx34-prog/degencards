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

## Guide de démarrage (guide.js)
- 10 étapes, lancé automatiquement au 1er affichage de l'app (par utilisateur, `localStorage dc_guide_done_<uid>`), rejouable via le bouton « ? » du header ou Account > Getting started.
- Accessibilité : vraie boîte de dialogue (role=dialog, aria-modal, labelledby/describedby), focus sur le titre à chaque étape, focus piégé, reste de la page `inert`, annonces aria-live, Esc = passer, ← → = naviguer, boutons ≥ 44 px, texte 16 px, prefers-reduced-motion et prefers-contrast respectés.
- Téléphone : fiche en bas d'écran, la cible est amenée au-dessus (le scroll se fait sur le vrai conteneur, ici `body`). Tablette/ordi : bulle placée à côté de la cible.

## Images des coins
- `sync-trades` trouve l'image (pump.fun → DexScreener → métadonnées on-chain Token-2022/Metaplex → JSON → image, → Helius si clé), essaie plusieurs passerelles IPFS, vérifie que c'est bien une image (PNG/JPEG/GIF/WebP, 3 Mo max) puis la COPIE dans le bucket public `coin-images` (`<mint>.<ext>`). `trades.image` = URL publique (contrainte : uniquement notre bucket).
- Cron dédié `coin-images` toutes les 5 min (body `{"task":"images"}`), + à chaque synchro. 3 essais max par coin (`image_tries`).
- Front : logo tel quel (object-fit: contain) sur les cartes, le détail, l'historique et l'image/vidéo de partage (chargé en CORS, bucket = ACAO *). CSP img-src autorise seulement le domaine Supabase.

## Détail d'une carte (refonte)
- En-tête (logo, ticker, n°, source, date, rareté, grade), bloc résultat (PnL, ROI, ×MC, durée, net après frais), graphe + état réel (prêt / en cours / pas de données / manuel), liste des fills (heure, +Δ, MC), bloc Trade (mise, récupéré, MC entrée/sortie, ouverture/fermeture, frais, net), Contexte (rang, % battu, historique sur ce coin), badges, adresse du coin + copier + liens pump.fun / DexScreener / Solscan, actions collées en bas (Share, Delete).
- 2 colonnes à partir de 760 px (iPad), 1 colonne sur téléphone.
- `fmt.mc` gère K / M / B.
- Ouvrir une carte sans bougies les construit tout de suite : pump.fun → edge function `{task:"chart", id}` (JWT user, un seul trade, bougies à la seconde) ; sinon, ou si pump.fun bloque, bougies minute GeckoTerminal dans le navigateur. Les graphes minute des coins pump sont ensuite remplacés par la version seconde par le cron.
- Crons décalés pour ne jamais frapper pump.fun en même temps : sync */10, images 2-59/5, graphes 4-59/4 (tâche `charts`). Si pump.fun bloque 3 passages de suite pour un trade, le navigateur prend le relais en bougies minute.

## Graphes : chargement rapide
- À l'ouverture de l'app, tous les graphes manquants sont demandés tout de suite (`warmCharts`) : coins pump.fun par lots de 10 à l'edge function (`{task:"chart", ids}`, rythme pump.fun 0,7 s en mode à la demande), autres coins dans la file navigateur (GeckoTerminal). Les cartes visibles à l'écran passent en premier (IntersectionObserver).
- Les trades pump.fun importés par la synchro reçoivent leur graphe dans le même passage (`freshPump`).
- Pools GeckoTerminal mis en cache 7 jours (localStorage) : 1 requête de moins par coin.
- Pendant le chargement : squelette de bougies animé (plus de fausse ligne).

## Vidéo « Trade replay » (replay.js)
- 2e style dans la feuille de partage (CARD / TRADE REPLAY), toujours en 9:16 1080×1920, environ 18 s : intro logo, warp, replay des vraies bougies (caméra qui suit, LIVE PNL + INVESTED, multiplicateur vs achat, temps écoulé), viseur BUY avec la mise, viseur SELL, explosion de $ + résultat, écran final (BAG SECURED / TRADE CLOSED, profit, courbe avec BUY/SELL, investi, MC entrée/sortie).
- Uniquement achats et ventes (pas de callouts). Dessin déterministe (image = f(temps)) : l'aperçu et l'export sont identiques. Rythme : plus lent pendant le trade, pause sur BUY et SELL.
- v2 (≈21 s) : intro « hook » (résultat qui claque en glitch + shake, flashs sur le beat, « +X% IN Ns / ON $TICKER / WATCH THE TRADE »), bougie en formation vivante (bruit seedé qui reste dans le vrai high/low et finit sur le vrai close), outro DEGENCARDS avec le joyau ✧ du logo (tracé, remplissage violet→or, reflet, étincelles, lettres qui tombent).
- Bande-son synthétisée (Web Audio, aucun fichier) calée sur la même timeline : slam, kick, whoosh du warp, tick par bougie (aigu si verte, grave si rouge), lock-on + basse au BUY, lock-on + cha-ching (ou descente si perte) + boom au SELL, arpège sur le joyau. Mixée dans le MP4 ; bouton son dans l'aperçu (coupé par défaut). L'AudioContext est créé dans le tap (iOS).
- Nécessite le graphe v2 du trade ; sinon le bouton est désactivé avec une note. Option « Hide $ » respectée. SHARE IMAGE en mode replay = écran final.
