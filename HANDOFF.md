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

## Vidéos : TikTok / Reels / Shorts
- Vidéo CARD en Story : carte pleine taille (demande de Maxence), animation qui démarre dès la 1re image (plus de passage vide qui ressemblait à un gel). Le Trade Replay place en-tête, graphe, pied de page, récap dans la zone.
- Pas de grain ni de lignes de balayage dans les vidéos (ils se transforment en blocs après la recompression TikTok).
- Export image par image : WebCodecs (H.264 High 12 Mb/s, keyframe chaque seconde, VP9 si pas d'encodeur H.264) + son rendu hors-ligne (AAC, sinon Opus) + `vendor/mp4-muxer.js` (MIT, chargé à la demande avec SRI). 30 i/s parfaitement constants quelle que soit la vitesse du téléphone. Repli : MediaRecorder temps réel (1 image par créneau de 1/30 s ; export muet si le son ne peut pas démarrer).
- Si mp4-muxer est mis à jour : recalculer `MUXER_SRI` dans share.js.

## Auto-import « infaillible »
- Transactions Solana v1 acceptées (`maxSupportedTransactionVersion: 1`).
- Une transaction illisible bloque le curseur (jamais sautée en silence). Seule une réponse VIDE 5 passages de suite est sautée ; une vraie erreur est toujours remontée (`sync_error`).
- Historique complet jusqu'au curseur (plus de trou à 2000), 500 tx/passage (800 avec Helius), cron `sync-catchup` toutes les 3 min pour les wallets en retard (`sync_pending`).
- Verrou par wallet (`try_lock_account`), même adresse liée deux fois lue une seule fois, RPC de secours pour les lectures simples (publicnode n'a pas l'historique : jamais pour signatures/transactions).
- Position close à ≥97 % vendus ou s'il ne reste que de la poussière (< 0,05 $ ou 1 % de la mise).
- Vérif d'adresse au 1er import (coin / programme / jamais utilisée) + vérif côté client (EVM 0x, adresse finissant par pump/bonk, caractères interdits, longueur).
- Account : fenêtre de connexion (plus de prompt), bouton « ? » par fournisseur avec guide spécifique (Pump.fun, Fomo, Phantom/Solflare/Backpack/Axiom…), statut (rattrapage, cartes importées, erreur lisible), « RE-READ FROM START » (`{task:"resync", provider}`).

## Trade Replay : options (replay.js + share.js)
- Moteur paramétré (`configure(opt)` à chaque image / bande-son) : couleurs (Neon, Purple, Gold, Ice, Mono), intro (Hook, 3-2-1, Logo, None), texte d'accroche (Auto + 6 phrases), graphe (Bougies, Ligne, Aire), caméra (Suivi, Gros plan, Graphe entier), vitesse (lent ≈17,5 s / normal 12,5 s / rapide 8 s de replay), fond (Grille, Épuré, Halo, Étoiles), effets (Max, Doux, Aucun), effet de vente ($, confettis, 🔥, 💎, 🚀, aucun), son (Hype, Chill, Minimal, Coupé), fin (récap + logo, récap + logo court, logo court), langue (EN, FR), afficher Investi / Multiplicateur / Chrono (+ « Hide $ »).
- 4 préréglages (Hype, Clean, Chill, Degen). Choix mémorisés sur l'appareil (`localStorage dc_replay_opts`), valeurs inconnues ignorées. Durée estimée affichée. `dcReplay.duration(opt)` remplace la constante.

## Export vidéo 4K 60 i/s
- Par défaut 4K (2160×3840 pour 9:16, 2160×2700 pour 4:5) à 60 i/s constants, encodage image par image (WebCodecs). Codec choisi selon taille × fréquence : H.264 High 5.2 (4K60) / 4.2 (1080p60), H.264 Main, HEVC (iPhone), VP9. Débit ≈ 50 Mb/s en 4K60 (H.264), ≈ 12 Mb/s en 1080p60. Keyframe chaque seconde.
- Repli automatique si l'appareil refuse : 1080p60 puis 1080p30 ; la qualité obtenue s'affiche dans le toast. Choix « 1080p · 60 fps (faster) » mémorisé (`localStorage dc_video_q`).
- Rendu plus long en 4K (progression + temps restant affichés). Test sur serveur sans GPU : 20 s de vidéo en ~6 min ; bien plus rapide sur téléphone (GPU + encodeur matériel).
- Replay : textes centrés sur les glyphes réels (`fillCentered`), annonce de vente au centre de l'écran, échelle verticale lissée sur ±0,3 s (anticipe les nouveaux extrêmes), bruit de la bougie en cours ralenti.

## PnL net exact (dépôts + cashback pump.fun)
- Bug corrigé : les dépôts (rent des comptes créés à l'achat, ~0,0015 SOL chacun, rendus par une tx `CloseAccount` après la vente) étaient comptés comme des frais (~0,37 $/trade). Dans `parseTx`, quand le wallet paie la tx : comptes créés (pre 0 → post > 0, ≤ 0,01 SOL) réintégrés, comptes fermés (rent d'anciens trades rendue) retirés. Frais réels ≈ 0,015 $/trade.
- Cashback pump.fun : décodé depuis les événements officiels du programme (IDL pump-public-docs) — `TradeEvent.cashback` (bonding curve) et `BuyEvent/SellEvent.cashback` (PumpSwap), logs « Program data » ou inner ix self-CPI (tag e445a52e51cb9a1d), seulement si `user` = le wallet. Ajouté au net, stocké dans `trades.cashback_usd`, affiché dans le détail. Seules les « Cashback Coins » en donnent (mode déprécié pour les nouveaux coins, les anciens continuent).
- Remboursements payés par un relais (Fomo `FHpcNS…` paie la tx et le dépôt, mais la fermeture rend la rent au wallet) : les comptes créés dans une tx non payée par le wallet sont notés (`made`), la tx de fermeture (`parseRefund`) crédite le trade qui les a créés, même après coup (`sync_state.owners` → mise à jour par ext_id).
- Temps partagé : quand plusieurs wallets sont à synchroniser, chacun a au plus 30 s par passage (un gros historique ne bloque plus les autres ; il continue dans les passages de rattrapage).
- Rent rendue DANS une tx de swap payée par le wallet : neutre si le compte était un dépôt d un de nos trades (`sync_state.walletMade`), sinon (vieux compte fermé à ce moment) créditée au trade, brut et net — même règle que Fomo. Ex. CHILL : vieux compte HdZFFJ fermé pendant l achat → +$0.19 / +68 % comme Fomo. MC d entrée/sortie calculés sur le prix du swap seul (`im`/`rm`).

## Graphes des coins hors pump.fun
- Minute GeckoTerminal (fenêtre ±15 min, pools fusionnés pour passer une migration, minutes vides comblées) ; trade < 24 h : bougies à la seconde depuis les 300 derniers trades GT si le flux couvre le trade.
- Si < 12 bougies : le navigateur demande `{task:"chart", ids}` → `buildChainChart` côté serveur : pool trouvé dans la tx d'achat (coffre de tokens de la contrepartie, unique par pool) + pools GT, signatures du coffre autour du trade, 60 tx échantillonnées (200 avec Helius) lues en ordre grossier→fin (proches des fills d'abord), ~4 lectures/s sur le RPC public, prix = variation quote/token du pool, ~50 bougies (`src:"chain"`, `q:2`). Ex. $LONG : 43 bougies de 3 s, MC achat 60,9 K (fill 61,3 K), vente 109,8 K (fill 106 K).
- Les vieux graphes GT sans `q` sont reconstruits une fois au chargement de l'app.
- Une clé `HELIUS_API_KEY` rend ces graphes bien plus rapides et complets (lectures en parallèle).
- Reconstruction des graphes maigres côté serveur : passage `charts` (toutes les 4 min) traite les trades hors pump.fun des 7 derniers jours (autant que le temps le permet) ; ouvrir une carte maigre déclenche la reconstruction immédiate (`{task:"chart", ids}`) ; ciblage admin possible : `{task:"charts", ids:[…]}` avec la clé cron. Lecture ancrée sur les signatures d'achat/vente du trade (avant l'achat, entre achat et vente, après la vente).

