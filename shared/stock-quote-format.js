const taipeiDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'});
function numeric(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/,/g, '');
  return /^[+-]?\d+(\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}

function tradeDate(value) {
  const raw = String(value);
  if (!/^\d{7}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 3)) + 1911;
  const month = Number(raw.slice(3, 5)), day = Number(raw.slice(5));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const iso = date.toISOString().slice(0, 10);
  const today = taipeiDate.format(new Date());
  return iso > today ? null : iso;
}

function normalizeQuotes(rows, market) {
  if (!Array.isArray(rows)) throw Error('官方資料格式不符');
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const code = market === 'tse' ? row.Code : row.SecuritiesCompanyCode;
    const name = market === 'tse' ? row.Name : row.CompanyName;
    const date = tradeDate(row.Date);
    if (typeof code !== 'string' || !/^\d{4}[A-Z0-9]{0,3}$/.test(code) || typeof name !== 'string' || !name.trim() || !date) return [];
    const close = numeric(market === 'tse' ? row.ClosingPrice : row.Close);
    return [{code, name:name.trim(), market, date, close:close !== null && close > 0 ? close : null, change:numeric(row.Change)}];
  });
}

function validMarketData(value, market) {
  return !!value && Array.isArray(value.quotes) && value.quotes.length > 0 && value.quotes.length < 20000 &&
    typeof value.fetchedAt === 'string' && Number.isFinite(Date.parse(value.fetchedAt)) &&
    (value.error === null || typeof value.error === 'string') && value.quotes.every(quote => {
      if (!quote || quote.market !== market || typeof quote.code !== 'string' || !/^\d{4}[A-Z0-9]{0,3}$/.test(quote.code) || typeof quote.name !== 'string' || !quote.name.trim()) return false;
      if (typeof quote.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(quote.date)) return false;
      const date = new Date(quote.date);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== quote.date || quote.date > taipeiDate.format(new Date())) return false;
      return (quote.close === null || (typeof quote.close === 'number' && Number.isFinite(quote.close) && quote.close > 0)) &&
        (quote.change === null || (typeof quote.change === 'number' && Number.isFinite(quote.change)));
    });
}

function validSnapshot(value) {
  return !!value && value.schemaVersion === 1 && typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt)) &&
    !!value.markets && validMarketData(value.markets.tse, 'tse') && validMarketData(value.markets.otc, 'otc');
}
module.exports = {normalizeQuotes, validMarketData, validSnapshot};
