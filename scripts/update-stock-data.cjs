const fs = require('node:fs');
const path = require('node:path');
const {createQuoteProvider, fetchJson} = require('./stock-quotes.cjs');
const {validMarketData, validSnapshot} = require('../shared/stock-quote-format.js');
const PREVIOUS_URL = 'https://raw.githubusercontent.com/MelodyPan/StockData/main/closing-prices.json';

function createSnapshot(current, previous = null, generatedAt = new Date().toISOString()) {
  const fresh = market => validMarketData(current && current.markets && current.markets[market], market) && !current.markets[market].error;
  if (!fresh('tse') && !fresh('otc')) throw Error('兩個市場更新失敗，保留目前已發布資料。');
  const result = {schemaVersion:1, generatedAt, markets:{}};
  for (const market of ['tse', 'otc']) {
    const old = previous && previous.schemaVersion === 1 && previous.markets && previous.markets[market];
    const latestDate = data => data.quotes.reduce((latest, quote) => quote.date > latest ? quote.date : latest, '');
    if (fresh(market)) {
      const next = current.markets[market];
      result.markets[market] = validMarketData(old, market) && latestDate(old) > latestDate(next)
        ? {...old, error:'官方回傳較舊交易日資料，保留上次取得的收盤價。'} : next;
    }
    else {
      if (!validMarketData(old, market)) throw Error(`${market === 'tse' ? '上市' : '上櫃'}資料失敗且沒有有效舊資料，停止發布。`);
      result.markets[market] = {...old, error:'本次官方資料更新失敗，保留上次取得的收盤價。'};
    }
  }
  if (!validSnapshot(result)) throw Error('Snapshot validation failed.');
  return result;
}

function writeSnapshot(filename, snapshot) {
  if (!validSnapshot(snapshot)) throw Error('Snapshot validation failed.');
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  fs.writeFileSync(filename + '.tmp', JSON.stringify(snapshot) + '\n');
  fs.renameSync(filename + '.tmp', filename);
}

async function updateStockData({output = path.resolve(__dirname, '../closing-prices.json'), provider = createQuoteProvider(), loadPrevious = () => fetchJson(PREVIOUS_URL)} = {}) {
  async function previousSnapshot() {
    try {
      const local = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (validSnapshot(local)) return local;
    } catch { /* Missing or corrupt local output: try published data. */ }
    return loadPrevious().catch(() => null);
  }
  const [current, previous] = await Promise.all([provider.getQuotes({force:true}), previousSnapshot()]);
  const snapshot = createSnapshot(current, previous);
  writeSnapshot(output, snapshot);
  return snapshot;
}

if (require.main === module) updateStockData({output:process.argv[2] ? path.resolve(process.argv[2]) : undefined}).then(snapshot => {
  for (const market of ['tse', 'otc']) console.log(`${market}: ${snapshot.markets[market].quotes.length} quotes, ${snapshot.markets[market].error ? 'retained previous data' : 'updated'}`);
}).catch(error => {console.error(error.message);process.exitCode = 1;});
module.exports = {createSnapshot, writeSnapshot, updateStockData};