## Bougies toujours propres (`cleanCandles`, app.js)
- Tout graphe passe par `parseChart` → `cleanCandles` : cartes, détail, vidéo CARD et Trade Replay dessinent exactement les mêmes bougies.
- Grille régulière (une bougie par intervalle, doublons fusionnés, trous = bougie plate au dernier close).
- Prix aberrants (swap de poussière lu à 1e14, mèche à ~0) : corps à plus de 4x de la médiane locale (±5 bougies) ramenés au niveau local ; mèches plafonnées à 1,5x le corps / 1,1x les corps voisins, sauf si un fill du wallet est dans la bougie. Les données en base restent brutes.
- (abandonné) `densify` (après `cleanCandles`) : chaque vraie bougie est découpée en 2-4 sous-bougies (cible ~120) dont le trajet va du vrai open au vrai close en passant par le vrai high et le vrai low (graine = timestamp, identique partout). OHLC réels conservés, zones plates laissées plates. `ch.iv0` = intervalle réel ; la légende n'affiche plus d'intervalle.

- `regroup` (remplace `densify`) : durée par bougie choisie selon les données. Les bougies sont fusionnées par 2, 3, 4… (OHLC réels) jusqu'à ce que presque aucune ne soit plate, avec au moins ~16 bougies. Graphes trop vides : bougies « tick » (une par passage entre deux vrais prix).

