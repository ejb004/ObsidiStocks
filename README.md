# ObsidiStocks

Live stock, ETF, crypto and commodity prices inside Obsidian — iOS Stocks-style minimal sidebar watchlist.

## Features

**Free**
- Live prices for up to 5 tickers (stocks, ETFs, crypto, commodities, forex)
- Colour-coded % change with magnitude scaling
- Sparkline chart per row
- Day range bar
- Market status indicator (open / pre / after-hours / closed)
- Drag to reorder watchlist
- Sort by price, change %, or volume
- Insert watchlist snapshot into a note

**Pro** — [ObsidiStocks Pro on Gumroad](https://gumroad.com/l/obsidistocks-pro)
- Unlimited tickers
- Interactive price chart with crosshair hover (1H / 1D / 1W / 1M / 3M / 1Y)
- Range pills — switch chart timeframe
- Price alerts (above / below)
- Per-ticker notes
- Recent news headlines
- Pre/after-market prices

## Installation

### From Obsidian Community Plugins
1. Open **Settings → Community plugins → Browse**
2. Search for **ObsidiStocks**
3. Install and enable

### Manual
1. Download `main.js`, `styles.css`, `manifest.json` from the [latest release](../../releases/latest)
2. Copy to `<your vault>/.obsidian/plugins/obsidistocks/`
3. Enable in **Settings → Community plugins**

## Supported tickers

Uses the Yahoo Finance API — any ticker Yahoo supports:

| Asset class | Examples |
|-------------|---------|
| US stocks | `AAPL`, `TSLA`, `NVDA` |
| UK stocks | `BARC.L`, `VOD.L` |
| ETFs | `SPY`, `QQQ`, `ISF.L` |
| Crypto | `BTC-USD`, `ETH-USD` |
| Commodities | `GC=F` (gold), `CL=F` (oil) |
| Indices | `^GSPC` (S&P 500), `^FTSE` |
| Forex | `GBPUSD=X`, `EURUSD=X` |

## Pro licence

After purchase on Gumroad you'll receive a licence key. Enter it in **Settings → ObsidiStocks → Licence key** and click **Verify**.

The plugin is open source. The Pro feature gate is verified against Gumroad's API — your key is never stored in plain text.

## License

[MIT](LICENSE)
