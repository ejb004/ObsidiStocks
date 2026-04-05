import {
    App,
    ItemView,
    MarkdownView,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    WorkspaceLeaf,
    requestUrl,
} from 'obsidian';

const VIEW_TYPE_STOCKS  = 'obsidistocks-view';
const YAHOO_CHART       = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_SEARCH      = 'https://query1.finance.yahoo.com/v1/finance/search?q=';
const GUMROAD_VERIFY    = 'https://api.gumroad.com/v2/licenses/verify';
const GUMROAD_PRODUCT   = 'STZoAVx8UYg8HuHvErHgLA=='; // Gumroad product ID
const UA                = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const FREE_LIMIT        = 5;

type SparkRange = '1h' | '1d' | '7d' | '1mo' | '3mo' | '1y';
const SPARK_RANGES: { label: string; value: SparkRange; yahooRange: string; interval: string }[] = [
    { label: '1H', value: '1h',  yahooRange: '5d',  interval: '5m'  },
    { label: '1D', value: '1d',  yahooRange: '1d',  interval: '5m'  },
    { label: '1W', value: '7d',  yahooRange: '5d',  interval: '30m' },
    { label: '1M', value: '1mo', yahooRange: '1mo', interval: '90m' },
    { label: '3M', value: '3mo', yahooRange: '3mo', interval: '1d'  },
    { label: '1Y', value: '1y',  yahooRange: '1y',  interval: '1d'  },
];

interface Alert    { above: boolean; price: number; triggered: boolean; }
interface WatchItem { ticker: string; label: string; note: string; alerts: Alert[]; }
interface Quote {
    symbol: string; name: string; price: number; prevClose: number;
    change: number; changePct: number; currency: string; closes: number[];
    timestamps: number[];
    dayHigh: number; dayLow: number; fiftyTwoHigh: number; fiftyTwoLow: number;
    volume: number; marketState: string; prePrice: number; postPrice: number;
    news: { title: string; link: string; publisher: string }[];
}
interface Settings {
    watchlist: WatchItem[]; refreshMins: number; sparkRange: SparkRange; licenceKey: string; licenceValid: boolean;
}
const DEFAULTS: Settings = { watchlist: [], refreshMins: 5, sparkRange: '7d', licenceKey: '', licenceValid: false };

async function sha256hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const DEV_HASH = '121e98bc3c2d436b74938a3824ece3f193f0681fc9c492eeced9a1c66a1ede06';

async function verifyLicenceKey(key: string): Promise<boolean> {
    if (!key.trim()) return false;
    if (await sha256hex(key.trim()) === DEV_HASH) return true;
    try {
        const body = `product_id=${encodeURIComponent(GUMROAD_PRODUCT)}&license_key=${encodeURIComponent(key.trim())}&increment_uses_count=false`;
        const res  = await requestUrl({ url: GUMROAD_VERIFY, method: 'POST', contentType: 'application/x-www-form-urlencoded', body, headers: { 'User-Agent': UA } });
        return res.json?.success === true;
    } catch { return false; }
}

function currencySymbol(ccy: string): string {
    if (ccy === 'GBP') return '\u00a3';
    if (ccy === 'GBp' || ccy === 'GBX') return 'p';
    if (ccy === 'USD') return '$';
    if (ccy === 'EUR') return '\u20ac';
    return ccy + '\u00a0';
}

function formatPrice(price: number, ccy: string): string {
    const sym = currencySymbol(ccy);
    if (price >= 10000) return sym + price.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (price >= 1000)  return sym + price.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sym + price.toFixed(2);
}

function formatChange(change: number, pct: number, ccy: string): string {
    const sym  = currencySymbol(ccy);
    const sign = change >= 0 ? '+' : '\u2212';
    const abs  = Math.abs(change);
    const absp = Math.abs(pct);
    const ps   = abs >= 1000
        ? abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : abs.toFixed(2);
    return `${sign}${sym}${ps}  (${sign}${absp.toFixed(2)}%)`;
}

// Returns 0–1 intensity based on magnitude of move
function changeMagnitude(absPct: number): number {
    // 0–0.5% = faint, 0.5–2% = medium, 2–5% = vivid, 5%+ = max
    if (absPct >= 5)   return 1;
    if (absPct >= 2)   return 0.6 + (absPct - 2) / 3 * 0.4;
    if (absPct >= 0.5) return 0.3 + (absPct - 0.5) / 1.5 * 0.3;
    return 0.15 + (absPct / 0.5) * 0.15;
}

function resolveMarketState(state: string, ticker: string): string {
    // Yahoo sometimes returns CLOSED for 24/7 assets — override by ticker pattern
    const t = ticker.toUpperCase();
    const is24_7 = t.endsWith('-USD') || t.endsWith('-GBP') || t.endsWith('-EUR')
        || t.endsWith('=X') || t.includes('BTC') || t.includes('ETH')
        || t.includes('XRP') || t.includes('SOL') || t.includes('DOGE');
    if (is24_7) return 'REGULAR';
    // Treat OPEN (some regions) same as REGULAR
    if (state === 'OPEN' || state === 'REGULAR') return 'REGULAR';
    return state; // PRE | POST | CLOSED
}

function marketStateDot(s: string): string {
    if (s === 'REGULAR') return '●'; // solid — open
    if (s === 'PRE' || s === 'POST') return '◐'; // half — extended
    return '○'; // hollow — closed
}
function marketStateLabel(s: string): string {
    if (s === 'PRE')    return 'Pre-market';
    if (s === 'POST')   return 'After-hours';
    if (s === 'CLOSED') return 'Market closed';
    return 'Market open';
}
function marketStateCls(s: string): string {
    if (s === 'REGULAR') return 'st-badge-open';
    if (s === 'PRE' || s === 'POST') return 'st-badge-ext';
    return 'st-badge-closed';
}

