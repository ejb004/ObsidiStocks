var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidiStocksPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE_STOCKS = "obsidistocks-view";
var YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
var YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search?q=";
var GUMROAD_VERIFY = "https://api.gumroad.com/v2/licenses/verify";
var GUMROAD_PRODUCT = "STZoAVx8UYg8HuHvErHgLA==";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
var FREE_LIMIT = 5;
var SPARK_RANGES = [
  { label: "1H", value: "1h", yahooRange: "5d", interval: "5m" },
  { label: "1D", value: "1d", yahooRange: "1d", interval: "5m" },
  { label: "1W", value: "7d", yahooRange: "5d", interval: "30m" },
  { label: "1M", value: "1mo", yahooRange: "1mo", interval: "90m" },
  { label: "3M", value: "3mo", yahooRange: "3mo", interval: "1d" },
  { label: "1Y", value: "1y", yahooRange: "1y", interval: "1d" }
];
var DEFAULTS = { watchlist: [], refreshMins: 5, sparkRange: "7d", licenceKey: "", licenceValid: false };
async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var DEV_HASH = "121e98bc3c2d436b74938a3824ece3f193f0681fc9c492eeced9a1c66a1ede06";
async function verifyLicenceKey(key) {
  var _a;
  if (!key.trim())
    return false;
  if (await sha256hex(key.trim()) === DEV_HASH)
    return true;
  try {
    const body = `product_id=${encodeURIComponent(GUMROAD_PRODUCT)}&license_key=${encodeURIComponent(key.trim())}&increment_uses_count=false`;
    const res = await (0, import_obsidian.requestUrl)({ url: GUMROAD_VERIFY, method: "POST", contentType: "application/x-www-form-urlencoded", body, headers: { "User-Agent": UA } });
    return ((_a = res.json) == null ? void 0 : _a.success) === true;
  } catch (e) {
    return false;
  }
}
function currencySymbol(ccy) {
  if (ccy === "GBP")
    return "\xA3";
  if (ccy === "GBp" || ccy === "GBX")
    return "p";
  if (ccy === "USD")
    return "$";
  if (ccy === "EUR")
    return "\u20AC";
  return ccy + "\xA0";
}
function formatPrice(price, ccy) {
  const sym = currencySymbol(ccy);
  if (price >= 1e4)
    return sym + price.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (price >= 1e3)
    return sym + price.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym + price.toFixed(2);
}
function formatChange(change, pct, ccy) {
  const sym = currencySymbol(ccy);
  const sign = change >= 0 ? "+" : "\u2212";
  const abs = Math.abs(change);
  const absp = Math.abs(pct);
  const ps = abs >= 1e3 ? abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return `${sign}${sym}${ps}  (${sign}${absp.toFixed(2)}%)`;
}
function changeMagnitude(absPct) {
  if (absPct >= 5)
    return 1;
  if (absPct >= 2)
    return 0.6 + (absPct - 2) / 3 * 0.4;
  if (absPct >= 0.5)
    return 0.3 + (absPct - 0.5) / 1.5 * 0.3;
  return 0.15 + absPct / 0.5 * 0.15;
}
function resolveMarketState(state, ticker) {
  const t = ticker.toUpperCase();
  const is24_7 = t.endsWith("-USD") || t.endsWith("-GBP") || t.endsWith("-EUR") || t.endsWith("=X") || t.includes("BTC") || t.includes("ETH") || t.includes("XRP") || t.includes("SOL") || t.includes("DOGE");
  if (is24_7)
    return "REGULAR";
  if (state === "OPEN" || state === "REGULAR")
    return "REGULAR";
  return state;
}
function marketStateDot(s) {
  if (s === "REGULAR")
    return "\u25CF";
  if (s === "PRE" || s === "POST")
    return "\u25D0";
  return "\u25CB";
}
function marketStateLabel(s) {
  if (s === "PRE")
    return "Pre-market";
  if (s === "POST")
    return "After-hours";
  if (s === "CLOSED")
    return "Market closed";
  return "Market open";
}
function marketStateCls(s) {
  if (s === "REGULAR")
    return "st-badge-open";
  if (s === "PRE" || s === "POST")
    return "st-badge-ext";
  return "st-badge-closed";
}
function candidateURLs(ticker, range) {
  const enc = encodeURIComponent(ticker);
  const base = YAHOO_CHART + enc;
  const now = Math.floor(Date.now() / 1e3);
  const lastN = (n) => (ps) => ps.slice(-n);
  const lastSessionDay = (ps) => {
    if (ps.length === 0)
      return ps;
    const lastDay = new Date(ps[ps.length - 1].t * 1e3).toDateString();
    const filtered = ps.filter((p) => new Date(p.t * 1e3).toDateString() === lastDay);
    return filtered.length >= 2 ? filtered : ps.slice(-78);
  };
  if (range === "1h")
    return [
      { url: `${base}?interval=2m&period1=${now - 3600}&period2=${now}&includePrePost=true` },
      { url: `${base}?interval=2m&range=5d&includePrePost=true`, post: lastN(30) },
      { url: `${base}?interval=5m&period1=${now - 3600}&period2=${now}&includePrePost=true` },
      { url: `${base}?interval=5m&range=5d&includePrePost=true`, post: lastN(12) },
      { url: `${base}?interval=15m&range=5d&includePrePost=true`, post: lastN(4) }
    ];
  if (range === "1d")
    return [
      { url: `${base}?interval=5m&range=1d&includePrePost=true` },
      { url: `${base}?interval=5m&range=5d&includePrePost=true`, post: lastSessionDay },
      { url: `${base}?interval=15m&range=1d&includePrePost=true` },
      { url: `${base}?interval=15m&range=5d&includePrePost=true`, post: lastSessionDay },
      { url: `${base}?interval=30m&range=5d&includePrePost=true`, post: lastSessionDay }
    ];
  if (range === "7d")
    return [
      { url: `${base}?interval=30m&range=5d&includePrePost=true` },
      { url: `${base}?interval=1h&range=5d&includePrePost=true` }
    ];
  if (range === "1mo")
    return [
      { url: `${base}?interval=90m&range=1mo&includePrePost=true` },
      { url: `${base}?interval=1d&range=1mo&includePrePost=true` }
    ];
  if (range === "3mo")
    return [
      { url: `${base}?interval=1d&range=3mo&includePrePost=true` },
      { url: `${base}?interval=1wk&range=3mo&includePrePost=true` }
    ];
  return [
    { url: `${base}?interval=1d&range=1y&includePrePost=true` },
    { url: `${base}?interval=1wk&range=1y&includePrePost=true` }
  ];
}
async function fetchQuote(ticker, range, withNews) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w;
  try {
    const candidates = candidateURLs(ticker, range);
    let meta = null;
    let closes = [];
    let timestamps = [];
    for (const { url, post } of candidates) {
      try {
        const res = await (0, import_obsidian.requestUrl)({ url, headers: { "User-Agent": UA } });
        const result = (_c = (_b = (_a = res.json) == null ? void 0 : _a.chart) == null ? void 0 : _b.result) == null ? void 0 : _c[0];
        if (!result)
          continue;
        meta = result.meta;
        const rawCloses = (_g = (_f = (_e = (_d = result.indicators) == null ? void 0 : _d.quote) == null ? void 0 : _e[0]) == null ? void 0 : _f.close) != null ? _g : [];
        const rawTimestamps = (_h = result.timestamp) != null ? _h : [];
        let pairs = rawCloses.map((c, i) => {
          var _a2;
          return { c, t: (_a2 = rawTimestamps[i]) != null ? _a2 : 0 };
        }).filter((p) => p.c != null && isFinite(p.c) && p.c > 0);
        if (post)
          pairs = post(pairs);
        if (pairs.length >= 2) {
          closes = pairs.map((p) => p.c);
          timestamps = pairs.map((p) => p.t);
          break;
        }
      } catch (e) {
      }
    }
    if (!meta)
      return null;
    const price = (_i = meta.regularMarketPrice) != null ? _i : 0;
    const prevClose = (_j = meta.chartPreviousClose) != null ? _j : 0;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? change / prevClose * 100 : 0;
    let news = [];
    if (withNews) {
      try {
        const nr = await (0, import_obsidian.requestUrl)({ url: `${YAHOO_SEARCH}${encodeURIComponent(ticker)}&newsCount=4&quotesCount=0`, headers: { "User-Agent": UA } });
        news = ((_l = (_k = nr.json) == null ? void 0 : _k.news) != null ? _l : []).slice(0, 4).map((n) => {
          var _a2, _b2, _c2;
          return { title: (_a2 = n.title) != null ? _a2 : "", link: (_b2 = n.link) != null ? _b2 : "", publisher: (_c2 = n.publisher) != null ? _c2 : "" };
        });
      } catch (e) {
      }
    }
    return {
      symbol: ticker,
      name: (_n = (_m = meta.shortName) != null ? _m : meta.longName) != null ? _n : ticker,
      price,
      prevClose,
      change,
      changePct,
      currency: (_o = meta.currency) != null ? _o : "USD",
      closes,
      timestamps,
      dayHigh: (_p = meta.regularMarketDayHigh) != null ? _p : 0,
      dayLow: (_q = meta.regularMarketDayLow) != null ? _q : 0,
      fiftyTwoHigh: (_r = meta.fiftyTwoWeekHigh) != null ? _r : 0,
      fiftyTwoLow: (_s = meta.fiftyTwoWeekLow) != null ? _s : 0,
      volume: (_t = meta.regularMarketVolume) != null ? _t : 0,
      marketState: resolveMarketState((_u = meta.marketState) != null ? _u : "CLOSED", ticker),
      prePrice: (_v = meta.preMarketPrice) != null ? _v : 0,
      postPrice: (_w = meta.postMarketPrice) != null ? _w : 0,
      news
    };
  } catch (e) {
    console.error(`[ObsidiStocks] fetch failed for ${ticker}:`, e);
    return null;
  }
}
async function fetchAll(items, range, pro) {
  const map = /* @__PURE__ */ new Map();
  const res = await Promise.all(items.map((i) => fetchQuote(i.ticker, range, pro)));
  res.forEach((q, i) => {
    if (q)
      map.set(items[i].ticker, q);
  });
  return map;
}
function appendSparklineSVG(container, closes, positive, W = 64, H = 26) {
  if (closes.length < 2)
    return;
  const svgNS = "http://www.w3.org/2000/svg";
  const P = 2;
  const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
  const pts = closes.map((c, i) => {
    const x = P + i / (closes.length - 1) * (W - P * 2);
    const y = H - P - (c - min) / range * (H - P * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const col = positive ? "var(--color-green, #30d158)" : "var(--color-red, #ff453a)";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", pts.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", col);
  polyline.setAttribute("stroke-width", "1.8");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("stroke-linecap", "round");
  svg.appendChild(polyline);
  container.appendChild(svg);
}
function buildInteractiveChart(container, closes, timestamps, positive, currency) {
  if (closes.length < 2) {
    container.createDiv({ cls: "st-ichart-nodata", text: "No chart data available for this range" });
    return;
  }
  const W = 300, H = 130;
  const PL = 44, PR = 6, PT = 6, PB = 18;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const min = Math.min(...closes), max = Math.max(...closes), dr = max - min || 1;
  const col = positive ? "var(--color-green, #30d158)" : "var(--color-red, #ff453a)";
  const toX = (i) => PL + i / (closes.length - 1) * chartW;
  const toY = (c) => PT + chartH - (c - min) / dr * chartH;
  const xs = closes.map((_, i) => toX(i));
  const ys = closes.map((c) => toY(c));
  const pts = closes.map((_, i) => `${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const areaBot = (PT + chartH).toFixed(1);
  const areaPts = `${PL.toFixed(1)},${areaBot} ${pts} ${(PL + chartW).toFixed(1)},${areaBot}`;
  const symFn = currencySymbol(currency);
  const yLevels = [
    { frac: 1, val: max },
    { frac: 0.5, val: (min + max) / 2 },
    { frac: 0, val: min }
  ];
  const wrap = container.createDiv({ cls: "st-ichart-wrap" });
  const svgNS = "http://www.w3.org/2000/svg";
  const mkSvgEl = (tag, attrs) => {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs))
      el.setAttribute(k, v);
    return el;
  };
  const svg = mkSvgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "st-ichart-svg" });
  for (const { frac, val } of yLevels) {
    const y = (PT + chartH - frac * chartH).toFixed(1);
    const lbl = val >= 1e4 ? symFn + (val / 1e3).toFixed(1) + "k" : symFn + val.toFixed(val >= 100 ? 0 : 2);
    svg.appendChild(mkSvgEl("line", {
      x1: String(PL),
      y1: y,
      x2: String(W - PR),
      y2: y,
      stroke: "var(--background-modifier-border)",
      "stroke-width": "0.5"
    }));
    const yText = mkSvgEl("text", {
      x: (PL - 3).toFixed(1),
      y,
      dy: "0.35em",
      "text-anchor": "end",
      fill: "var(--text-faint)",
      "font-size": "8"
    });
    yText.textContent = lbl;
    svg.appendChild(yText);
  }
  svg.appendChild(mkSvgEl("polygon", { points: areaPts, fill: col, opacity: "0.08" }));
  svg.appendChild(mkSvgEl("polyline", {
    points: pts,
    fill: "none",
    stroke: col,
    "stroke-width": "2",
    "stroke-linejoin": "round",
    "stroke-linecap": "round"
  }));
  const vline = mkSvgEl("line", {
    class: "st-ichart-vline",
    x1: "0",
    y1: String(PT),
    x2: "0",
    y2: String(PT + chartH),
    stroke: "var(--text-faint)",
    "stroke-width": "1",
    "stroke-dasharray": "3,2",
    opacity: "0"
  });
  svg.appendChild(vline);
  const dot = mkSvgEl("circle", {
    class: "st-ichart-dot",
    r: "3.5",
    cx: "0",
    cy: "0",
    fill: col,
    stroke: "var(--background-primary)",
    "stroke-width": "2",
    opacity: "0"
  });
  svg.appendChild(dot);
  wrap.appendChild(svg);
  const overlay = wrap.createDiv({ cls: "st-ichart-overlay" });
  const tip = wrap.createDiv({ cls: "st-ichart-tip" });
  overlay.addEventListener("mousemove", (e) => {
    const rect = overlay.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.min(Math.round(relX * (closes.length - 1)), closes.length - 1);
    const svgX = xs[idx].toFixed(1);
    const svgY = ys[idx].toFixed(1);
    vline.setAttribute("x1", svgX);
    vline.setAttribute("x2", svgX);
    vline.setAttribute("opacity", "1");
    dot.setAttribute("cx", svgX);
    dot.setAttribute("cy", svgY);
    dot.setAttribute("opacity", "1");
    let label = formatPrice(closes[idx], currency);
    if (timestamps[idx]) {
      const d = new Date(timestamps[idx] * 1e3);
      label += "\u2002" + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }
    tip.textContent = label;
    tip.setCssProps({ "--st-tip-opacity": "1" });
    const wrapRect = wrap.getBoundingClientRect();
    const cursorInWrap = e.clientX - wrapRect.left;
    if (cursorInWrap > wrapRect.width * 0.6) {
      tip.setCssProps({ "--st-tip-left": "auto", "--st-tip-right": `${wrapRect.width - cursorInWrap + 8}px` });
    } else {
      tip.setCssProps({ "--st-tip-left": `${cursorInWrap + 8}px`, "--st-tip-right": "auto" });
    }
  });
  overlay.addEventListener("mouseleave", () => {
    vline.setAttribute("opacity", "0");
    dot.setAttribute("opacity", "0");
    tip.setCssProps({ "--st-tip-opacity": "0" });
  });
}
var ObsidiStocksPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.timer = null;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_STOCKS, (leaf) => new StocksView(leaf, this));
    this.addRibbonIcon("trending-up", "Obsidistocks", () => {
      void this.activateView();
    });
    this.addCommand({ id: "open-watchlist", name: "Open watchlist", callback: () => {
      void this.activateView();
    } });
    this.addCommand({ id: "insert-snapshot", name: "Insert watchlist snapshot into note", callback: () => {
      void this.insertSnapshot();
    } });
    this.addSettingTab(new StocksSettingTab(this.app, this));
    void this.activateView();
    this.scheduleRefresh();
    void this.revalidateLicence();
  }
  onunload() {
    if (this.timer !== null)
      window.clearInterval(this.timer);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  isProEnabled() {
    return this.settings.licenceValid;
  }
  async revalidateLicence() {
    if (!this.settings.licenceKey)
      return;
    const valid = await verifyLicenceKey(this.settings.licenceKey);
    if (valid !== this.settings.licenceValid) {
      this.settings.licenceValid = valid;
      await this.saveSettings();
    }
  }
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_STOCKS);
    if (existing.length > 0) {
      void workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_STOCKS, active: true });
      void workspace.revealLeaf(leaf);
    }
  }
  scheduleRefresh() {
    if (this.timer !== null)
      window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      void this.refreshViews();
    }, Math.max(1, this.settings.refreshMins) * 6e4);
  }
  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_STOCKS).forEach((l) => {
      void l.view.refresh();
    });
  }
  checkAlerts(item, q) {
    for (const a of item.alerts) {
      if (a.triggered)
        continue;
      if (a.above ? q.price >= a.price : q.price <= a.price) {
        a.triggered = true;
        const name = item.label || q.name || item.ticker;
        const dir = a.above ? "above" : "below";
        new import_obsidian.Notice(`ObsidiStocks: ${name} is ${dir} ${formatPrice(a.price, q.currency)}`, 8e3);
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("ObsidiStocks", { body: `${name} is now ${dir} ${formatPrice(a.price, q.currency)}` });
        } catch (e) {
        }
        void this.saveSettings();
      }
    }
  }
  async insertSnapshot() {
    const mdView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!mdView) {
      new import_obsidian.Notice("Open a note first");
      return;
    }
    new import_obsidian.Notice("Fetching prices\u2026");
    const quotes = await fetchAll(this.settings.watchlist, this.settings.sparkRange, false);
    const lines = [
      `## ObsidiStocks \u2014 ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
      "",
      "| Ticker | Name | Price | Change | Day Hi | Day Lo |",
      "| :----- | :--- | ----: | -----: | -----: | -----: |"
    ];
    for (const item of this.settings.watchlist) {
      const q = quotes.get(item.ticker);
      if (!q) {
        lines.push(`| ${item.ticker} | \u2014 | \u2014 | \u2014 | \u2014 | \u2014 |`);
        continue;
      }
      const s = q.changePct >= 0 ? "+" : "\u2212";
      lines.push(`| ${item.ticker} | ${q.name} | ${formatPrice(q.price, q.currency)} | ${s}${Math.abs(q.changePct).toFixed(2)}% | ${formatPrice(q.dayHigh, q.currency)} | ${formatPrice(q.dayLow, q.currency)} |`);
    }
    lines.push("");
    mdView.editor.replaceSelection(lines.join("\n"));
    new import_obsidian.Notice("Snapshot inserted!");
  }
};
var StocksView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.busy = false;
    this.expandedSet = /* @__PURE__ */ new Set();
    this.cachedQuotes = /* @__PURE__ */ new Map();
    this.sortKey = "none";
    this.sortDir = "desc";
    this.lastUpdated = null;
    this.plugin = plugin;
    this.sparkRange = plugin.settings.sparkRange;
  }
  getViewType() {
    return VIEW_TYPE_STOCKS;
  }
  getDisplayText() {
    return "Obsidistocks";
  }
  getIcon() {
    return "trending-up";
  }
  async onOpen() {
    await this.refresh();
  }
  async onClose() {
  }
  async refresh() {
    if (this.busy)
      return;
    this.busy = true;
    try {
      await this.render(true);
    } finally {
      this.busy = false;
    }
  }
  toggleExpand(ticker) {
    if (this.expandedSet.has(ticker)) {
      this.expandedSet.delete(ticker);
    } else {
      this.expandedSet.clear();
      this.expandedSet.add(ticker);
    }
    void this.render(false);
  }
  async render(fetchPrices) {
    var _a, _b;
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("st-view");
    const pro = this.plugin.isProEnabled();
    const hdr = containerEl.createDiv("st-header");
    hdr.createEl("span", { text: pro ? "ObsidiStocks pro" : "ObsidiStocks", cls: pro ? "st-title st-title-pro" : "st-title" });
    const acts = hdr.createDiv("st-actions");
    const sortDefs = [
      { key: "price", label: "$" },
      { key: "change", label: "%" },
      { key: "volume", label: "V" }
    ];
    for (const sd of sortDefs) {
      const active = this.sortKey === sd.key;
      const btn = acts.createEl("button", {
        cls: `st-btn-icon st-sort-btn${active ? " st-sort-active" : ""}`,
        text: active ? `${sd.label}${this.sortDir === "desc" ? "\u2193" : "\u2191"}` : sd.label,
        attr: { title: `Sort by ${sd.key}` }
      });
      btn.addEventListener("click", () => {
        if (this.sortKey === sd.key) {
          this.sortDir = this.sortDir === "desc" ? "asc" : "desc";
        } else {
          this.sortKey = sd.key;
          this.sortDir = "desc";
        }
        void this.render(false);
      });
    }
    if (this.sortKey !== "none") {
      const clr = acts.createEl("button", { cls: "st-btn-icon st-sort-clear", text: "\xD7", attr: { title: "Clear sort" } });
      clr.addEventListener("click", () => {
        this.sortKey = "none";
        void this.render(false);
      });
    }
    acts.createEl("span", { cls: "st-actions-divider" });
    acts.createEl("button", { cls: "st-btn-icon", text: "+", attr: { title: "Add ticker" } }).addEventListener("click", () => new AddTickerModal(this.app, this.plugin, () => {
      void this.refresh();
    }).open());
    acts.createEl("button", { cls: "st-btn-icon", text: "\u21BB", attr: { title: "Refresh" } }).addEventListener("click", () => {
      void this.refresh();
    });
    const { watchlist } = this.plugin.settings;
    if (watchlist.length === 0) {
      const empty = containerEl.createDiv("st-empty");
      empty.createEl("p", { text: "Watchlist is empty." });
      empty.createEl("button", { text: "Add a ticker", cls: "st-add-first" }).addEventListener("click", () => new AddTickerModal(this.app, this.plugin, () => {
        void this.refresh();
      }).open());
      return;
    }
    if (pro) {
      const pills = containerEl.createDiv("st-pills");
      for (const r of SPARK_RANGES) {
        const pill = pills.createEl("button", { text: r.label, cls: `st-pill${this.sparkRange === r.value ? " st-pill-active" : ""}` });
        pill.addEventListener("click", () => {
          void (async () => {
            this.sparkRange = r.value;
            this.plugin.settings.sparkRange = r.value;
            await this.plugin.saveSettings();
            await this.render(true);
          })();
        });
      }
    }
    let quotes;
    if (fetchPrices) {
      const loading = containerEl.createDiv("st-loading");
      loading.setText("Fetching prices\u2026");
      quotes = await fetchAll(watchlist, this.sparkRange, pro);
      this.cachedQuotes = quotes;
      this.lastUpdated = new Date();
      loading.remove();
    } else {
      quotes = this.cachedQuotes;
    }
    for (const item of watchlist) {
      const q = quotes.get(item.ticker);
      if (q && ((_a = item.alerts) == null ? void 0 : _a.length))
        this.plugin.checkAlerts(item, q);
    }
    let visible = !pro && watchlist.length > FREE_LIMIT ? watchlist.slice(0, FREE_LIMIT) : [...watchlist];
    if (this.sortKey !== "none") {
      const dir = this.sortDir === "desc" ? -1 : 1;
      visible.sort((a, b) => {
        const qa = quotes.get(a.ticker), qb = quotes.get(b.ticker);
        if (!qa && !qb)
          return 0;
        if (!qa)
          return 1;
        if (!qb)
          return -1;
        if (this.sortKey === "price")
          return dir * (qa.price - qb.price);
        if (this.sortKey === "change")
          return dir * (qa.changePct - qb.changePct);
        if (this.sortKey === "volume")
          return dir * (qa.volume - qb.volume);
        return 0;
      });
    }
    const list = containerEl.createDiv("st-list");
    for (let vi = 0; vi < visible.length; vi++) {
      const item = visible[vi];
      const q = quotes.get(item.ticker);
      const pos = !q || q.changePct >= 0;
      const isExpanded = this.expandedSet.has(item.ticker);
      const wrap = list.createDiv("st-wrap");
      wrap.setAttribute("draggable", "true");
      wrap.dataset.ticker = item.ticker;
      const row = wrap.createDiv(`st-row${q ? pos ? " st-up" : " st-down" : ""}`);
      row.addClass("st-row-clickable");
      const handle = row.createDiv("st-drag-handle");
      (() => {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", "10");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 10 16");
        svg.setAttribute("fill", "currentColor");
        for (const [cx, cy] of [[3, 3], [7, 3], [3, 8], [7, 8], [3, 13], [7, 13]]) {
          const c = document.createElementNS(svgNS, "circle");
          c.setAttribute("cx", String(cx));
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", "1.3");
          svg.appendChild(c);
        }
        handle.appendChild(svg);
      })();
      const left = row.createDiv("st-left");
      const nameRow = left.createDiv("st-name-row");
      nameRow.createEl("span", { text: item.label || (q == null ? void 0 : q.name) || item.ticker, cls: "st-name" });
      if (q)
        nameRow.createEl("span", { text: marketStateDot(q.marketState), cls: `st-dot ${marketStateCls(q.marketState)}`, attr: { title: marketStateLabel(q.marketState) } });
      left.createEl("span", { text: item.ticker, cls: "st-ticker-label" });
      if (q && q.dayHigh > 0 && q.dayLow > 0 && q.dayHigh !== q.dayLow) {
        const rangePct = Math.max(0, Math.min(1, (q.price - q.dayLow) / (q.dayHigh - q.dayLow)));
        const bar = left.createDiv("st-day-range-bar");
        const fill = bar.createDiv("st-day-range-fill");
        fill.setCssProps({ "--st-fill-width": `${(rangePct * 100).toFixed(1)}%` });
      }
      const spark = row.createDiv("st-spark");
      if (q && q.closes.length >= 2)
        appendSparklineSVG(spark, q.closes, pos);
      const right = row.createDiv("st-right");
      if (q) {
        right.createEl("span", { text: formatPrice(q.price, q.currency), cls: "st-price" });
        const mag = changeMagnitude(Math.abs(q.changePct));
        const baseAlpha = pos ? `hsla(142,65%,50%,` : `hsla(0,85%,60%,`;
        const chEl = right.createEl("span", { text: formatChange(q.change, q.changePct, q.currency), cls: `st-change ${pos ? "st-change-up" : "st-change-down"}` });
        chEl.setCssProps({ "--st-change-opacity": String(0.4 + mag * 0.6), "--st-change-bg": `${baseAlpha}${(mag * 0.22).toFixed(2)})` });
      } else {
        right.createEl("span", { text: "\u2014", cls: "st-price st-na" });
        right.createEl("span", { text: "Unavailable", cls: "st-change st-na" });
      }
      if (q && q.closes.length >= 2) {
        const tip = row.createDiv("st-spark-tip");
        appendSparklineSVG(tip, q.closes, pos, 200, 56);
        tip.createEl("span", { text: `${item.label || q.name}  ${formatPrice(q.price, q.currency)}`, cls: "st-spark-tip-label" });
      }
      row.addEventListener("click", (e) => {
        if (e.target.closest(".st-drag-handle"))
          return;
        this.toggleExpand(item.ticker);
      });
      if (isExpanded && q) {
        const detail = wrap.createDiv("st-detail");
        if (pro) {
          buildInteractiveChart(detail, q.closes, q.timestamps, pos, q.currency);
        }
        const grid = detail.createDiv("st-detail-grid");
        const stat = (l, v) => {
          const c = grid.createDiv("st-stat");
          c.createEl("span", { text: l, cls: "st-stat-label" });
          c.createEl("span", { text: v, cls: "st-stat-value" });
        };
        stat("Day range", `${formatPrice(q.dayLow, q.currency)} \u2013 ${formatPrice(q.dayHigh, q.currency)}`);
        stat("52-wk range", `${formatPrice(q.fiftyTwoLow, q.currency)} \u2013 ${formatPrice(q.fiftyTwoHigh, q.currency)}`);
        stat("Volume", q.volume > 0 ? q.volume.toLocaleString("en-GB") : "\u2014");
        stat("Status", marketStateLabel(q.marketState));
        if (q.marketState === "PRE" && q.prePrice > 0)
          stat("Pre-market", formatPrice(q.prePrice, q.currency));
        if (q.marketState === "POST" && q.postPrice > 0)
          stat("After-hrs", formatPrice(q.postPrice, q.currency));
        if (pro) {
          const nw = detail.createDiv("st-note-wrap");
          const nd = nw.createEl("p", { text: item.note || "Tap to add a note\u2026", cls: `st-note-text${item.note ? "" : " st-note-placeholder"}` });
          nd.addEventListener("click", () => {
            var _a2;
            nd.remove();
            const ta = nw.createEl("textarea", { cls: "st-note-input" });
            ta.value = (_a2 = item.note) != null ? _a2 : "";
            ta.focus();
            ta.addEventListener("blur", () => {
              void (async () => {
                item.note = ta.value.trim();
                await this.plugin.saveSettings();
                void this.refresh();
              })();
            });
          });
        }
        if (pro) {
          const aw = detail.createDiv("st-alert-wrap");
          const ah = aw.createDiv("st-alert-hdr");
          ah.createEl("span", { text: "Alerts", cls: "st-section-label" });
          ah.createEl("button", { text: "Add alert", cls: "st-small-btn" }).addEventListener("click", () => new AlertModal(this.app, item, q, async () => {
            await this.plugin.saveSettings();
            void this.refresh();
          }).open());
          if ((_b = item.alerts) == null ? void 0 : _b.length) {
            for (let ai = 0; ai < item.alerts.length; ai++) {
              const a = item.alerts[ai];
              const ar = aw.createDiv("st-alert-row");
              ar.createEl("span", { text: `${a.above ? "\u25B2 Above" : "\u25BC Below"} ${formatPrice(a.price, q.currency)}${a.triggered ? " \u2713" : ""}`, cls: `st-alert-text${a.triggered ? " st-alert-done" : ""}` });
              ar.createEl("button", { text: "\xD7", cls: "st-small-btn st-del-btn" }).addEventListener("click", () => {
                void (async () => {
                  item.alerts.splice(ai, 1);
                  await this.plugin.saveSettings();
                  void this.refresh();
                })();
              });
            }
          }
        }
        if (pro && q.news.length > 0) {
          const nw = detail.createDiv("st-news-wrap");
          nw.createEl("span", { text: "News", cls: "st-section-label" });
          for (const n of q.news) {
            const a = nw.createEl("a", { cls: "st-news-item", href: n.link, attr: { target: "_blank", rel: "noopener noreferrer" } });
            a.createEl("span", { text: n.title, cls: "st-news-title" });
            a.createEl("span", { text: n.publisher, cls: "st-news-pub" });
          }
        }
      }
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = new import_obsidian.Menu();
        menu.addItem((mi) => {
          mi.setTitle("Insert snapshot into note");
          mi.setIcon("file-text");
          mi.onClick(() => {
            void this.plugin.insertSnapshot();
          });
        });
        menu.addSeparator();
        menu.addItem((mi) => {
          mi.setTitle(`Remove ${item.label || item.ticker}`);
          mi.setIcon("trash");
          mi.onClick(() => {
            void (async () => {
              this.plugin.settings.watchlist = this.plugin.settings.watchlist.filter((w) => w.ticker !== item.ticker);
              await this.plugin.saveSettings();
              void this.refresh();
            })();
          });
        });
        menu.showAtMouseEvent(e);
      });
      wrap.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.ticker);
        wrap.addClass("st-dragging");
      });
      wrap.addEventListener("dragend", () => wrap.removeClass("st-dragging"));
      wrap.addEventListener("dragover", (e) => {
        e.preventDefault();
        wrap.addClass("st-drag-over");
      });
      wrap.addEventListener("dragleave", () => wrap.removeClass("st-drag-over"));
      wrap.addEventListener("drop", (e) => {
        void (async () => {
          e.preventDefault();
          wrap.removeClass("st-drag-over");
          const fromTicker = e.dataTransfer.getData("text/plain");
          const wl = this.plugin.settings.watchlist;
          const fromIdx = wl.findIndex((w) => w.ticker === fromTicker);
          const toIdx = wl.findIndex((w) => w.ticker === item.ticker);
          if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx)
            return;
          const [moved] = wl.splice(fromIdx, 1);
          wl.splice(toIdx, 0, moved);
          await this.plugin.saveSettings();
          void this.render(false);
        })();
      });
    }
    if (!pro) {
      const u = containerEl.createDiv("st-free-nudge");
      const txt = watchlist.length > FREE_LIMIT ? `Showing ${FREE_LIMIT} of ${watchlist.length} tickers. ` : "Free plan. ";
      u.createEl("span", { text: txt });
      const a = u.createEl("a", { text: "Get pro \u2192", cls: "st-pro-link" });
      a.href = "https://gumroad.com/l/obsidistocks-pro";
    }
    const footer = containerEl.createDiv("st-footer");
    const timeStr = this.lastUpdated ? `Updated ${this.lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Not yet refreshed";
    footer.createEl("span", { text: timeStr, cls: "st-time" });
  }
};
var AddTickerModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    new import_obsidian.Setting(contentEl).setName("Add to watchlist").setHeading();
    let ticker = "", label = "";
    new import_obsidian.Setting(contentEl).setName("Ticker symbol").addText((t) => t.setPlaceholder("AAPL").onChange((v) => {
      ticker = v.toUpperCase().trim();
    }));
    new import_obsidian.Setting(contentEl).setName("Label (optional)").setDesc("Friendly name shown in the list").addText((t) => t.setPlaceholder("Apple").onChange((v) => {
      label = v.trim();
    }));
    new import_obsidian.Setting(contentEl).addButton((btn) => btn.setButtonText("Add").setCta().onClick(() => {
      void (async () => {
        if (!ticker) {
          new import_obsidian.Notice("Enter a ticker symbol");
          return;
        }
        if (this.plugin.settings.watchlist.find((w) => w.ticker === ticker)) {
          new import_obsidian.Notice(`${ticker} already in watchlist`);
          return;
        }
        if (!this.plugin.isProEnabled() && this.plugin.settings.watchlist.length >= FREE_LIMIT) {
          new import_obsidian.Notice(`Free plan: max ${FREE_LIMIT} tickers. Upgrade to pro for unlimited.`);
          return;
        }
        this.plugin.settings.watchlist.push({ ticker, label, note: "", alerts: [] });
        await this.plugin.saveSettings();
        this.close();
        this.onDone();
      })();
    })).addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AlertModal = class extends import_obsidian.Modal {
  constructor(app, item, quote, onSave) {
    super(app);
    this.item = item;
    this.quote = quote;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    new import_obsidian.Setting(contentEl).setName(`Alert \u2014 ${this.item.label || this.item.ticker}`).setHeading();
    contentEl.createEl("p", { text: `Current: ${formatPrice(this.quote.price, this.quote.currency)}`, cls: "st-modal-price" });
    let above = true, alertPrice = this.quote.price;
    new import_obsidian.Setting(contentEl).setName("Direction").addDropdown((d) => d.addOptions({ above: "\u25B2 Rises above", below: "\u25BC Falls below" }).setValue("above").onChange((v) => {
      above = v === "above";
    }));
    new import_obsidian.Setting(contentEl).setName("Price").addText((t) => t.setPlaceholder(this.quote.price.toFixed(2)).setValue(this.quote.price.toFixed(2)).onChange((v) => {
      alertPrice = parseFloat(v) || this.quote.price;
    }));
    new import_obsidian.Setting(contentEl).addButton((btn) => btn.setButtonText("Set alert").setCta().onClick(() => {
      void (async () => {
        if (!this.item.alerts)
          this.item.alerts = [];
        this.item.alerts.push({ above, price: alertPrice, triggered: false });
        await this.onSave();
        this.close();
      })();
    })).addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var StocksSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Auto-refresh (minutes)").addSlider((s) => s.setLimits(1, 60, 1).setValue(this.plugin.settings.refreshMins).setDynamicTooltip().onChange(async (v) => {
      this.plugin.settings.refreshMins = v;
      await this.plugin.saveSettings();
      this.plugin.scheduleRefresh();
    }));
    new import_obsidian.Setting(containerEl).setName("Watchlist").setHeading();
    new import_obsidian.Setting(containerEl).setName("Add ticker").addButton((btn) => btn.setButtonText("Add").setCta().onClick(() => {
      new AddTickerModal(this.app, this.plugin, () => {
        this.display();
        this.plugin.refreshViews();
      }).open();
    }));
    const { watchlist } = this.plugin.settings;
    if (watchlist.length === 0) {
      containerEl.createEl("p", { text: "No tickers yet.", cls: "st-settings-empty" });
    } else {
      for (let i = 0; i < watchlist.length; i++) {
        const item = watchlist[i];
        new import_obsidian.Setting(containerEl).setName(item.label || item.ticker).setDesc(item.label ? item.ticker : "").addButton((btn) => btn.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(() => {
          void (async () => {
            [watchlist[i - 1], watchlist[i]] = [watchlist[i], watchlist[i - 1]];
            await this.plugin.saveSettings();
            this.display();
            this.plugin.refreshViews();
          })();
        })).addButton((btn) => btn.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === watchlist.length - 1).onClick(() => {
          void (async () => {
            [watchlist[i + 1], watchlist[i]] = [watchlist[i], watchlist[i + 1]];
            await this.plugin.saveSettings();
            this.display();
            this.plugin.refreshViews();
          })();
        })).addButton((btn) => btn.setIcon("trash").setTooltip("Remove").onClick(() => {
          void (async () => {
            watchlist.splice(i, 1);
            await this.plugin.saveSettings();
            this.display();
            this.plugin.refreshViews();
          })();
        }));
      }
    }
    new import_obsidian.Setting(containerEl).setName("Pro licence").setHeading();
    const pro = this.plugin.isProEnabled();
    let keyInput = "";
    new import_obsidian.Setting(containerEl).setName("Licence key").setDesc(pro ? "Pro licence active \u2014 thank you!" : "Paste your licence key and click verify").addText((t) => {
      t.setPlaceholder("Paste licence key here").setValue(this.plugin.settings.licenceKey).onChange((v) => {
        keyInput = v.trim();
      });
      keyInput = this.plugin.settings.licenceKey;
    }).addButton((btn) => {
      btn.setButtonText(pro ? "Re-verify" : "Verify").setCta();
      btn.onClick(() => {
        void (async () => {
          const key = keyInput || this.plugin.settings.licenceKey;
          if (!key) {
            new import_obsidian.Notice("Paste your licence key first");
            return;
          }
          btn.setButtonText("Checking\u2026").setDisabled(true);
          this.plugin.settings.licenceKey = key;
          const valid = await verifyLicenceKey(key);
          this.plugin.settings.licenceValid = valid;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          if (valid) {
            new import_obsidian.Notice("Pro licence activated \u2014 thank you!");
          } else {
            new import_obsidian.Notice("Key not recognised \u2014 check your purchase receipt.");
          }
          this.display();
        })();
      });
    });
    if (pro) {
      const deact = containerEl.createDiv("st-licence-deact");
      deact.createEl("a", { text: "Remove licence key", cls: "st-deact-link" }).addEventListener("click", () => {
        void (async () => {
          this.plugin.settings.licenceKey = "";
          this.plugin.settings.licenceValid = false;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display();
        })();
      });
    }
    if (!pro) {
      const cta = containerEl.createDiv("st-pro-cta");
      cta.createEl("p", { text: "Pro includes:", cls: "st-pro-title" });
      const ul = cta.createEl("ul");
      ["Unlimited tickers", "Price alerts with OS notifications", "Sparkline range \u2014 1W / 1M / 3M / 1Y", "Latest news per ticker", "Notes per ticker, stored in your vault", "Pre & post-market prices"].forEach((f) => ul.createEl("li", { text: f }));
      const a = cta.createEl("a", { text: "Get pro \u2192", cls: "st-pro-link" });
      a.href = "https://gumroad.com/l/obsidistocks-pro";
    }
  }
};
