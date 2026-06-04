# 📊 TradeBobby — Daily Watchlist (V6 Pine Script + Macro)

**Liste complète des charts à scanner chaque jour sur TradingView avec Pro_Trading_System_V5.pine appliqué.**

Style ICT/SMC, UTC+7 Koh Samui. Best session: London/NY overlap **20:30-23:00 UTC+7**.

## 🎯 Routine quotidienne

1. **Pré-Asia (avant 03:00 UTC+7)**: Check tier 1 macro (DXY, VIX, US10Y, gold, oil)
2. **Asia (03:00-14:00 UTC+7)**: Build Asian range, no trade, observation
3. **Pré-London (12:00-14:00 UTC+7)**: Note Asia high/low, identifie liquidité ciblée
4. **London (14:00-18:00 UTC+7)**: Premier impulse — souvent fake (Judas swing)
5. **LN/NY Overlap (20:30-23:00 UTC+7) ⚡ PRIME**: Best setups
6. **NY (22:00-03:00 UTC+7)**: Continuation ou retournement

## 📌 Charts pertinents (par catégorie)

### 🥇 TIER 1 — MUST CHECK chaque jour (12 symboles, ~5 min)

Affichés dans le Heatmap du dashboard, scan auto V5.

| Catégorie | Symbole TradingView | TF préféré | Killzone fav |
|---|---|---|---|
| **Forex Majors** | OANDA:EURUSD | 4H, 1H | London + NY |
| | OANDA:GBPUSD | 4H, 1H | London open |
| | OANDA:USDJPY | 4H, 1H | NY |
| | OANDA:GBPJPY | 4H, 1H | London + NY |
| **Indices** | OANDA:NAS100USD | 4H, 1H | NY open |
| | OANDA:SPX500USD | 4H | NY open |
| | OANDA:DE30EUR (DAX) | 4H | London open |
| **Métaux** | OANDA:XAUUSD | 4H, Daily | London + NY |
| | OANDA:XAGUSD | 4H, Daily | London + NY |
| **Énergie** | TVC:USOIL | 4H, Daily | NY (EIA reports Wed 15:30 UTC) |
| | TVC:UKOIL | 4H, Daily | London |
| **Crypto** | COINBASE:BTCUSD | 4H, 1H | NY weekend opens |
| | COINBASE:ETHUSD | 4H, 1H | NY |

### 🥈 TIER 2 — Macro Context (~10 charts, jeté d'œil rapide)

**Volatility / Risk gauges (status bar dashboard les surveille auto):**
- `TVC:VIX` — SPX volatility (<15 complacent, >25 stress)
- `CBOE:VIX9D` + `CBOE:VIX3M` — term structure (backwardation = panic)
- `TVC:MOVE` — bond volatility (>100 = stress obligataire)
- `CBOE:VVIX` — vol of vol

**USD / Rates:**
- `TVC:DXY` — USD index
- `TVC:US10Y` ou `TVC:TNX` — 10-year yield
- `TVC:US2Y` — 2-year yield
- `TVC:US30Y` — 30-year long bond
- `AMEX:TLT` — long bond ETF

**Crypto health:**
- `COINBASE:SOLUSD`, `BITSTAMP:XRPUSD`
- `NASDAQ:IBIT` — BlackRock BTC ETF (flow proxy)
- BTC dominance via `CRYPTOCAP:BTC.D` (TradingView native)

### 🥉 TIER 3 — Mag-7 + Sector ETFs (ouvre 1-2× par session)

**Mag-7 (drivers NAS100):**
- `NASDAQ:AAPL`, `NASDAQ:MSFT`, `NASDAQ:GOOGL`, `NASDAQ:AMZN`
- `NASDAQ:NVDA` (semi king), `NASDAQ:META`, `NASDAQ:TSLA`

**Sector ETFs (rotation):**
- `AMEX:XLK` — Tech
- `AMEX:XLE` — Energy (Hormuz proxy direct)
- `AMEX:XLF` — Finance (yields proxy)
- `AMEX:XLU` — Utilities (defensive)
- `AMEX:XLP` — Staples (defensive)
- `AMEX:XLV` — Health (defensive)
- `AMEX:XLY` — Cons. Discretionary
- `AMEX:XLI` — Industrials
- `AMEX:XLB` — Materials
- `AMEX:XLRE` — Real Estate (rates-sensitive)
- `AMEX:XLC` — Comm. services