// Build candidate URLs to try in order for a given range.
type ValidPair = { c: number; t: number };
type PostProcess = (pairs: ValidPair[]) => ValidPair[];

function candidateURLs(ticker: string, range: SparkRange): { url: string; post?: PostProcess }[] {
    const enc  = encodeURIComponent(ticker);
    const base = YAHOO_CHART + enc;
    const now  = Math.floor(Date.now() / 1000);
    const lastN = (n: number): PostProcess => ps => ps.slice(-n);
    const lastSessionDay: PostProcess = (ps) => {
        if (ps.length === 0) return ps;
        const lastDay  = new Date(ps[ps.length - 1].t * 1000).toDateString();
        const filtered = ps.filter(p => new Date(p.t * 1000).toDateString() === lastDay);
        return filtered.length >= 2 ? filtered : ps.slice(-78);
    };

    if (range === '1h') return [
        { url: `${base}?interval=2m&period1=${now - 3600}&period2=${now}&includePrePost=true` },
        { url: `${base}?interval=2m&range=5d&includePrePost=true`,  post: lastN(30) },
        { url: `${base}?interval=5m&period1=${now - 3600}&period2=${now}&includePrePost=true` },
        { url: `${base}?interval=5m&range=5d&includePrePost=true`,  post: lastN(12) },
        { url: `${base}?interval=15m&range=5d&includePrePost=true`, post: lastN(4)  },
    ];
    if (range === '1d') return [
        { url: `${base}?interval=5m&range=1d&includePrePost=true` },
        { url: `${base}?interval=5m&range=5d&includePrePost=true`,  post: lastSessionDay },
        { url: `${base}?interval=15m&range=1d&includePrePost=true` },
        { url: `${base}?interval=15m&range=5d&includePrePost=true`, post: lastSessionDay },
        { url: `${base}?interval=30m&range=5d&includePrePost=true`, post: lastSessionDay },
    ];
    if (range === '7d') return [
        { url: `${base}?interval=30m&range=5d&includePrePost=true` },
        { url: `${base}?interval=1h&range=5d&includePrePost=true`  },
    ];
    if (range === '1mo') return [
        { url: `${base}?interval=90m&range=1mo&includePrePost=true` },
        { url: `${base}?interval=1d&range=1mo&includePrePost=true`  },
    ];
    if (range === '3mo') return [
        { url: `${base}?interval=1d&range=3mo&includePrePost=true` },
        { url: `${base}?interval=1wk&range=3mo&includePrePost=true` },
    ];
    return [
        { url: `${base}?interval=1d&range=1y&includePrePost=true` },
        { url: `${base}?interval=1wk&range=1y&includePrePost=true` },
    ];
}

async function fetchQuote(ticker: string, range: SparkRange, withNews: boolean): Promise<Quote | null> {
    try {
        const candidates = candidateURLs(ticker, range);
        let meta: any = null;
        let closes: number[] = [];
        let timestamps: number[] = [];

        for (const { url, post } of candidates) {
            try {
                const res    = await requestUrl({ url, headers: { 'User-Agent': UA } });
                const result = res.json?.chart?.result?.[0];
                if (!result) continue;
                meta = result.meta;
                const rawCloses     = (result.indicators?.quote?.[0]?.close ?? []) as (number | null)[];
                const rawTimestamps = (result.timestamp ?? []) as number[];
                let pairs: ValidPair[] = rawCloses
                    .map((c, i) => ({ c: c as number, t: rawTimestamps[i] ?? 0 }))
                    .filter(p => p.c != null && isFinite(p.c) && p.c > 0);
                if (post) pairs = post(pairs);
                if (pairs.length >= 2) {
                    closes     = pairs.map(p => p.c);
                    timestamps = pairs.map(p => p.t);
                    break; // success — stop trying
                }
                // meta found but no closes — keep meta, try next for chart data
            } catch { /* try next candidate */ }
        }

        if (!meta) return null; // all candidates failed entirely

        const price     = meta.regularMarketPrice ?? 0;
        const prevClose = meta.chartPreviousClose ?? 0;
        const change    = price - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
        let news: Quote['news'] = [];
        if (withNews) {
            try {
                const nr = await requestUrl({ url: `${YAHOO_SEARCH}${encodeURIComponent(ticker)}&newsCount=4&quotesCount=0`, headers: { 'User-Agent': UA } });
                news = (nr.json?.news ?? []).slice(0, 4).map((n: any) => ({ title: n.title, link: n.link, publisher: n.publisher }));
            } catch { /* bonus feature */ }
        }
        return {
            symbol: ticker, name: meta.shortName ?? meta.longName ?? ticker,
            price, prevClose, change, changePct, currency: meta.currency ?? 'USD', closes, timestamps,
            dayHigh: meta.regularMarketDayHigh ?? 0, dayLow: meta.regularMarketDayLow ?? 0,
            fiftyTwoHigh: meta.fiftyTwoWeekHigh ?? 0, fiftyTwoLow: meta.fiftyTwoWeekLow ?? 0,
            volume: meta.regularMarketVolume ?? 0,
            marketState: resolveMarketState(meta.marketState ?? 'CLOSED', ticker),
            prePrice: meta.preMarketPrice ?? 0, postPrice: meta.postMarketPrice ?? 0, news,
        };
    } catch (e) { console.error(`[ObsidiStocks] fetch failed for ${ticker}:`, e); return null; }
}

