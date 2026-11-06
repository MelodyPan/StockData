const http = require('node:http');
const {normalizeQuotes} = require('../shared/stock-quote-format.js');
const {parseTwseCsv} = require('./stock-csv.cjs');
const ENDPOINTS = {
  tse: 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json',
  otc: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
};

async function fetchText(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(20000), redirect:'error', headers:{Accept:'application/json, text/csv', 'Cache-Control':'no-cache'}});
  if (!response.ok) throw Error(`官方服務 HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 10 * 1024 * 1024) throw Error('官方回應超過大小限制');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchJson(url) { return JSON.parse(await fetchText(url)); }
async function fetchMarketRows(url) { return url === ENDPOINTS.tse ? parseTwseCsv(await fetchText(url)) : fetchJson(url); }

function createQuoteProvider({fetchJson:load = fetchMarketRows, now = Date.now, ttl = 5 * 60 * 1000} = {}) {
  const states = {};
  async function marketData(market, force) {
    const state = states[market] || (states[market] = {value:{quotes:[], fetchedAt:null, error:null}, expires:0, pending:null});
    if (state.pending) return state.pending;
    if (!force && now() < state.expires) return state.value;
    state.pending = (async () => {
      try {
        const rows = await load(ENDPOINTS[market]);
        const quotes = normalizeQuotes(rows, market);
        if (!quotes.length || quotes.length !== rows.length) throw Error('官方資料為空或部分格式不符');
        state.value = {quotes, fetchedAt:new Date(now()).toISOString(), error:null};
        state.expires = now() + ttl;
      } catch {
        state.value = {...state.value, error:'無法更新官方收盤資料，請稍後再試。'};
        state.expires = now() + Math.min(ttl, 30000);
      } finally { state.pending = null; }
      return state.value;
    })();
    return state.pending;
  }
  return {async getQuotes({force = false} = {}) {
    const [tse, otc] = await Promise.all([marketData('tse', force), marketData('otc', force)]);
    return {markets:{tse, otc}};
  }};
}

function createStockHandler(provider = createQuoteProvider()) {
  return async (request, response) => {
    const send = (status, body) => {response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}); response.end(JSON.stringify(body));};
    try {
      const host = new URL(`http://${request.headers.host}`);
      if (!['127.0.0.1','localhost'].includes(host.hostname)) return send(403, {error:'僅供本機使用'});
      if (request.headers.origin) {
        const origin = new URL(request.headers.origin);
        if (origin.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(origin.hostname) || !['4201','4173',host.port].includes(origin.port)) return send(403, {error:'不允許此來源'});
      }
      const url = new URL(request.url, host);
      if (url.pathname !== '/api/stock/quotes' || [...url.searchParams.keys()].some(key => key !== 'refresh') || (url.searchParams.has('refresh') && url.searchParams.get('refresh') !== '1')) return send(404, {error:'找不到此路徑'});
      if (request.method !== 'GET') return send(405, {error:'僅支援 GET'});
      send(200, await provider.getQuotes({force:url.searchParams.get('refresh') === '1'}));
    } catch { send(503, {error:'本機股價服務暫時無法使用'}); }
  };
}

function createStockServer(options) { return http.createServer(createStockHandler(createQuoteProvider(options))); }
module.exports = {normalizeQuotes, createQuoteProvider, createStockHandler, createStockServer, fetchJson};