**Thematic ETFs:**
- `AMEX:GDX` — Gold miners (leverage gold move)
- `AMEX:GDXJ` — Junior gold miners
- `AMEX:GLD` — Gold ETF (spot tracker)
- `AMEX:SLV` — Silver ETF
- `AMEX:USO` — Oil ETF
- `AMEX:HYG` — High-yield (junk) bonds = credit risk gauge
- `NASDAQ:SMH` — Semiconductors (NVDA/TSM/ASML/AVGO basket)
- `AMEX:ARKK` — Innovation (risk-on proxy)

### 🔥 TIER 4 — Thématique active (selon news cycle)

**🛢️ Energie / Hormuz / Iran (geopolitical alpha):**
- `NYSE:XOM`, `NYSE:CVX`, `NYSE:COP`, `NYSE:OXY` — US oil majors
- `NYSE:SLB`, `NYSE:HAL` — oil services
- `LSE:BP`, `LSE:SHEL` — Europe majors
- `NYSE:ZIM`, `NYSE:DAC`, `NYSE:GLNG` — shipping (Hormuz direct play)
- `NYSE:TNK`, `NYSE:STNG` — tanker stocks

**🥇 Silver squeeze trade (COMEX inventory drain narrative):**
- `AMEX:AGQ` — 2x leveraged silver (backwardation squeeze key chart)
- `NYSE:WPM`, `NYSE:PAAS`, `NYSE:HL` — silver miners
- `OANDA:XAGUSD` daily chart

**🤖 AI / Data centers / Compute:**
- `NASDAQ:NVDA`, `NASDAQ:AMD`, `NASDAQ:AVGO`, `NASDAQ:TSM` — chips
- `NASDAQ:ASML` — lithography monopoly
- `NASDAQ:ARM` — ARM Holdings
- `NYSE:VST` — Vistra Energy (data center power)
- `NYSE:CEG` — Constellation Energy (nuclear AI play)
- `NYSE:GEV` — GE Vernova (grid/turbines)
- `NYSE:ETR`, `NYSE:NEE` — utilities AI data center plays

**⚛️ Uranium / Nuclear renaissance:**
- `NYSE:CCJ` — Cameco
- `NYSE:UEC`, `NYSE:UUUU` — US uranium
- `NYSE:URA` — uranium ETF
- `NYSE:NUKZ` — nuclear ETF
- `NYSE:OKLO`, `NYSE:NNE` — SMR plays

**🛡️ Defense / NATO (escalation hedge):**
- `NYSE:LMT`, `NYSE:RTX`, `NYSE:NOC` — primes
- `NYSE:GD`, `NYSE:HII` — naval
- `NYSE:BA` — Boeing (mixed)
- `LSE:BAES` (BAE Systems), `STO:SAAB` (Saab) — Europe

**💎 Métaux industriels / Copper:**
- `COMEX:HG1!` — copper futures
- `NYSE:FCX` — Freeport (copper king)
- `NYSE:SCCO` — Southern Copper
- `LON:GLEN` (Glencore), `LON:RIO` — diversified miners

**🇨🇳 China / Asia tensions:**
- `NYSE:BABA`, `NYSE:JD`, `NASDAQ:PDD` — China tech
- `AMEX:FXI` — China large-cap ETF
- `NASDAQ:TSM` — Taiwan Semi (geopolitical wild card)
- `OANDA:USDCNH` — offshore yuan

### 🌍 TIER 5 — EM / FX exotic (advanced)

**EM FX (risk-off canary):**
- `OANDA:USDTRY` — Turkey (sanctions/Iran proxy)
- `OANDA:USDZAR` — South Africa
- `OANDA:USDMXN` — Mexico (US trade proxy)
- `OANDA:USDBRL` — Brazil

**Asia FX:**
- `OANDA:USDCNH` — offshore CNY
- `OANDA:USDKRW` — Korean Won (semis proxy)
- `OANDA:USDSGD` — Singapore

**Crosses (carry trade indicators):**
- `OANDA:AUDJPY` — risk-on/off classic
- `OANDA:EURJPY` — yen carry
- `OANDA:NZDJPY` — risk barometer
- `OANDA:CADJPY` — oil-yen

### 🔮 TIER 6 — Crypto altcoins (opportuniste seulement)