async function fetchAll(items: WatchItem[], range: SparkRange, pro: boolean): Promise<Map<string, Quote>> {
    const map = new Map<string, Quote>();
    const res = await Promise.all(items.map(i => fetchQuote(i.ticker, range, pro)));
    res.forEach((q, i) => { if (q) map.set(items[i].ticker, q); });
    return map;
}

function sparklineSVG(closes: number[], positive: boolean, W = 64, H = 26): string {
    if (closes.length < 2) return '';
    const P = 2;
    const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
    const pts = closes.map((c, i) => {
        const x = P + (i / (closes.length - 1)) * (W - P * 2);
        const y = H - P - ((c - min) / range) * (H - P * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const col = positive ? 'var(--color-green, #30d158)' : 'var(--color-red, #ff453a)';
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function buildInteractiveChart(container: HTMLElement, closes: number[], timestamps: number[], positive: boolean, currency: string) {
    if (closes.length < 2) {
        container.createDiv({ cls: 'st-ichart-nodata', text: 'No chart data available for this range' });
        return;
    }
    const W = 300, H = 130;
    const PL = 44, PR = 6, PT = 6, PB = 18; // left pad for Y labels, bottom pad for X labels
    const chartW = W - PL - PR, chartH = H - PT - PB;
    const min = Math.min(...closes), max = Math.max(...closes), dr = max - min || 1;
    const col = positive ? 'var(--color-green, #30d158)' : 'var(--color-red, #ff453a)';
    const toX = (i: number) => PL + (i / (closes.length - 1)) * chartW;
    const toY = (c: number) => PT + chartH - ((c - min) / dr) * chartH;
    const xs = closes.map((_, i) => toX(i));
    const ys = closes.map(c => toY(c));
    const pts = closes.map((_, i) => `${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const areaBot = (PT + chartH).toFixed(1);
    const areaPts = `${PL.toFixed(1)},${areaBot} ${pts} ${(PL + chartW).toFixed(1)},${areaBot}`;

    // Y-axis: 3 horizontal gridlines at 0%, 50%, 100%
    const symFn = currencySymbol(currency);
    const yLevels = [
        { frac: 1,   val: max },
        { frac: 0.5, val: (min + max) / 2 },
        { frac: 0,   val: min },
    ];
    const gridLines = yLevels.map(({ frac, val }) => {
        const y = (PT + chartH - frac * chartH).toFixed(1);
        const lbl = val >= 10000
            ? symFn + (val / 1000).toFixed(1) + 'k'
            : symFn + val.toFixed(val >= 100 ? 0 : 2);
        return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="0.5"/>
                <text x="${(PL - 3).toFixed(1)}" y="${y}" dy="0.35em" text-anchor="end" fill="var(--text-faint)" font-size="8">${lbl}</text>`;
    }).join('');

    // X-axis: ~4 time labels spread across the range
    const xCount = 4;
    const xLabels = Array.from({ length: xCount }, (_, i) => {
        const idx = Math.round(i / (xCount - 1) * (closes.length - 1));
        const x = toX(idx).toFixed(1);
        const y = (H - 3).toFixed(1);
        let lbl = '';
        if (timestamps[idx]) {
            const d = new Date(timestamps[idx] * 1000);
            lbl = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            // For longer ranges show date instead
            if (timestamps[closes.length - 1] - timestamps[0] > 86400) {
                lbl = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
            }
        }
        const anchor = i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="var(--text-faint)" font-size="8">${lbl}</text>`;
    }).join('');

    const wrap = container.createDiv({ cls: 'st-ichart-wrap' });
    wrap.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto" xmlns="http://www.w3.org/2000/svg">
  ${gridLines}
  ${xLabels}
  <polygon points="${areaPts}" fill="${col}" opacity="0.08"/>
  <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <line class="st-ichart-vline" x1="0" y1="${PT}" x2="0" y2="${PT + chartH}" stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="3,2" opacity="0"/>
  <circle class="st-ichart-dot" r="3.5" cx="0" cy="0" fill="${col}" stroke="var(--background-primary)" stroke-width="2" opacity="0"/>
</svg>
<div class="st-ichart-overlay" style="left:${PL}px;right:${PR}px;top:${PT}px;bottom:${PB}px;"></div>
<div class="st-ichart-tip"></div>`;

    const vline   = wrap.querySelector('.st-ichart-vline')   as SVGLineElement;
    const dot     = wrap.querySelector('.st-ichart-dot')     as SVGCircleElement;
    const tip     = wrap.querySelector('.st-ichart-tip')     as HTMLDivElement;
    const overlay = wrap.querySelector('.st-ichart-overlay') as HTMLDivElement;

    overlay.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = overlay.getBoundingClientRect();
        const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const idx  = Math.min(Math.round(relX * (closes.length - 1)), closes.length - 1);
        const svgX = xs[idx].toFixed(1);
        const svgY = ys[idx].toFixed(1);

        vline.setAttribute('x1', svgX); vline.setAttribute('x2', svgX); vline.setAttribute('opacity', '1');
        dot.setAttribute('cx', svgX); dot.setAttribute('cy', svgY); dot.setAttribute('opacity', '1');

        let label = formatPrice(closes[idx], currency);
        if (timestamps[idx]) {
            const d = new Date(timestamps[idx] * 1000);
            label += '\u2002' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        }
        tip.textContent = label;
        tip.style.opacity = '1';
        // Position relative to wrap; offsetX is cursor position within the chart area + left padding
        const wrapRect = wrap.getBoundingClientRect();
        const cursorInWrap = e.clientX - wrapRect.left;
        if (cursorInWrap > wrapRect.width * 0.6) {
            tip.style.left = 'auto';
            tip.style.right = `${wrapRect.width - cursorInWrap + 8}px`;
        } else {
            tip.style.left = `${cursorInWrap + 8}px`;
            tip.style.right = 'auto';
        }
    });
    overlay.addEventListener('mouseleave', () => {
        vline.setAttribute('opacity', '0');
        dot.setAttribute('opacity', '0');
        tip.style.opacity = '0';
    });
}

export default class ObsidiStocksPlugin extends Plugin {
    settings: Settings;
    private timer: number | null = null;

    async onload() {
        await this.loadSettings();
        this.registerView(VIEW_TYPE_STOCKS, leaf => new StocksView(leaf, this));
        this.addRibbonIcon('trending-up', 'ObsidiStocks', () => this.activateView());
        this.addCommand({ id: 'open-obsidistocks',     name: 'Open ObsidiStocks',                    callback: () => this.activateView()    });
        this.addCommand({ id: 'insert-stocks-snapshot', name: 'Insert watchlist snapshot into note', callback: () => this.insertSnapshot() });
        this.addSettingTab(new StocksSettingTab(this.app, this));
        this.activateView();
        this.scheduleRefresh();
        // silently re-verify on load (handles offline-at-install edge case)
        this.revalidateLicence();
    }

    onunload() { if (this.timer !== null) window.clearInterval(this.timer); }
    async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
    async saveSettings()  { await this.saveData(this.settings); }
    isProEnabled(): boolean { return this.settings.licenceValid; }

    async revalidateLicence() {
        if (!this.settings.licenceKey) return;
        const valid = await verifyLicenceKey(this.settings.licenceKey);
        if (valid !== this.settings.licenceValid) { this.settings.licenceValid = valid; await this.saveSettings(); }
    }

    async activateView() {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_STOCKS);
        if (existing.length > 0) { workspace.revealLeaf(existing[0]); return; }
        const leaf = workspace.getRightLeaf(false);
        if (leaf) { await leaf.setViewState({ type: VIEW_TYPE_STOCKS, active: true }); workspace.revealLeaf(leaf); }
    }

    scheduleRefresh() {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = window.setInterval(() => this.refreshViews(), Math.max(1, this.settings.refreshMins) * 60_000);
    }

    refreshViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_STOCKS).forEach(l => (l.view as StocksView).refresh());
    }

    checkAlerts(item: WatchItem, q: Quote) {
        for (const a of item.alerts) {
            if (a.triggered) continue;
            if (a.above ? q.price >= a.price : q.price <= a.price) {
                a.triggered = true;
                const name = item.label || q.name || item.ticker;
                const dir  = a.above ? 'above' : 'below';
                new Notice(`ObsidiStocks: ${name} is ${dir} ${formatPrice(a.price, q.currency)}`, 8000);
                try {
                    if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
                        new Notification('ObsidiStocks', { body: `${name} is now ${dir} ${formatPrice(a.price, q.currency)}` });
                } catch { /* ignore */ }
                this.saveSettings();
            }
        }
    }

    async insertSnapshot() {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mdView) { new Notice('Open a note first'); return; }
        new Notice('Fetching prices\u2026');
        const quotes = await fetchAll(this.settings.watchlist, this.settings.sparkRange, false);
        const lines  = [
            `## ObsidiStocks \u2014 ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
            '', '| Ticker | Name | Price | Change | Day Hi | Day Lo |',
            '| :----- | :--- | ----: | -----: | -----: | -----: |',
        ];
        for (const item of this.settings.watchlist) {
            const q = quotes.get(item.ticker);
            if (!q) { lines.push(`| ${item.ticker} | \u2014 | \u2014 | \u2014 | \u2014 | \u2014 |`); continue; }
            const s = q.changePct >= 0 ? '+' : '\u2212';
            lines.push(`| ${item.ticker} | ${q.name} | ${formatPrice(q.price, q.currency)} | ${s}${Math.abs(q.changePct).toFixed(2)}% | ${formatPrice(q.dayHigh, q.currency)} | ${formatPrice(q.dayLow, q.currency)} |`);
        }
        lines.push('');
        mdView.editor.replaceSelection(lines.join('\n'));
        new Notice('Snapshot inserted!');
    }


}

class StocksView extends ItemView {
    plugin: ObsidiStocksPlugin;
    private busy         = false;
    private expandedSet  = new Set<string>();
    private sparkRange: SparkRange;
    private cachedQuotes: Map<string, Quote> = new Map();
    private sortKey: 'none' | 'price' | 'change' | 'volume' = 'none';
    private sortDir: 'asc' | 'desc' = 'desc';
    private lastUpdated: Date | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidiStocksPlugin) {
        super(leaf);
        this.plugin     = plugin;
        this.sparkRange = plugin.settings.sparkRange;
    }

    getViewType()    { return VIEW_TYPE_STOCKS; }
    getDisplayText() { return 'ObsidiStocks'; }
    getIcon()        { return 'trending-up'; }

    async onOpen()  { await this.refresh(); }
    async onClose() {}

    async refresh() {
        if (this.busy) return;
        this.busy = true;
        try { await this.render(true); } finally { this.busy = false; }
    }

    private toggleExpand(ticker: string) {
        if (this.expandedSet.has(ticker)) {
            this.expandedSet.delete(ticker);
        } else {
            this.expandedSet.clear();
            this.expandedSet.add(ticker);
        }
        this.render(false);
    }

    private async render(fetchPrices: boolean) {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('st-view');
        const pro = this.plugin.isProEnabled();

        // Header
        const hdr = containerEl.createDiv('st-header');
        hdr.createEl('span', { text: pro ? 'ObsidiStocks Pro' : 'ObsidiStocks', cls: pro ? 'st-title st-title-pro' : 'st-title' });
        const acts = hdr.createDiv('st-actions');
        // Sort controls
        const sortDefs: { key: typeof this.sortKey; label: string }[] = [
            { key: 'price',  label: '$'  },
            { key: 'change', label: '%'  },
            { key: 'volume', label: 'V'  },
        ];
        for (const sd of sortDefs) {
            const active = this.sortKey === sd.key;
            const btn = acts.createEl('button', {
                cls: `st-btn-icon st-sort-btn${active ? ' st-sort-active' : ''}`,
                text: active ? `${sd.label}${this.sortDir === 'desc' ? '\u2193' : '\u2191'}` : sd.label,
                attr: { title: `Sort by ${sd.key}` },
            });
            btn.addEventListener('click', () => {
                if (this.sortKey === sd.key) {
                    this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
                } else {
                    this.sortKey = sd.key;
                    this.sortDir = 'desc';
                }
                this.render(false);
            });
        }
        if (this.sortKey !== 'none') {
            const clr = acts.createEl('button', { cls: 'st-btn-icon st-sort-clear', text: '\u00d7', attr: { title: 'Clear sort' } });
            clr.addEventListener('click', () => { this.sortKey = 'none'; this.render(false); });
        }
        acts.createEl('span', { cls: 'st-actions-divider' });
        acts.createEl('button', { cls: 'st-btn-icon', text: '+', attr: { title: 'Add ticker' } })
            .addEventListener('click', () => new AddTickerModal(this.app, this.plugin, () => this.refresh()).open());
        acts.createEl('button', { cls: 'st-btn-icon', text: '\u21bb', attr: { title: 'Refresh' } })
            .addEventListener('click', () => this.refresh());

        const { watchlist } = this.plugin.settings;

        if (watchlist.length === 0) {
            const empty = containerEl.createDiv('st-empty');
            empty.createEl('p', { text: 'Watchlist is empty.' });
            empty.createEl('button', { text: '+ Add a ticker', cls: 'st-add-first' })
                 .addEventListener('click', () => new AddTickerModal(this.app, this.plugin, () => this.refresh()).open());
            return;
        }

        // Sparkline range pills (Pro)
        if (pro) {
            const pills = containerEl.createDiv('st-pills');
            for (const r of SPARK_RANGES) {
                const pill = pills.createEl('button', { text: r.label, cls: `st-pill${this.sparkRange === r.value ? ' st-pill-active' : ''}` });
                pill.addEventListener('click', async () => {
                    this.sparkRange = r.value;
                    this.plugin.settings.sparkRange = r.value;
                    await this.plugin.saveSettings();
                    await this.render(true);
                });
            }
        }

        let quotes: Map<string, Quote>;
        if (fetchPrices) {
            const loading = containerEl.createDiv('st-loading');
            loading.setText('Fetching prices\u2026');
            quotes = await fetchAll(watchlist, this.sparkRange, pro);
            this.cachedQuotes = quotes;
            this.lastUpdated  = new Date();
            loading.remove();
        } else {
            quotes = this.cachedQuotes;
        }

        for (const item of watchlist) {
            const q = quotes.get(item.ticker);
            if (q && item.alerts?.length) this.plugin.checkAlerts(item, q);
        }

        let visible = !pro && watchlist.length > FREE_LIMIT ? watchlist.slice(0, FREE_LIMIT) : [...watchlist];
        // Apply sort (doesn't mutate saved order)
        if (this.sortKey !== 'none') {
            const dir = this.sortDir === 'desc' ? -1 : 1;
            visible.sort((a, b) => {
                const qa = quotes.get(a.ticker), qb = quotes.get(b.ticker);
                if (!qa && !qb) return 0; if (!qa) return 1; if (!qb) return -1;
                if (this.sortKey === 'price')  return dir * (qa.price    - qb.price);
                if (this.sortKey === 'change') return dir * (qa.changePct - qb.changePct);
                if (this.sortKey === 'volume') return dir * (qa.volume   - qb.volume);
                return 0;
            });
        }
        const list    = containerEl.createDiv('st-list');

        for (let vi = 0; vi < visible.length; vi++) {
            const item = visible[vi];
            const q          = quotes.get(item.ticker);
            const pos        = !q || q.changePct >= 0;
            const isExpanded = this.expandedSet.has(item.ticker);
            const wrap       = list.createDiv('st-wrap');
            wrap.setAttribute('draggable', 'true');
            wrap.dataset.ticker = item.ticker;

            const row = wrap.createDiv(`st-row${q ? (pos ? ' st-up' : ' st-down') : ''}`);
            row.style.cursor = 'pointer';

            // Drag handle
            const handle = row.createDiv('st-drag-handle');
            handle.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';

            // Left
            const left    = row.createDiv('st-left');
            const nameRow = left.createDiv('st-name-row');
            nameRow.createEl('span', { text: item.label || q?.name || item.ticker, cls: 'st-name' });
            if (q) nameRow.createEl('span', { text: marketStateDot(q.marketState), cls: `st-dot ${marketStateCls(q.marketState)}`, attr: { title: marketStateLabel(q.marketState) } });
            left.createEl('span', { text: item.ticker, cls: 'st-ticker-label' });
            // Day range bar
            if (q && q.dayHigh > 0 && q.dayLow > 0 && q.dayHigh !== q.dayLow) {
                const rangePct = Math.max(0, Math.min(1, (q.price - q.dayLow) / (q.dayHigh - q.dayLow)));
                const bar = left.createDiv('st-day-range-bar');
                bar.createDiv('st-day-range-fill').style.width = `${(rangePct * 100).toFixed(1)}%`;
            }

            // Sparkline
            const spark = row.createDiv('st-spark');
            if (q && q.closes.length >= 2) spark.innerHTML = sparklineSVG(q.closes, pos);

            // Right
            const right = row.createDiv('st-right');
            if (q) {
                right.createEl('span', { text: formatPrice(q.price, q.currency), cls: 'st-price' });
                const mag      = changeMagnitude(Math.abs(q.changePct));
                const chEl     = right.createEl('span', { text: formatChange(q.change, q.changePct, q.currency), cls: `st-change ${pos ? 'st-change-up' : 'st-change-down'}` });
                chEl.style.opacity = String(0.4 + mag * 0.6);
                const baseAlpha    = pos ? `hsla(142,65%,50%,` : `hsla(0,85%,60%,`;
                chEl.style.background = `${baseAlpha}${(mag * 0.22).toFixed(2)})`;
            } else {
                right.createEl('span', { text: '\u2014',       cls: 'st-price st-na' });
                right.createEl('span', { text: 'unavailable', cls: 'st-change st-na' });
            }

            // Hover sparkline tooltip
            if (q && q.closes.length >= 2) {
                const tip = row.createDiv('st-spark-tip');
                tip.innerHTML = sparklineSVG(q.closes, pos, 200, 56);
                tip.createEl('span', { text: `${item.label || q.name}  ${formatPrice(q.price, q.currency)}`, cls: 'st-spark-tip-label' });
            }

            // Click to expand (not on drag handle)
            row.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('.st-drag-handle')) return;
                this.toggleExpand(item.ticker);
            });

            // Expanded detail
            if (isExpanded && q) {
                const detail = wrap.createDiv('st-detail');

                // Interactive chart (Pro only)
                if (pro) {
                    buildInteractiveChart(detail, q.closes, q.timestamps, pos, q.currency);
                }

                // Stats
                const grid = detail.createDiv('st-detail-grid');
                const stat = (l: string, v: string) => {
                    const c = grid.createDiv('st-stat');
                    c.createEl('span', { text: l, cls: 'st-stat-label' });
                    c.createEl('span', { text: v, cls: 'st-stat-value' });
                };
                stat('Day range',   `${formatPrice(q.dayLow, q.currency)} \u2013 ${formatPrice(q.dayHigh, q.currency)}`);
                stat('52-wk range', `${formatPrice(q.fiftyTwoLow, q.currency)} \u2013 ${formatPrice(q.fiftyTwoHigh, q.currency)}`);
                stat('Volume',      q.volume > 0 ? q.volume.toLocaleString('en-GB') : '\u2014');
                stat('Status',      marketStateLabel(q.marketState));
                if (q.marketState === 'PRE'  && q.prePrice  > 0) stat('Pre-market', formatPrice(q.prePrice,  q.currency));
                if (q.marketState === 'POST' && q.postPrice > 0) stat('After-hrs',  formatPrice(q.postPrice, q.currency));

                // Note (Pro)
                if (pro) {
                    const nw = detail.createDiv('st-note-wrap');
                    const nd = nw.createEl('p', { text: item.note || 'Tap to add a note\u2026', cls: `st-note-text${item.note ? '' : ' st-note-placeholder'}` });
                    nd.addEventListener('click', () => {
                        nd.remove();
                        const ta = nw.createEl('textarea', { cls: 'st-note-input' });
                        ta.value = item.note ?? '';
                        ta.focus();
                        ta.addEventListener('blur', async () => { item.note = ta.value.trim(); await this.plugin.saveSettings(); this.refresh(); });
                    });
                }

                // Alerts (Pro)
                if (pro) {
                    const aw = detail.createDiv('st-alert-wrap');
                    const ah = aw.createDiv('st-alert-hdr');
                    ah.createEl('span', { text: 'Alerts', cls: 'st-section-label' });
                    ah.createEl('button', { text: '+ Alert', cls: 'st-small-btn' })
                      .addEventListener('click', () => new AlertModal(this.app, item, q, async () => { await this.plugin.saveSettings(); this.refresh(); }).open());
                    if (item.alerts?.length) {
                        for (let ai = 0; ai < item.alerts.length; ai++) {
                            const a  = item.alerts[ai];
                            const ar = aw.createDiv('st-alert-row');
                            ar.createEl('span', { text: `${a.above ? '\u25b2 Above' : '\u25bc Below'} ${formatPrice(a.price, q.currency)}${a.triggered ? ' \u2713' : ''}`, cls: `st-alert-text${a.triggered ? ' st-alert-done' : ''}` });
                            ar.createEl('button', { text: '\u00d7', cls: 'st-small-btn st-del-btn' })
                              .addEventListener('click', async () => { item.alerts.splice(ai, 1); await this.plugin.saveSettings(); this.refresh(); });
                        }
                    }
                }

                // News (Pro)
                if (pro && q.news.length > 0) {
                    const nw = detail.createDiv('st-news-wrap');
                    nw.createEl('span', { text: 'News', cls: 'st-section-label' });
                    for (const n of q.news) {
                        const a = nw.createEl('a', { cls: 'st-news-item', href: n.link, attr: { target: '_blank', rel: 'noopener noreferrer' } });
                        a.createEl('span', { text: n.title,     cls: 'st-news-title' });
                        a.createEl('span', { text: n.publisher, cls: 'st-news-pub' });
                    }
                }
            }

            // Context menu
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const menu = new (this.app as any).Menu();
                menu.addItem((mi: any) => { mi.setTitle('Insert snapshot into note'); mi.setIcon('file-text'); mi.onClick(() => this.plugin.insertSnapshot()); });
                menu.addSeparator();
                menu.addItem((mi: any) => {
                    mi.setTitle(`Remove ${item.label || item.ticker}`); mi.setIcon('trash');
                    mi.onClick(async () => { this.plugin.settings.watchlist = this.plugin.settings.watchlist.filter(w => w.ticker !== item.ticker); await this.plugin.saveSettings(); this.refresh(); });
                });
                menu.showAtMouseEvent(e);
            });

            // Drag to reorder
            wrap.addEventListener('dragstart', (e) => {
                e.dataTransfer!.effectAllowed = 'move';
                e.dataTransfer!.setData('text/plain', item.ticker);
                wrap.addClass('st-dragging');
            });
            wrap.addEventListener('dragend', () => wrap.removeClass('st-dragging'));
            wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.addClass('st-drag-over'); });
            wrap.addEventListener('dragleave', () => wrap.removeClass('st-drag-over'));
            wrap.addEventListener('drop', async (e) => {
                e.preventDefault();
                wrap.removeClass('st-drag-over');
                const fromTicker = e.dataTransfer!.getData('text/plain');
                const wl   = this.plugin.settings.watchlist;
                const fromIdx = wl.findIndex(w => w.ticker === fromTicker);
                const toIdx   = wl.findIndex(w => w.ticker === item.ticker);
                if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
                const [moved] = wl.splice(fromIdx, 1);
                wl.splice(toIdx, 0, moved);
                await this.plugin.saveSettings();
                this.render(false);
            });
        }

        // Free tier nudge — always visible when not Pro
        if (!pro) {
            const u = containerEl.createDiv('st-free-nudge');
            const txt = watchlist.length > FREE_LIMIT
                ? `Showing ${FREE_LIMIT} of ${watchlist.length} tickers. `
                : 'Free plan. ';
            u.createEl('span', { text: txt });
            const a = u.createEl('a', { text: 'Get ObsidiStocks Pro \u2192', cls: 'st-pro-link' });
            a.href = 'https://gumroad.com/l/obsidistocks-pro';
        }

        const footer = containerEl.createDiv('st-footer');
        const timeStr = this.lastUpdated
            ? `Updated ${this.lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : 'Not yet refreshed';
        footer.createEl('span', { text: timeStr, cls: 'st-time' });
    }
}

class AddTickerModal extends Modal {
    private plugin: ObsidiStocksPlugin;
    private onDone: () => void;
    constructor(app: App, plugin: ObsidiStocksPlugin, onDone: () => void) { super(app); this.plugin = plugin; this.onDone = onDone; }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Add to watchlist' });
        let ticker = '', label = '';
        new Setting(contentEl).setName('Ticker symbol')
            .setDesc('Yahoo Finance \u2014 e.g. AAPL \u00b7 BARC.L \u00b7 GC=F \u00b7 BTC-USD \u00b7 ^FTSE \u00b7 ETH-USD')
            .addText(t => t.setPlaceholder('AAPL').onChange(v => { ticker = v.toUpperCase().trim(); }));
        new Setting(contentEl).setName('Label (optional)').setDesc('Friendly name shown in the list')
            .addText(t => t.setPlaceholder('Apple').onChange(v => { label = v.trim(); }));
        new Setting(contentEl)
            .addButton(btn => btn.setButtonText('Add').setCta().onClick(async () => {
                if (!ticker) { new Notice('Enter a ticker symbol'); return; }
                if (this.plugin.settings.watchlist.find(w => w.ticker === ticker)) { new Notice(`${ticker} already in watchlist`); return; }
                if (!this.plugin.isProEnabled() && this.plugin.settings.watchlist.length >= FREE_LIMIT) {
                    new Notice(`Free plan: max ${FREE_LIMIT} tickers. Upgrade to Pro for unlimited.`); return;
                }
                this.plugin.settings.watchlist.push({ ticker, label, note: '', alerts: [] });
                await this.plugin.saveSettings(); this.close(); this.onDone();
            }))
            .addButton(btn => btn.setButtonText('Cancel').onClick(() => this.close()));
    }
    onClose() { this.contentEl.empty(); }
}

class AlertModal extends Modal {
    private item: WatchItem; private quote: Quote; private onSave: () => void;
    constructor(app: App, item: WatchItem, quote: Quote, onSave: () => void) { super(app); this.item = item; this.quote = quote; this.onSave = onSave; }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: `Alert \u2014 ${this.item.label || this.item.ticker}` });
        contentEl.createEl('p', { text: `Current: ${formatPrice(this.quote.price, this.quote.currency)}`, cls: 'st-modal-price' });
        let above = true, alertPrice = this.quote.price;
        new Setting(contentEl).setName('Direction')
            .addDropdown(d => d.addOptions({ above: '\u25b2 Rises above', below: '\u25bc Falls below' }).setValue('above').onChange(v => { above = v === 'above'; }));
        new Setting(contentEl).setName('Price')
            .addText(t => t.setPlaceholder(this.quote.price.toFixed(2)).setValue(this.quote.price.toFixed(2)).onChange(v => { alertPrice = parseFloat(v) || this.quote.price; }));
        new Setting(contentEl)
            .addButton(btn => btn.setButtonText('Set alert').setCta().onClick(async () => {
                if (!this.item.alerts) this.item.alerts = [];
                this.item.alerts.push({ above, price: alertPrice, triggered: false });
                await this.onSave(); this.close();
            }))
            .addButton(btn => btn.setButtonText('Cancel').onClick(() => this.close()));
    }
    onClose() { this.contentEl.empty(); }
}

