# Pro Trading V6 — Pine Script Changelog

Successor to V5. **1931 lines · 40 alertes · 25 groupes d'inputs · 132 paramètres**.

## 🆕 V6 — Nouvelles features (13 modules)

**Modules avancés ajoutés en plus de la base initiale:**
- 10: HTF FVG (4H + Daily projected)
- 11: Liquidity Voids
- 12: Mitigation Blocks
- 13: Stacked Confluence Zones

## 🆕 V6 — Modules détaillés (1-9)

### 1. 🟥 VIX Risk Filter
**Groupe:** `V6 · VIX RISK FILTER`

Fetch `TVC:VIX` (daily) en background. Tint background rouge quand VIX > threshold (default 22). Label flottant à droite du dernier bar avec valeur VIX live colorée selon état (calm/normal/stress).

**Inputs:**
- `Use VIX Risk-Off Filter` (default ON)
- `VIX Threshold` (15-40, default 22)
- `Block Long Signals when VIX > threshold` (optionnel — fail-safe pour ICT trader macro)
- `VIX Stress BG Color` (rouge transparent)

**Alertes:** VIX Stress ON · VIX Stress OFF · VIX Complacent (<15)

**Usage:** Quand le VIX dépasse 22, ton background devient rouge → c'est la confirmation visuelle de risk-off macro, complément du risk index dashboard.

---

### 2. 📊 Anchored VWAP (Daily + Weekly)
**Groupe:** `V6 · ANCHORED VWAP`

VWAP journalière (réancre minuit) en orange + VWAP hebdo (réancre lundi) en magenta. Optional bandes ±1σ et ±2σ pour lecture mean-reversion.

**Inputs:**
- `Show Daily VWAP` / `Show Weekly VWAP`
- `Show VWAP Standard Deviation Bands` (off par default)
- 3 couleurs

**Alertes:** Cross above/below Daily VWAP · Cross above/below Weekly VWAP

**Usage:** Daily VWAP = pivot intraday institutionnel. Weekly VWAP = bias hebdo. Reclaim/loss de VWAP = signal de continuation/reversal très fiable.

---

### 3. ⚡ Killzone Background Visual
**Groupe:** `V6 · KILLZONE VISUAL`

3 zones surlignées en UTC+7 (Asia/Bangkok):
- 🇯🇵 Asia 03:00-07:00 (jaune, off par default)
- 🇬🇧 London KZ 14:00-18:00 (bleu)
- 🇺🇸 NY KZ 19:00-22:00 (vert) — **PRIME LN/NY overlap**

**Alertes:** London KZ Open · NY KZ Open

**Usage:** Tu vois instantanément dans quelle killzone tu es. Ne trade JAMAIS en dehors (sauf scalp Asia range).

---

### 4. 🔄 Breaker Blocks
**Groupe:** `V6 · BREAKER BLOCKS`

Détecte quand un Order Block existant se fait casser dans la direction opposée → l'OB devient un **Breaker** (rôle inversé, S→R ou R→S).

**Logique:**
- Bull OB cassé downward (close < bot) → devient **bearish breaker** (résistance rose)
- Bear OB cassé upward (close > top) → devient **bullish breaker** (support cyan)
- Max 6 breakers actifs par direction (rolling)

**Inputs:** `Show Breaker Blocks` · `Breaker Extension` · couleurs

**Usage:** Concept ICT classique — un breaker est souvent plus fiable qu'un OB initial car il a déjà été testé.

---

### 5. ↔️ Inverse FVG (IFVG)
**Groupe:** `V6 · INVERSE FVG`

Similaire au breaker mais pour les FVG. Quand un FVG est totalement comblé (close traverse complètement), il s'inverse.

**Logique:**
- Bull FVG closed-through downward → IFVG bearish (orange foncé)
- Bear FVG closed-through upward → IFVG bullish (purple)
- Label "IFVG" sur la box

**Alerte:** New IFVG Detected (quand un nouveau IFVG se forme)

**Usage:** Trade IFVG comme un OB inversé — Si bullish IFVG se forme et price retest, c'est un long avec entry précis.

---

### 6. 🧭 Multi-Timeframe Bias
**Groupe:** `V6 · MULTI-TF BIAS`

Composite bias sur 4 TFs: Daily + 4H + 1H + Current. Chaque TF retourne +1 / -1 / 0 selon EMA fast > EMA slow > price.

**Score:** Somme des 4 → range [-4, +4]. Math.abs = strength.

**Dashboard:** Nouvelle row "MTF D/4H/1H" avec flèches ▲▼· et score X/4.

**Alertes:**
- MTF Aligned BULL (4/4 bullish)
- MTF Aligned BEAR (4/4 bearish)
- MTF Strong Alignment (3/4 aligned)