## Lancement (checklist au 2026-10-06)
- Fait : favicon + icônes PWA + manifest, image de partage `og.png` (aperçu lien X/Discord/Telegram), meta description / Open Graph / Twitter, landing indexable (robots.txt : `/` + pages légales seulement, l'app derrière l'auth n'a rien à indexer), sitemap, page 404.
- Whop : plans vérifiés (Monthly $4.99, Yearly $34.99 + 21 j d'essai), produit `prod_tsBbdHC0PSZlN`.
- Reste côté Maxence :
  1. `legal-config.js` : nom, adresse, SIRET, email, directeur de publication, médiateur (obligatoire pour vendre en France, les champs vides s'affichent en rouge).
  2. Secret `WHOP_API_KEY` dans les Edge Functions si pas encore fait (sinon le bloc PRO reste caché).
  3. Supabase Auth : Leaked password protection ON, Site URL / redirect = degencards.vercel.app, rate limits.
  4. Test d'achat réel de bout en bout (Yearly avec essai = 0 $) puis annulation.

## Partage : mode SIMPLE + fond perso
- 3e style dans la feuille de partage : CARD / SIMPLE / TRADE REPLAY. SIMPLE = carte PnL épurée façon terminal (Axiom) : logo, date, coin + ticker, ROI géant, PnL $, lignes Invested / Sold / Hold (Entry MC / Exit MC si « Hide $ »), pas de graphe. Formats POST 4:5, STORY 9:16 et WIDE 16:9 (WIDE seulement en SIMPLE). Image + vidéo (compteur, ≈5 s).
- Fond perso photo ou vidéo pour CARD et SIMPLE (pas le Replay) : fichier lu en local (jamais envoyé), gardé sur l'appareil (IndexedDB `dc_share`), curseur « Darken » 0-85 %. Vidéo : boucle muette dans l'aperçu ; à l'export, chaque image est calée sur la vidéo (seek), durée = au moins une boucle, max 15 s. Limites 25 Mo photo / 200 Mo vidéo.
- Fond perso = PRO (quand PRO est actif) ; SIMPLE est gratuit.
- SIMPLE v2 : panneau Customize (`localStorage dc_simple_opts`) : gros chiffre ROI % ou PnL $, couleur (Auto / Purple / Gold / Ice / Mono), fond prédéfini (Dark / Aurora / Sunset / Matrix / Coin = logo du coin flouté), afficher Stats / Date / Rareté. Couleurs et fonds hors défaut = PRO. Coin en héros (grand, halo) en Wide et Story quand aucun fond perso ; pill de rareté à côté du ticker ; reflet lumineux sur le chiffre en fin d'anim ; ombre portée du texte sur image.
- SIMPLE en STORY 9:16 et en POST 4:5 : plus de plein écran « vidéo » : la carte (4:5 en Story, 5:6 en Post) flotte au centre ; WIDE 16:9 reste plein cadre (style Axiom) (coins arrondis, ombre, halo couleur du résultat, entrée qui se pose), sur le même fond flouté et assombri, avec « Turn your trades into cards / DEGENCARDS » dessous.
- Fond perso : réglages Darken, Position (recadrage) et Blur (flou par réduction, marche aussi sur Safari), gardés avec le fichier. Léger zoom avant sur le fond en vidéo.
- CSP : `media-src 'self' blob:` ajouté (vidéo de fond).

## Trade Replay : options PRO visibles en free
- En free (PRO actif sur le site, user non abonné), le panneau Customize du Replay affiche TOUTES les options : le choix par défaut de chaque groupe est utilisable, toute autre valeur (couleurs, intro, texte, graphe, caméra, vitesse, fond, effets, effet de vente, son, fin, langue), les interrupteurs « Show » et les préréglages autres que Hype portent la pastille PRO et ouvrent le paywall. Bandeau GO PRO en haut du panneau.
- Sécurité inchangée : le rendu ignore toute option tant que le code studio PRO n'est pas chargé (servi par l'edge function `pro` aux seuls abonnés).

## PRO offert (2026-10-08)
- Les 4 comptes existants au 2026-10-08 ont reçu le PRO à vie : ligne `subscriptions` avec `plan_id = 'gift'`, `status = 'active'`, `renews_at = null`, sans membership Whop. Les nouveaux inscrits restent en free.
- `whop` sync (v3) ne rétrograde jamais un `gift` actif (pas de membership Whop, ou membership terminée). Un vrai abonnement Whop actif remplace la ligne.
- Account : « PRO offered by DEGENCARDS », pas de bouton MANAGE.
- Retirer un cadeau : `delete from public.subscriptions where plan_id = 'gift' and user_id = '…';` (ou tous). Offrir à une date limite : mettre `renews_at`.

## Partage : cartes statiques + cartes simplifiées
- « Motion : Animated / Static » (CARD et SIMPLE, pas le Replay), mémorisé (`localStorage dc_share_static`). Static = aucune animation : aperçu et vidéo montrent la carte finie (vidéo 3 s, ou la longueur de la vidéo de fond).
- CARD : panneau Customize (gratuit, `localStorage dc_card_opts`) : Style Full / Clean (sans badges ni rareté) / Minimal (sans graphe, look plat sans halo ni grille), + interrupteurs Coin logo, ROI pill, Chart, Stats, Achievements, Rarity & grade. Les blocs masqués rendent leur place : le contenu est recentré.
- SIMPLE : Style Full / Minimal (façon Axiom : fond plat, pas de halo ni reflet, 2 lignes Invested / Sold) + interrupteurs Coin logo, 2nd number, Stats, Date, Rarity, Trade #. Choisir Minimal coupe 2nd number / Date / Rarity / Trade # (rallumables).
- SIMPLE Post / Story (v3) : hauteur de la carte = son contenu (plus de vide dedans), lignes de stats sur toute la largeur, carte + CTA (+ le logo du coin en grand au-dessus, en Story) centrés comme un seul bloc ; texte un peu plus grand dans la carte.
