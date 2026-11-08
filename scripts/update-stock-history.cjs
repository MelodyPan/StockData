const fs=require('node:fs'),path=require('node:path');
const {fetchJson}=require('./stock-quotes.cjs');
const {supportedCode,validDate,validBar,validHistory}=require('../shared/stock-history-format.js');
const markets=['tse','otc'];
function parseHistoryDay(payload,market,date){
 if(!markets.includes(market)||!validDate(date))throw Error('Invalid historical request');
 if(market==='tse'&&payload?.stat==='很抱歉，沒有符合條件的資料!')return {closed:true,stocks:[]};
 if(typeof payload?.stat!=='string'||payload.stat.toLowerCase()!=='ok'||payload.date!==date.replace(/-/g,''))throw Error('Official date/status mismatch');
 const keys=market==='tse'?['證券代號','證券名稱','開盤價','最高價','最低價','收盤價','成交股數']:['代號','名稱','開盤','最高','最低','收盤','成交股數'];
 const table=payload.tables?.find(t=>Array.isArray(t.fields)&&keys.every(k=>t.fields.includes(k)));
 if(!table||!Array.isArray(table.data))throw Error('Official history columns changed');
 const indices=keys.map(k=>table.fields.indexOf(k)),seen=new Set(),stocks=[];
 const number=v=>{const s=String(v??'').trim().replace(/,/g,'');return /^\d+(\.\d+)?$/.test(s)?Number(s):null;};
 for(const row of table.data){
  if(!Array.isArray(row)||row.length!==table.fields.length)throw Error('Incomplete official history row');
  const [code,name,open,high,low,close,volume]=indices.map(i=>row[i]);if(!supportedCode(code))continue;
  if(seen.has(code))throw Error('Duplicate official code');seen.add(code);
  const values=[open,high,low,close].map(number);if(values.some(v=>v===null))continue;
  const bar={date,open:values[0],high:values[1],low:values[2],close:values[3],volume:number(volume)};
  if(typeof name!=='string'||!name.trim()||!validBar(bar))throw Error('Invalid official OHLC/volume');
  stocks.push({code,name:name.trim(),bar});
 }
 return {closed:table.data.length===0,stocks};
}
function mergeBars(previous,next){return [...new Map([...previous,...next].map(bar=>[bar.date,bar])).values()].sort((a,b)=>a.date.localeCompare(b.date));}
function historyUrl(market,date){return market==='tse'?`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date.replace(/-/g,'')}&type=ALLBUT0999&response=json`:`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${date.replace(/-/g,'/')}&id=&response=json`;}
function writeJson(filename,value){fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename+'.tmp',JSON.stringify(value)+'\n');fs.renameSync(filename+'.tmp',filename);}
function readJson(filename){try{return JSON.parse(fs.readFileSync(filename,'utf8'));}catch{return null;}}
function calendarDates(days=184,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 const dates=[];for(let n=0;n<days;n++){const day=new Date(today+'T00:00:00Z');day.setUTCDate(day.getUTCDate()-n);if(day.getUTCDay()!==0&&day.getUTCDay()!==6)dates.push(day.toISOString().slice(0,10));}return dates;
}
async function updateHistory({root=path.resolve('history'),dates=calendarDates(),load=(market,date)=>fetchJson(historyUrl(market,date)),delayMs=1800,maxDates=12,log=()=>{}}={}){
 const saved=readJson(path.join(root,'index.json'));
 const index={schemaVersion:1,updatedAt:new Date().toISOString(),coverage:{tse:{...saved?.coverage?.tse},otc:{...saved?.coverage?.otc}},errors:{tse:null,otc:null}};
 const tasks=dates.filter((date,i)=>i<3||markets.some(m=>!index.coverage[m][date])).slice(0,maxDates);
 const cache=new Map(),dirty=new Set();let failed=0,succeeded=0;
 for(let i=0;i<tasks.length;i++){
  const date=tasks[i];if(!validDate(date))throw Error('Invalid history date');
  await Promise.all(markets.map(async market=>{
   try{
    const day=parseHistoryDay(await load(market,date),market,date);
    for(const stock of day.stocks){
     const key=market+'/'+stock.code,filename=path.join(root,key+'.json');
     let doc=cache.get(key);if(!doc){doc=readJson(filename);if(doc&&!validHistory(doc,stock.code,market))throw Error('Invalid stored history: '+key);doc=doc||{schemaVersion:1,market,code:stock.code,name:stock.name,updatedAt:index.updatedAt,bars:[]};cache.set(key,doc);}
     const name=!doc.bars.length||date>=doc.bars[doc.bars.length-1].date?stock.name:doc.name;
     const bars=mergeBars(doc.bars,[stock.bar]);if(JSON.stringify(bars)!==JSON.stringify(doc.bars)||doc.name!==name){Object.assign(doc,{name,updatedAt:index.updatedAt,bars});dirty.add(key);}
    }
    index.coverage[market][date]=day.closed?'closed':'data';succeeded++;log(market+' '+date+' '+day.stocks.length+' candles');
   }catch(e){failed++;index.errors[market]=String(e.message).slice(0,160);log(market+' '+date+' retained: '+e.message);}
  }));
  if(i<tasks.length-1&&delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
 }
 for(const key of dirty){const doc=cache.get(key);if(!validHistory(doc,doc.code,doc.market))throw Error('Invalid merged history');writeJson(path.join(root,key+'.json'),doc);}
 if(succeeded)writeJson(path.join(root,'index.json'),index);
 return {succeeded,failed,files:dirty.size,dates:tasks.length};
}
if(require.main===module){
 const args=process.argv.slice(2),all=args.includes('--backfill');
 updateHistory({root:path.resolve(args.find(a=>!a.startsWith('--'))||'history'),maxDates:all?200:12,log:console.log}).then(result=>{console.log(JSON.stringify(result));if(!result.succeeded)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={parseHistoryDay,mergeBars,updateHistory,calendarDates,historyUrl};
