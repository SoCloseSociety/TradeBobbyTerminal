# TradeBobby AI Trading Agent — Architecture

## Vision
Un agent IA autonome qui analyse les marchés via V5 ICT/SMC, 
prend des décisions de paper trading, track les résultats en temps réel,
et s'auto-améliore en analysant ses erreurs.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CLAUDE (BRAIN)                     │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ ANALYSER │  │ DECISION │  │  SELF-IMPROVER    │  │
│  │ V5 data  │→│  Engine   │→│  Post-trade review │  │
│  │ Multi-TF │  │ ICT rules│  │  Pattern learning  │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└────────┬───────────┬────────────────┬───────────────┘
         │           │                │
    ┌────▼────┐ ┌────▼────┐    ┌─────▼──────┐
    │ MCP     │ │ Paper   │    │ Session    │
    │ Jackson │ │ Portfolio│    │ Logs       │
    │ (TV)    │ │ Tracker │    │ & Memory   │
    └─────────┘ └─────────┘    └────────────┘
```

## Components

### 1. ANALYSER (reads market data)
- Scans all 16 watchlist symbols via MCP Jackson
- Reads V5 dashboard (structure, HTF, zone, confluence, MTF, targets)
- Reads OHLCV bars for pattern recognition
- Reads boxes/labels/lines for OB/FVG/BOS state

### 2. DECISION ENGINE (trade logic)
Rules (in priority order):
1. **MTF Alignment check**: Only trade if at least 2/3 timeframes agree
2. **Confluence >= 4/10**: Minimum threshold
3. **Zone filter**: LONG only in discount, SHORT only in premium
4. **OB/FVG proximity**: Must be near a valid level
5. **Volume > 1.5x avg**: Institutional activity confirmed
6. **Killzone timing**: Prefer London/NY overlap
7. **SL management**: NEVER move SL to BE before TP1 hit
8. **Position sizing**: Max 1% risk per trade, max 3 open positions

### 3. PAPER PORTFOLIO (tracks virtual trades)
- File: paper_portfolio.json
- Tracks: open positions, pending orders, closed trades
- Calculates: win rate, P&L, max drawdown, avg R:R
- Updates: every session check

### 4. SELF-IMPROVER (learns from mistakes)
After each trade closes:
- Was the direction correct?
- Was the entry timing good?
- Was the SL too tight or too loose?
- Was the TP realistic?
- What confluence factors were present vs which mattered?
- Update rules.json or strategy params if pattern emerges

### 5. SESSION LOGS (memory)
- Daily session briefs saved to sessions/
- Predictions saved with specific levels
- Weekly review with win/loss analysis
- Memory system for lessons learned

## Execution Flow

### Morning Brief (daily, Asia session)
```
1. Scan 16 symbols on 4H
2. Read V5 dashboard for each
3. Identify top 3 setups by confluence + alignment
4. Generate entry/SL/TP levels
5. Place paper limit orders
6. Save session brief
```

### Killzone Monitor (London/NY overlap)
```
1. Check if any pending orders triggered
2. Monitor open positions for TP1/TP2/SL
3. Check for new BOS/CHoCH on monitored symbols
4. If new high-confluence setup appears, take trade
```

### End of Day Review
```
1. Check all trades — did any close?
2. Update paper_portfolio.json
3. Calculate daily P&L
4. Note lessons learned
5. Adjust tomorrow's plan
```

### Weekly Review (Friday)
```
1. Calculate weekly P&L, win rate
2. Compare predictions vs reality
3. Identify worst trade and WHY it failed
4. Identify best trade and what made it work
5. Adjust strategy parameters if needed
6. Generate next week's plan
```

## Target Metrics
- Win Rate: > 55% (currently 49% on best symbols)
- Average R:R: 2.0 minimum
- Profitable Factor: > 1.5 (wins * avg_win / losses * avg_loss)
- Max Drawdown: < 5% of account
- Weekly trades: 3-5 (quality over quantity)

## Path to Live Trading
1. **Phase 1 (now)**: Paper trading with manual checks
2. **Phase 2**: Automated scanning + manual execution
3. **Phase 3**: Semi-automated (agent suggests, user approves)
4. **Phase 4**: Full auto with safety limits

## Key Rules (hardcoded, never override)
- NEVER risk more than 1% per trade
- NEVER have more than 3 open positions
- NEVER move SL to breakeven before TP1 hit
- NEVER trade against all 3 timeframes
- NEVER trade during news events (30min buffer)
- ALWAYS use confirmed bars only (no repainting)
- ALWAYS wait for killzone timing
