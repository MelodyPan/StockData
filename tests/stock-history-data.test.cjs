const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseHistoryDay,mergeBars,updateHistory}=require('../scripts/update-stock-history.cjs');
const day='2026-11-06';
const fields=['證券代號','證券名稱','開盤價','最高價','最低價','收盤價','成交股數'];
const payload=(data=[['2330','台積電','100','110','90','105','1,000']])=>({stat:'OK',date:'20261106',tables:[{fields,data}]});
const bar=(date=day,close=105)=>({date,open:100,high:110,low:90,close,volume:1000});
test('official tables parse real OHLC and shares, exclude warrants and skip nontrading OHLC without faking it',()=>{
 const rows=parseHistoryDay(payload([['2330','台積電','100','110','90','105','1,000'],['739999','權證','1','2','1','2','100'],['2317','鴻海','--','--','--','--','0']]),'tse',day);
 assert.equal(rows.closed,false);assert.deepEqual(rows.stocks,[{code:'2330',name:'台積電',bar:bar()}]);
 const otc={stat:'ok',date:'20261106',tables:[{fields:['代號','名稱','收盤','開盤','最高','最低','成交股數'],data:[['8299','群聯','105','100','110','90','1,000']]}]};
 assert.deepEqual(parseHistoryDay(otc,'otc',day).stocks[0],{code:'8299',name:'群聯',bar:bar()});
});
test('date mismatch, changed table schema, invalid prices/volume and duplicate codes cannot publish a bad day',()=>{
 assert.throws(()=>parseHistoryDay({...payload(),date:'20261105'},'tse',day));
 assert.throws(()=>parseHistoryDay({...payload(),tables:[]},'tse',day));
 for(const row of [['2330','台積電','100','95','90','105','100'],['2330','台積電','100','110','90','105','-1'],['2330','台積電','100','110','90','105','1.5']])assert.throws(()=>parseHistoryDay(payload([row]),'tse',day));
 assert.throws(()=>parseHistoryDay(payload([payload().tables[0].data[0],payload().tables[0].data[0]]),'tse',day));
 assert.throws(()=>parseHistoryDay({stat:'gateway error'},'tse',day));
});
test('only recognized official no-data responses mark a date closed',()=>{
 assert.equal(parseHistoryDay({stat:'很抱歉，沒有符合條件的資料!'},'tse',day).closed,true);
 const empty={stat:'ok',date:'20261106',tables:[{fields:['代號','名稱','收盤','開盤','最高','最低','成交股數'],data:[]}]};
 assert.equal(parseHistoryDay(empty,'otc',day).closed,true);assert.throws(()=>parseHistoryDay({stat:'ok',date:'20261106',tables:[]},'otc',day));
});
test('merging corrects dates, sorts and retains old sessions without mutating source',()=>{
 const old=[bar('2026-11-04'),bar('2026-11-05')],copy=JSON.stringify(old);
 assert.deepEqual(mergeBars(old,[bar('2026-11-05',106),bar()]).map(b=>[b.date,b.close]),[['2026-11-04',105],['2026-11-05',106],[day,105]]);assert.equal(JSON.stringify(old),copy);
});
test('updater retains published history on failure and coverage is per market; completed dates can resume',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stock-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=load=>updateHistory({root,dates:[day],load,delayMs:0});
 const result=await run(async(market)=>{if(market==='otc')throw Error('network');return payload();});
 assert.equal(result.failed,1);const filename=path.join(root,'tse','2330.json'),before=fs.readFileSync(filename,'utf8');
 await run(async()=>{throw Error('network')});assert.equal(fs.readFileSync(filename,'utf8'),before);
 const meta=JSON.parse(fs.readFileSync(path.join(root,'index.json')));assert.equal(meta.coverage.tse[day],'data');assert.equal(meta.coverage.otc[day],undefined);
});
