# Margin Stacking Strategy — Generic Template

> Copy this to `MARGIN_STRATEGY.md` and customize amounts for your account size.

## The problem
Without strict rules, micro-lot stacking leads to over-leverage and liquidation risk.

## Non-negotiable rules

### Rule 1: MAX N POSITIONS
- Cap concurrent micro-lots based on your account size
- Margin used should stay < 50% of equity
- Always know your liquidation distance in points

### Rule 2: ENTRY ONLY WHEN SCANNER SAYS "STACK OK"
Required conditions:
1. Volume > 1.5× moving average (institutionals present)
2. Clear direction (MTF aligned or recent BOS/CHoCH)
3. No range (ATR above minimum threshold)

If any condition missing → NO TRADE.

### Rule 3: PROGRESSIVE PYRAMIDING
- Bar 1: initial positions (e.g. 30% of max)
- +N pts in your direction → add another portion
- +2N pts → add another
- +3N pts → final addition to reach max stack
- NEVER add if price moves AGAINST you

### Rule 4: GLOBAL STOP LOSS
- Initial SL applies to ALL positions in the stack
- Define max SL distance in points (per instrument)
- If hit → CLOSE ALL positions in stack
- Loss capped to a known % of account

### Rule 5: TIERED TAKE PROFIT
- TP1: +N pts → close 50% of positions (lock profit, eliminate loss)
- TP2: +2N pts → close 30%
- TP3: +3N pts → close remaining 20%
- NEVER move SL to breakeven before TP1 hit (ICT retrace)

### Rule 6: SESSION TIMING
Trade only during active institutional sessions:
- London: <your local equivalent of 07:00-11:00 UTC>
- NY: <your local equivalent of 12:30-16:00 UTC>
- LN/NY overlap: best window
- Avoid Asia for stacking (range = trap)

### Worked example
Customize numbers for your account, instrument, and risk tolerance.
The math: max-loss-points × number-of-positions × point-value = your max $ risk.
Make sure this stays ≤ your tolerable per-trade drawdown.
