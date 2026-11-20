const fs=require('node:fs'),path=require('node:path');
const {fetchJson}=require('./stock-quotes.cjs');
const {taipeiDay,validDate,validBar,validIndexMarket,validMarketSnapshot}=require('../shared/market-index-format.js');
const markets=['tse','otc'];
const columns={tse:{ohlc:['日期','開盤指數','最高指數','最低指數','收盤指數'],totals:['日期','成交股數','成交金額','成交筆數','發行量加權股價指數','漲跌點數']},otc:{ohlc:['日期','開市','最高','最低','收市','漲/跌'],totals:['日期','成交張數','金額（仟元）','筆數','櫃買指數','漲/跌']}};
function dateValue(value) {
 const match=/^(\d{3,4})\/(\d{2})\/(\d{2})$/.exec(String(value));if(!match)throw Error('Invalid official date');
 const date=String(+match[1]+(match[1].length===3?1911:0))+'-'+match[2]+'-'+match[3];if(!validDate(date))throw Error('Invalid/future official date');return date;
}
function numberValue(value) {const t=String(value??'').trim().replace(/,/g,'');if(!/^[+-]?\d+(\.\d+)?$/.test(t)||!Number.isFinite(Number(t)))throw Error('Invalid official number');return Number(t);}
function table(doc,keys) {
 if(!doc||!/^ok$/i.test(doc.stat||''))throw Error('Official report unavailable');
 const t=(doc.tables||[doc]).find(t=>Array.isArray(t.fields)&&keys.every(k=>t.fields.includes(k)));
 if(!t||!Array.isArray(t.data))throw Error('Official fields/units changed');
 const indices=keys.map(k=>t.fields.indexOf(k));
 return t.data.map(row=>{if(!Array.isArray(row)||row.length!==t.fields.length)throw Error('Incomplete official row');return indices.map(i=>row[i]);});
}
function parseIndexMonth(ohlc,totals,market,month) {
 const keys=columns[market];if(!keys)throw Error('Unknown market');
 const noData=d=>market==='tse'?d?.stat==='很抱歉，沒有符合條件的資料!':/^ok$/i.test(d?.stat||'')&&Array.isArray(d.tables)&&d.tables.length===0;
 if(noData(ohlc)||noData(totals)){if(noData(ohlc)&&noData(totals))return [];throw Error('Official reports disagree about no data');}
 const rows=table(ohlc,keys.ohlc),values=table(totals,keys.totals),byDate=new Map();
 for(const row of values){const date=dateValue(row[0]);if(!date.startsWith(month)||byDate.has(date))throw Error('Duplicate or wrong month');byDate.set(date,row);}
 const seen=new Set(),bars=rows.map(row=>{
  const date=dateValue(row[0]);if(!date.startsWith(month)||seen.has(date))throw Error('Duplicate or wrong month');seen.add(date);
  const v=byDate.get(date);if(!v)throw Error('Incomplete market dates');
  const [open,high,low,close]=row.slice(1,5).map(numberValue);if(Math.abs(close-numberValue(v[4]))>.005)throw Error('Official closing indices disagree');
  if(market==='otc'&&Math.abs(numberValue(row[5])-numberValue(v[5]))>.005)throw Error('Official changes disagree');
  const factor=market==='otc'?1000:1,bar={date,open,high,low,close,volume:numberValue(v[1])*factor,amount:numberValue(v[2])*factor,change:numberValue(v[5])};
  if(!validBar(bar))throw Error('Invalid OHLC or market totals');return bar;
 });
 if(seen.size!==byDate.size)throw Error('Incomplete market dates');return bars.sort((a,b)=>a.date.localeCompare(b.date));
}
function monthList(today,count) {const date=new Date(today.slice(0,7)+'-01T00:00:00Z');return Array.from({length:count},(_,i)=>{const d=new Date(date);d.setUTCMonth(d.getUTCMonth()-i);return d.toISOString().slice(0,7);});}
function urls(market,month) {const date=month+'-01';return market==='tse'?[`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=${date.replace(/-/g,'')}&response=json`,`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${date.replace(/-/g,'')}&response=json`]:[`https://www.tpex.org.tw/www/zh-tw/indexInfo/inx?date=${date.replace(/-/g,'/')}&response=json`,`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex?date=${date.replace(/-/g,'/')}&response=json`];}
function readJson(file) {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
async function updateMarketIndices({output=path.resolve('market-indices.json'),load=fetchJson,now=new Date().toISOString(),months,backfill=false,delayMs=700,closing=readJson(path.join(path.dirname(output),'closing-prices.json')),log=()=>{}}={}) {
 const previous=readJson(output),today=taipeiDay(now),snapshot={schemaVersion:1,generatedAt:new Date(now).toISOString(),markets:{}},cutoff=monthList(today,12).pop()+'-01';let failures=0;
 async function request(url){let last;for(let i=0;i<2;i++){try{return await load(url);}catch(e){last=e;if(i&&delayMs)break;if(delayMs)await new Promise(r=>setTimeout(r,delayMs));}}throw last;}
 await Promise.all(markets.map(async market=>{
  const old=previous&&validMarketSnapshot(previous)?previous.markets[market]:null;
  try {
   const wanted=months||monthList(today,backfill||!old?12:2),incoming=[];
   for(let i=0;i<wanted.length;i++) {const pair=await Promise.all(urls(market,wanted[i]).map(request));incoming.push(...parseIndexMonth(...pair,market,wanted[i]));if(i<wanted.length-1&&delayMs)await new Promise(r=>setTimeout(r,delayMs));}
   if(!incoming.length)throw Error('No market history returned');
   const latest=incoming.reduce((d,b)=>b.date>d?b.date:d,'');
   if(old&&latest<old.bars[old.bars.length-1].date)throw Error('Official trading date moved backwards');
   const known=(closing?.markets?.[market]?.quotes||[]).reduce((d,q)=>typeof q.date==='string'&&q.date>d?q.date:d,'');
   if(known>latest)throw Error('指數尚未更新至個股已發布的交易日 '+known);
   const bars=[...new Map([...(old?.bars||[]),...incoming].map(b=>[b.date,b])).values()].filter(b=>b.date>=cutoff).sort((a,b)=>a.date.localeCompare(b.date));
   snapshot.markets[market]={market,name:market==='tse'?'加權指數':'櫃買指數',updatedAt:snapshot.generatedAt,error:null,notice:latest<today?'尚無今日資料，可能休市或尚未發布；目前顯示最近交易日。':null,bars};
   log(market+': '+bars.length+' sessions, latest '+latest);if(latest<today)log('::warning::'+market+' 尚無今日資料；交易日期 '+latest);
  }catch(e) {failures++;log(market+': '+e.message);if(old)snapshot.markets[market]={...old,error:String(e.message).slice(0,200)};}
 }));
 if(failures===2||!validMarketSnapshot(snapshot))throw Error('Market update failed; existing JSON retained');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(snapshot)+'\n');fs.renameSync(output+'.tmp',output);
 return {snapshot,failures};
}
if(require.main===module)updateMarketIndices({output:path.resolve(process.argv.find((a,i)=>i>1&&!a.startsWith('--'))||'market-indices.json'),backfill:process.argv.includes('--backfill'),log:console.log}).then(r=>{if(r.failures)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={parseIndexMonth,updateMarketIndices,monthList,urls};