class StocksSettingTab extends PluginSettingTab {
    plugin: ObsidiStocksPlugin;
    constructor(app: App, plugin: ObsidiStocksPlugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'ObsidiStocks' });
        new Setting(containerEl).setName('Auto-refresh (minutes)')
            .addSlider(s => s.setLimits(1, 60, 1).setValue(this.plugin.settings.refreshMins).setDynamicTooltip()
                .onChange(async v => { this.plugin.settings.refreshMins = v; await this.plugin.saveSettings(); this.plugin.scheduleRefresh(); }));
        containerEl.createEl('h3', { text: 'Watchlist' });
        new Setting(containerEl).setName('Add ticker')
            .addButton(btn => btn.setButtonText('+ Add').setCta().onClick(() => {
                new AddTickerModal(this.app, this.plugin, () => { this.display(); this.plugin.refreshViews(); }).open();
            }));
        const { watchlist } = this.plugin.settings;
        if (watchlist.length === 0) { containerEl.createEl('p', { text: 'No tickers yet.', cls: 'st-settings-empty' }); }
        else {
            for (let i = 0; i < watchlist.length; i++) {
                const item = watchlist[i];
                new Setting(containerEl).setName(item.label || item.ticker).setDesc(item.label ? item.ticker : '')
                    .addButton(btn => btn.setIcon('arrow-up').setTooltip('Move up').setDisabled(i === 0)
                        .onClick(async () => { [watchlist[i-1], watchlist[i]] = [watchlist[i], watchlist[i-1]]; await this.plugin.saveSettings(); this.display(); this.plugin.refreshViews(); }))
                    .addButton(btn => btn.setIcon('arrow-down').setTooltip('Move down').setDisabled(i === watchlist.length - 1)
                        .onClick(async () => { [watchlist[i+1], watchlist[i]] = [watchlist[i], watchlist[i+1]]; await this.plugin.saveSettings(); this.display(); this.plugin.refreshViews(); }))
                    .addButton(btn => btn.setIcon('trash').setTooltip('Remove')
                        .onClick(async () => { watchlist.splice(i, 1); await this.plugin.saveSettings(); this.display(); this.plugin.refreshViews(); }));
            }
        }
        containerEl.createEl('h3', { text: 'Pro Licence' });
        const pro = this.plugin.isProEnabled();
        let keyInput = '';
        const licSetting = new Setting(containerEl)
            .setName('Licence key')
            .setDesc(pro ? '\u2705 Pro active \u2014 thank you!' : 'Paste your Gumroad licence key and click Verify')
            .addText(t => {
                t.setPlaceholder('XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX')
                 .setValue(this.plugin.settings.licenceKey)
                 .onChange(v => { keyInput = v.trim(); });
                keyInput = this.plugin.settings.licenceKey;
            })
            .addButton(btn => {
                btn.setButtonText(pro ? 'Re-verify' : 'Verify').setCta();
                btn.onClick(async () => {
                    const key = keyInput || this.plugin.settings.licenceKey;
                    if (!key) { new Notice('Paste your licence key first'); return; }
                    btn.setButtonText('Checking\u2026').setDisabled(true);
                    this.plugin.settings.licenceKey = key;
                    const valid = await verifyLicenceKey(key);
                    this.plugin.settings.licenceValid = valid;
                    await this.plugin.saveSettings();
                    this.plugin.refreshViews();
                    if (valid) {
                        new Notice('\u2705 Pro unlocked! Thank you.');
                    } else {
                        new Notice('\u274c Key not recognised. Check it on your Gumroad receipt.');
                    }
                    this.display();
                });
            });
        if (pro) {
            const deact = containerEl.createDiv('st-licence-deact');
            deact.createEl('a', { text: 'Remove licence key', cls: 'st-deact-link' })
                 .addEventListener('click', async () => {
                     this.plugin.settings.licenceKey   = '';
                     this.plugin.settings.licenceValid = false;
                     await this.plugin.saveSettings();
                     this.plugin.refreshViews();
                     this.display();
                 });
        }
        if (!pro) {
            const cta = containerEl.createDiv('st-pro-cta');
            cta.createEl('p', { text: 'Pro includes:', cls: 'st-pro-title' });
            const ul = cta.createEl('ul');
            ['Unlimited tickers', 'Price alerts with OS notifications', 'Sparkline range \u2014 1W / 1M / 3M / 1Y', 'Latest news per ticker', 'Notes per ticker, stored in your vault', 'Pre & post-market prices'].forEach(f => ul.createEl('li', { text: f }));
            const a = cta.createEl('a', { text: 'Get Pro \u2192', cls: 'st-pro-link' });
            a.href = 'https://gumroad.com/l/obsidistocks-pro';
        }
    }
}