**Usage:** Setup de plus haute qualité = 4/4 aligned. C'est rare mais redoutable.

---

### 7. 🎯 OTE Zone from Latest Swing
**Groupe:** `V6 · OTE (SWING)`

Auto-dessine la zone Fib 0.62-0.79 sur le dernier swing confirmé. Direction dépend du trend (long bias → discount zone, short → premium).

**Inputs:** `Show OTE Zone` · `OTE Lower Fib` (0.62) · `OTE Upper Fib` (0.79) · couleur

**Usage:** Entry ICT classique. Combine avec OB/FVG dans la zone OTE pour confluence max.

---

### 8. 🚫 News Blackout Filter
**Groupe:** `V6 · NEWS BLACKOUT`

Suppress visuel des signaux pendant les fenêtres de news high-impact (NFP, CPI, FOMC, ECB).

**Inputs:**
- `Block signals around high-impact events` (default OFF — opt-in)
- `Blackout window` ±X minutes (default 30)
- 3 event times HHMM UTC configurables:
  - `1330` (NFP/CPI/Jobless)
  - `1900` (FOMC press conf)
  - `1215` (ECB)
- `Highlight blackout windows` (BG grise)

**Alertes:** News Blackout ENTER · News Blackout EXIT

**Usage:** Active avant NFP/CPI/FOMC pour éviter de prendre un signal V5 qui se fait écraser par la vol news.

---

### 9. 🔱 Power of 3 (AMD)
**Groupe:** `V6 · POWER OF 3 (AMD)`

Tracker des phases ICT:
- **Asia** (03-07 UTC+7) = **ACCUMULATION** — range builds
- **London** (14-18 UTC+7) = **MANIPULATION** — Judas swing typique
- **NY** (19-22 UTC+7) = **DISTRIBUTION** — true daily trend establishes

**Label** sur le dernier bar avec phase actuelle.
**Dashboard:** Row "P3 / News" combinée.

**Alertes:** P3 MANIPULATION starts · P3 DISTRIBUTION starts

**Usage:** Concept ICT clé. Le retournement Manipulation→Distribution dans NY = best risk-defined long/short setups.

---

### 10. 📈 HTF FVG (4H + Daily projetés)
**Groupe:** `V6 · HTF FVG`

Pulls les FVG du 4H et du Daily via `request.security` et les projette sur le timeframe courant. **Crucial pour ICT** car les FVG HTF sont les plus respectés.

**Inputs:**
- `Show 4H FVGs on current chart` (default ON)
- `Show Daily FVGs on current chart` (default ON)
- `HTF FVG Extension` (default 60 bars)
- Couleurs séparées pour 4H et Daily (Daily plus opaque)

**Labels:** "4H FVG" et "D FVG" dans les boxes

**Alertes:** New 4H Bull/Bear FVG · New Daily Bull/Bear FVG (4 alertes)

**Usage:** Quand tu trades du 1H ou du 15min, ces FVG HTF deviennent des zones magnet. Un Daily FVG non comblé = entry potentielle d'institutionnel.

---

### 11. 💨 Liquidity Voids
**Groupe:** `V6 · LIQUIDITY VOIDS`

Détecte les candles à range extrême (> 2.5× ATR par default) — ces "voids" sont des zones où le prix a bougé trop vite, qui sont souvent retracées.

**Inputs:**
- `Show Liquidity Voids` (default ON)
- `Void ATR Multiplier` (1.5-5.0, default 2.5)
- `Void Extension` (default 40 bars)
- Couleurs bull/bear

**Logique:** Une candle avec body+wicks > 2.5× ATR signale un mouvement imbalanced. Box dessinée du high au low de la candle.

**Alerte:** Liquidity Void

**Usage:** Excellent pour identifier les zones de retracement institutionnel. Trade dans le sens de la void direction sur retest.

---

### 12. 🔄 Mitigation Blocks
**Groupe:** `V6 · MITIGATION BLOCKS`

Détecte l'origine d'un impulse propre (3 candles consécutives même direction, mouvement > 2× ATR). La candle origine devient un "mitigation block".

**Inputs:**
- `Show Mitigation Blocks` (default ON)
- `Mitigation Extension` (default 50 bars)
- `Min Impulse Size` (default 2× ATR)
- Couleurs bull/bear

**Logique:** Différent d'un OB — ici on cherche l'origine d'un mouvement *clean* (sans retest dans la séquence). Price y retourne souvent pour "mitiger" avant de continuer.

**Alertes:** Bullish Mitigation Block · Bearish Mitigation Block

**Usage:** Combine avec OB et FVG pour zones de retracement à haute proba. Particulièrement efficace sur 4H/Daily.

