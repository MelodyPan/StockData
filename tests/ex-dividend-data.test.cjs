const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {parseAnnouncements,updateExDividends}=require('../scripts/update-ex-dividends.cjs');
const {validExDividendSnapshot,nextExDividend,taipeiDay}=require('../shared/ex-dividend-format.js');
const row=(code='2330',date='1151217')=>({Date:date,Code:code,Name:'台積電',Exdividend:'息',StockDividendRatio:'',SubscriptionRatio:'',SubscriptionPricePerShare:'',CashDividend:'6.00'});
const otc=()=>({ExRrightsExDividendDate:'1160105',SecuritiesCompanyCode:'5483',CompanyName:'中美晶',ExRrightsExDividend:'除權息',StockDividendRatio:'0.1',SubscriptionRatioToNewSharesIssued:'0.2',SubscriptionPricePerShare:'50.00',CashDividend:'0.00000000'});
function output(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ex-dividend-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'ex-dividends.json');}
const now='2026-11-23T10:00:00.000Z';
test('official announcements preserve null and zero, normalize ROC dates and raw ratios',()=>{
 const a=parseAnnouncements([row()], 'tse')[0];assert.equal(a.date,'2026-12-17');assert.equal(a.cashDividend,6);assert.equal(a.stockRatio,null);assert.equal(a.type,'息');
 const b=parseAnnouncements([otc()],'otc')[0];assert.equal(b.date,'2027-01-05');assert.equal(b.cashDividend,0);assert.equal(b.stockRatio,.1);assert.equal(b.subscriptionRatio,.2);assert.equal(b.subscriptionPrice,50);assert.equal(b.type,'權息');
 assert.equal(parseAnnouncements([{...row(),CashDividend:''}],'tse')[0].cashDividend,null);
 assert.equal(parseAnnouncements([{...row(),CashDividend:'尚未公告'}],'tse')[0].cashDividend,null);
 assert.equal(parseAnnouncements([{...otc(),SubscriptionPricePerShare:'註4'}],'otc')[0].subscriptionPrice,null);
 for(const bad of [{Date:'1150230'},{Code:'../a'},{CashDividend:'--'},{StockDividendRatio:'-0.1'},{Exdividend:'未知'},{Date:'99999999'}])assert.throws(()=>parseAnnouncements([{...row(),...bad}],'tse'));
 assert.throws(()=>parseAnnouncements([row(),row()],'tse'));assert.throws(()=>parseAnnouncements({},'tse'));assert.throws(()=>parseAnnouncements([{...row(),StockDividendRatio:undefined}],'tse'));
 assert.deepEqual(parseAnnouncements([],'tse'),[]);
});
test('updater replaces withdrawals, keeps only failed market, and rejects all-market failures atomically',async t=>{
 const file=output(t);let tse=[row()],otcRows=[otc()],failed=new Set();const load=async url=>{const m=url.includes('twse')?'tse':'otc';if(failed.has(m))throw Error('offline');return m==='tse'?tse:otcRows;};
 let r=await updateExDividends({output:file,load,now,delayMs:0});assert.equal(r.failures,0);assert.ok(validExDividendSnapshot(r.snapshot));assert.equal(nextExDividend(r.snapshot,'tse','2330','2026-12-17').cashDividend,6);assert.equal(nextExDividend(r.snapshot,'tse','2330','2026-12-18'),null);assert.equal(nextExDividend(r.snapshot,'otc','2330','2026-11-23'),null);
 const future=structuredClone(r.snapshot);future.generatedAt='2099-01-01T00:00:00Z';assert.equal(validExDividendSnapshot(future),false);
 tse=[];r=await updateExDividends({output:file,load,now,delayMs:0});assert.equal(r.snapshot.markets.tse.events.length,0);assert.equal(nextExDividend(r.snapshot,'tse','2330','2026-11-23'),null);
 failed.add('otc');tse=[row('2317')];r=await updateExDividends({output:file,load,now:'2026-11-23T10:01:00.000Z',delayMs:0});assert.equal(r.failures,1);assert.equal(r.snapshot.markets.otc.events.length,1);assert.match(r.snapshot.markets.otc.error,/offline/);assert.equal(r.snapshot.markets.otc.updatedAt,now);assert.equal(r.snapshot.markets.tse.events[0].code,'2317');
 const saved=fs.readFileSync(file,'utf8');failed.add('tse');await assert.rejects(updateExDividends({output:file,load,now,delayMs:0}));assert.equal(fs.readFileSync(file,'utf8'),saved);
});
test('next event uses Taiwan day and earliest date without confusing missing numbers with zero',async t=>{
 assert.equal(taipeiDay('2026-11-23T16:00:00.000Z'),'2026-11-24');
 const file=output(t),r=await updateExDividends({output:file,now,delayMs:0,load:async url=>url.includes('twse')?[row('2330','1151220'),row('2330','1151217')]:[]});
 assert.equal(nextExDividend(r.snapshot,'tse','2330','2026-12-01').date,'2026-12-17');assert.equal(nextExDividend(r.snapshot,'tse','2330','2026-12-18').date,'2026-12-20');assert.equal(nextExDividend(r.snapshot,'tse','9999','2026-12-01'),null);
});

test('initial partial outage is unknown rather than a successful empty market',async t=>{
 const r=await updateExDividends({output:output(t),now,delayMs:0,load:async url=>{if(url.includes('twse'))throw Error('offline');return [];}});
 assert.equal(r.failures,1);assert.equal(r.snapshot.markets.tse.updatedAt,null);assert.ok(r.snapshot.markets.tse.error);assert.deepEqual(r.snapshot.markets.otc.events,[]);assert.equal(r.snapshot.markets.otc.error,null);
});

test('common and preferred shares use the same canonical order in updater and validator',async t=>{
 const r=await updateExDividends({output:output(t),now,delayMs:0,load:async url=>url.includes('twse')?[row('2881'),row('2881A')]:[]});
 assert.ok(validExDividendSnapshot(r.snapshot));assert.deepEqual(r.snapshot.markets.tse.events.map(e=>e.code),['2881A','2881']);
});