**Tier A (toujours surveiller):**
- `COINBASE:BTCUSD`, `COINBASE:ETHUSD`, `COINBASE:SOLUSD`, `COINBASE:XRPUSD`
- BTC dominance `CRYPTOCAP:BTC.D` — alts entry signal sub-56%

**Tier B (si BTC dom drop):**
- `COINBASE:LINKUSD`, `COINBASE:AVAXUSD`, `COINBASE:ADAUSD`
- `COINBASE:DOTUSD`, `COINBASE:ATOMUSD`

**ETF flow proxies:**
- `NASDAQ:IBIT` — BlackRock BTC ETF
- `NASDAQ:ETHA` — BlackRock ETH ETF

### 📊 TIER 7 — Macro futures (rolling contracts)

- `CME_MINI:NQ1!` — NQ futures (NAS100)
- `CME_MINI:ES1!` — E-mini S&P
- `CBOT:ZB1!` — 30Y bond
- `CBOT:ZN1!` — 10Y note
- `COMEX:GC1!` — Gold futures
- `COMEX:SI1!` — Silver futures
- `NYMEX:CL1!` — WTI crude
- `NYMEX:NG1!` — Natural gas
- `ICEUS:DX1!` — DXY futures

## 🎯 Workflow recommandé chaque session

**Routine 5 min avant London open (13:55 UTC+7):**
1. Ouvre dashboard http://localhost:3333 → check Market Wrap + Risk Index + Agent Brief
2. Note les COT extremes (top of dashboard COT panel)
3. Check Catalyst Countdown bar — y a-t-il un event high impact dans les 12h?
4. Scan Heatmap → filtre par classe d'actif
5. Watchlist personnelle (starred) — focus

**Routine pre-NY overlap (19:55 UTC+7):**
1. Re-check Risk Index (a-t-il bougé?)
2. Check Sentiment Trend chart 24h
3. Sur TradingView: re-applique V5 indicator sur top 3-5 setups potentiels
4. Vérifie confluence 6+/10 ET zone Discount (long) / Premium (short)
5. Trade dans le killzone

**Setup ICT/SMC checklist (avant entry):**
- [ ] HTF bias confirmé (D + 4H alignés)
- [ ] Structure: BOS ou CHoCH récent dans la bonne direction
- [ ] Zone: en Discount (long) ou Premium (short)
- [ ] OB ou FVG comme entry trigger
- [ ] Liquidité sweep (Asia high/low, PDH/PDL) si possible
- [ ] Confluence V5 >= 6/10
- [ ] Killzone active (London ou NY overlap)
- [ ] Conviction VERY HIGH ou HIGH dans le scanner
- [ ] R:R minimum 1:2
- [ ] **PAS de news high-impact dans les 30 min** (sauf si setup parfait + tu trades volontairement la vol)
- [ ] **JAMAIS bouger SL à BE avant TP1 hit** — règle absolue

## 📅 Calendar events à pricer chaque mois

- **NFP** (1er vendredi) → DXY, Gold, NAS, USDJPY
- **CPI** (~13-15 du mois) → all USD assets
- **FOMC** (~3ème mardi/mercredi, 8/an) → everything moves
- **ECB decision** (~6/an) → EUR/USD, DAX
- **BoJ** (~8/an) → USDJPY (very volatile)
- **BoE** (~8/an) → GBP/USD, GBPJPY
- **OPEC+ meetings** (variable) → USOIL, UKOIL
- **EIA Crude Inventories** (every Wed 15:30 UTC) → oil
- **PMI Manufacturing** (1st business day) → DXY, SPX

## 🚨 Quick reference — niveaux à toujours noter

Sur chaque chart Tier 1:
- **PDH / PDL** (Previous Day High/Low) — affiché par V5
- **PWH / PWL** (Previous Week High/Low) — affiché par V5
- **PMH / PML** (Previous Month High/Low) — affiché par V5
- **NY Midnight Open** (00:00 ET = 11:00 UTC+7) — clé
- **Asian Range** (high/low) — souvent ciblé par London Judas swing
- **OTE Zone** (Fib 0.62-0.79 du dernier swing)
- **Equal Highs/Lows** (liquidité)
- **Order Block** non mitigé le plus proche

---

**Total charts à surveiller: ~80-100 selon ton niveau de profondeur**
**Charts essentiels (Tier 1+2): ~25** ← focus principal
**Charts opportunistes (Tier 3-7): ~75** ← consulter selon news/thèmes actifs