---

### 13. ⭐ Stacked Confluence Zones
**Groupe:** `V6 · STACKED CONFLUENCE`

**LE module killer.** Détecte quand 3+ structures (OB + FVG + Breaker + IFVG + Mitigation) se chevauchent à un même niveau de prix.

**Inputs:**
- `Highlight Stacked Confluence Zones` (default ON)
- `Min Structures to Highlight` (2-5, default 3)
- Couleur jaune transparent

**Logique:** Pour chaque bar, on count combien de structures non-mitigées contiennent le prix courant. Si count >= threshold → highlight + label "STACK ×N".

**Background:** Tinté jaune quand zone active.
**Label:** "STACK ×3" / "STACK ×4" / "STACK ×5" à droite du dernier bar.

**Alerte:** Stacked Confluence Zone

**Usage:** **Setup A+ absolu**. Quand tu vois un stack ×3+ qui aligne avec un MTF Aligned dans une killzone, c'est le trade du mois. Risk défini par la zone, R:R énorme.

---

## 📊 Dashboard V6 (nouvelle structure)

Table top-right, 22 rows × 2 cols. Ajouts:
- **Row 20:** MTF D/4H/1H (▲▼· + score)
- **Row 21:** P3 / News (phase actuelle + status blackout)

---

## 🔔 Alertes V6 ajoutées (17 nouvelles)

| # | Alert Name | Condition |
|---|---|---|
| 1 | VIX Stress ON | VIX cross above threshold |
| 2 | VIX Stress OFF | VIX cross below threshold |
| 3 | VIX Complacent | VIX < 15 |
| 4 | London KZ Open | 14:00 UTC+7 |
| 5 | NY KZ Open | 19:00 UTC+7 |
| 6 | Cross above Daily VWAP | price > vwapDay |
| 7 | Cross below Daily VWAP | price < vwapDay |
| 8 | Cross above Weekly VWAP | price > vwapWeek |
| 9 | Cross below Weekly VWAP | price < vwapWeek |
| 10 | MTF Aligned BULL | 4/4 timeframes bullish |
| 11 | MTF Aligned BEAR | 4/4 timeframes bearish |
| 12 | MTF Strong Alignment | 3/4 timeframes aligned |
| 13 | New IFVG Detected | FVG inverted |
| 14 | News Blackout ENTER | entering blackout window |
| 15 | News Blackout EXIT | clearing blackout |
| 16 | P3 MANIPULATION starts | London opens |
| 17 | P3 DISTRIBUTION starts | NY opens |

---

## 🎯 Workflow recommandé V6

1. **Apply V6 indicator** sur tes Tier 1 charts (12 majeurs)
2. **Active toutes les V6 features** (default ON sauf News Blackout + Asia KZ)
3. **Configure VIX threshold** selon le marché (22 default OK)
4. **Add alerts** sur les 17 V6 alerts via TradingView Alert manager
5. **Check le dashboard top-right** avant chaque entry:
   - Row 20 MTF: si 4/4 aligned dans ta direction = setup A+
   - Row 21 P3: éviter les longs en phase MANIPULATION (Judas swing risk)
6. **Confluence avant pull du trigger:**
   - V5 confluence >= 6/10
   - VWAP daily aligné avec direction
   - MTF score >= 3/4 same direction
   - Pas en News Blackout
   - VIX pas en stress (sauf trade volontaire vol)
   - Killzone active (sauf gros setup HTF)
   - OTE swing + OB/FVG/Breaker/IFVG comme entry trigger

---

## 📈 Stats V6 vs V5

| Metric | V5 | V6 final | Δ |
|---|---|---|---|
| Lines | 1320 | 1931 | +611 |
| Inputs groups | 13 | 25 | +12 |
| Input parameters | ~70 | 132 | +62 |
| Alertes | 15 | 40 | +25 |
| Engine modules | 14 | 27 | +13 |
| Dashboard rows | 20 | 22 | +2 |

---

## 🐛 Bugs corrigés pendant dev V6

- Initialement référencé `bullOBs`/`bearOBs` arrays inexistants → refactor sur `obBoxes`/`obDirArr` (vrais arrays du V5 OB engine)
- Fonctions `biasChar`/`biasCol` initialement définies dans un if block → expandues inline pour scope global
- `inBlackout()` fonction gère le wrap autour de minuit (midnight wrap)

## ✅ Tests passés

- Aucune duplicate var declaration
- Tous les arrays utilisés existent dans le V5
- Tous les inputs définis avant leur usage
- 32 alertes uniques (pas de doublon)
- 9 V6 sections insérées avant ALERTS (ordre d'évaluation correct)
