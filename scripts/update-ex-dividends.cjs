const fs=require('node:fs'),path=require('node:path');
const {fetchJson}=require('./stock-quotes.cjs');
const {validEventDate,validEvent,validExDividendSnapshot,eventKey}=require('../shared/ex-dividend-format.js');
const ENDPOINTS={tse:'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',otc:'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'};
const fields={tse:['Code','Name','Date','Exdividend','CashDividend','StockDividendRatio','SubscriptionRatio','SubscriptionPricePerShare'],otc:['SecuritiesCompanyCode','CompanyName','ExRrightsExDividendDate','ExRrightsExDividend','CashDividend','StockDividendRatio','SubscriptionRatioToNewSharesIssued','SubscriptionPricePerShare']};
function officialDate(value){const text=String(value).trim();if(!/^\d{7,8}$/.test(text))throw Error('Invalid official event date');const date=String(Number(text.slice(0,-4))+(text.length===7?1911:0))+'-'+text.slice(-4,-2)+'-'+text.slice(-2);if(!validEventDate(date))throw Error('Invalid official event date');return date;}
function nullableNumber(value){if(typeof value!=='string')throw Error('Missing official numeric field');const text=value.trim().replace(/,/g,'');if(!text||text==='尚未公告'||text==='註4')return null;if(!/^\d+(\.\d+)?$/.test(text)||!Number.isFinite(Number(text)))throw Error('Invalid official event number');return Number(text);}
function parseAnnouncements(rows,market){
 if(!Array.isArray(rows)||rows.length>20000||!fields[market])throw Error('Official announcement format changed');const seen=new Set();
 return rows.map(row=>{if(!row||!fields[market].every(k=>Object.hasOwn(row,k)))throw Error('Official announcement fields changed');const [code,name,date,type,...numbers]=fields[market].map(k=>row[k]);
  const event={code,name,date:officialDate(date),type:typeof type==='string'?type.replace(/除|\s/g,''):type};for(const [i,k] of ['cashDividend','stockRatio','subscriptionRatio','subscriptionPrice'].entries())event[k]=nullableNumber(numbers[i]);
  if(!validEvent(event)||seen.has(eventKey(event)))throw Error('Invalid or duplicate official event');seen.add(eventKey(event));return event;
 }).sort((a,b)=>eventKey(a)<eventKey(b)?-1:eventKey(a)>eventKey(b)?1:0);
}
async function updateExDividends({output=path.resolve('ex-dividends.json'),load=fetchJson,now=new Date().toISOString(),delayMs=700,log=()=>{}}={}){
 let old=null;try{const d=JSON.parse(fs.readFileSync(output,'utf8'));if(validExDividendSnapshot(d))old=d;}catch{}
 const snapshot={schemaVersion:1,generatedAt:new Date(now).toISOString(),markets:{}};let failures=0;
 await Promise.all(['tse','otc'].map(async market=>{try{let rows,last;for(let i=0;i<2;i++){try{rows=await load(ENDPOINTS[market]);break;}catch(e){last=e;if(i===0&&delayMs)await new Promise(r=>setTimeout(r,delayMs));}}if(rows===undefined)throw last||Error('No official response');
  snapshot.markets[market]={market,updatedAt:snapshot.generatedAt,error:null,events:parseAnnouncements(rows,market)};log(market+': '+snapshot.markets[market].events.length+' announcements');
 }catch(e){failures++;snapshot.markets[market]={...(old?.markets[market]||{market,updatedAt:null,events:[]}),error:String(e.message).slice(0,200)};log('::warning::'+market+' '+e.message);}}));
 if(failures===2||!validExDividendSnapshot(snapshot))throw Error('Ex-dividend update failed; existing JSON retained');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(snapshot)+'\n');fs.renameSync(output+'.tmp',output);return {snapshot,failures};
}
if(require.main===module)updateExDividends({output:path.resolve(process.argv[2]||'ex-dividends.json'),log:console.log}).then(r=>{if(r.failures)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={ENDPOINTS,parseAnnouncements,updateExDividends};
