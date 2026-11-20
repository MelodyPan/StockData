const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseIndexMonth,updateMarketIndices}=require('../scripts/update-market-indices.cjs');
const {validMarketSnapshot}=require('../shared/market-index-format.js');
const stamp='2026-11-20T09:00:00.000Z';
function pair(market,date='2026-11-20',close=105){
 const roc=(Number(date.slice(0,4))-1911)+'/'+date.slice(5).replace('-', '/');
 const o={fields:market==='tse'?['日期','開盤指數','最高指數','最低指數','收盤指數']:['日期','開市','最高','最低','收市','漲/跌'],data:[[market==='tse'?roc:date.replace(/-/g,'/'),'100','110','90',String(close), '5'].slice(0,market==='tse'?5:6)]};
 const v={fields:market==='tse'?['日期','成交股數','成交金額','成交筆數','發行量加權股價指數','漲跌點數']:['日期','成交張數','金額（仟元）','筆數','櫃買指數','漲/跌'],data:[[roc,'1,000','20,000','20',String(close),'5']]};
 return market==='tse'?[{...o,stat:'OK'},{...v,stat:'OK'}]:[{tables:[o],stat:'ok'},{tables:[v],stat:'ok'}];
}
test('official monthly joins normalize ROC/AD dates, signed changes and TPEx thousand units',()=>{
 for(const m of ['tse','otc']){const b=parseIndexMonth(...pair(m),m,'2026-11')[0];assert.equal(b.date,'2026-11-20');assert.equal(b.volume,m==='tse'?1000:1000000);assert.equal(b.amount,m==='tse'?20000:20000000);assert.equal(b.change,5);}
});
test('partial dates, mismatched closes, duplicate/future dates, changed units and invalid candles cannot publish',()=>{
 for(const mutate of [p=>p[1].data[0][4]='106',p=>p[1].data=[],p=>p[0].data.push([...p[0].data[0]]),p=>p[0].data[0][2]='80',p=>p[1].fields[1]='成交張數',p=>p[1].data[0][1]='-5',p=>p[0].data[0][0]='115/02/30']){const p=pair('tse');mutate(p);assert.throws(()=>parseIndexMonth(...p,'tse','2026-11'));}
 const p=pair('tse','2099-11-20');assert.throws(()=>parseIndexMonth(...p,'tse','2099-11'));
});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'market-indices-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'market-indices.json');}
const load=async(url)=>{const m=url.includes('tpex.org')?'otc':'tse',p=pair(m);return p[/MI_5MINS|indexInfo/.test(url)?0:1];};
test('first publication validates both markets; partial failures retain original date/time and surface failure',async t=>{
 const output=fixture(t),options={output,load,now:stamp,months:['2026-11'],delayMs:0};
 const first=await updateMarketIndices(options);assert.equal(first.failures,0);assert.ok(validMarketSnapshot(first.snapshot));
 const next=await updateMarketIndices({...options,now:'2026-11-20T10:00:00Z',load:async u=>{if(u.includes('tpex.org'))throw Error('outage');return load(u);}});
 assert.equal(next.failures,1);assert.equal(next.snapshot.markets.otc.updatedAt,stamp);assert.match(next.snapshot.markets.otc.error,/outage/);
 const before=fs.readFileSync(output,'utf8');await assert.rejects(updateMarketIndices({...options,load:async()=>{throw Error('down');}}));assert.equal(fs.readFileSync(output,'utf8'),before);
 await assert.rejects(updateMarketIndices({...options,output:fixture(t),load:async u=>{if(u.includes('tpex.org'))throw Error('outage');return load(u);}}));
});
test('updates correct same-day records, retain history through month rollover and reject known stale source',async t=>{
 const output=fixture(t),options={output,load,now:stamp,months:['2026-11'],delayMs:0};await updateMarketIndices(options);
 let result=await updateMarketIndices({...options,load:async u=>{const m=u.includes('tpex.org')?'otc':'tse';return pair(m,'2026-11-20',106)[/MI_5MINS|indexInfo/.test(u)?0:1];}});assert.equal(result.snapshot.markets.tse.bars[0].close,106);
 await assert.rejects(updateMarketIndices({...options,load:async u=>{const m=u.includes('tpex.org')?'otc':'tse';return pair(m,'2026-11-19')[/MI_5MINS|indexInfo/.test(u)?0:1];}}));
 result=await updateMarketIndices({...options,now:'2026-11-21T09:00:00Z'});assert.match(result.snapshot.markets.tse.notice,/尚無今日資料/);
 await assert.rejects(updateMarketIndices({...options,closing:{markets:{tse:{quotes:[{date:'2026-11-21'}]},otc:{quotes:[{date:'2026-11-21'}]}}}}));
 const bad=structuredClone(result.snapshot);bad.markets.tse.bars[0].amount=-1;assert.equal(validMarketSnapshot(bad),false);
});
test('month-start no-data continues to previous month and later fills new month without losing history',async t=>{
 const output=fixture(t),oldDate='2026-10-30';
 const previous=async u=>{const m=u.includes('tpex.org')?'otc':'tse';return pair(m,oldDate)[/MI_5MINS|indexInfo/.test(u)?0:1];};
 await updateMarketIndices({output,load:previous,now:'2026-10-30T09:00:00Z',months:['2026-10'],delayMs:0});
 const result=await updateMarketIndices({output,now:'2026-11-01T09:00:00Z',delayMs:0,load:async u=>{
  if(/20261101|2026\/11\/01/.test(u))return u.includes('twse.com')?{stat:'很抱歉，沒有符合條件的資料!'}:{stat:'ok',tables:[]};return previous(u);
 }});
 assert.equal(result.failures,0);assert.equal(result.snapshot.markets.tse.bars[0].date,oldDate);assert.match(result.snapshot.markets.tse.notice,/尚無今日資料/);
 const next=await updateMarketIndices({output,now:stamp,delayMs:0,load:async u=>/20261101|2026\/11\/01/.test(u)?load(u):previous(u)});
 assert.deepEqual(next.snapshot.markets.tse.bars.map(b=>b.date),[oldDate,'2026-11-20']);
 const error={stat:'unexpected service error'};assert.throws(()=>parseIndexMonth(error,error,'tse','2026-11'));
});


