const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSnapshot,writeSnapshot,updateStockData}=require('../scripts/update-stock-data.cjs');
const quote=(market,code)=>({code,name:code,market,date:'2026-11-05',close:100,change:null});
const market=(name,code)=>({quotes:[quote(name,code)],fetchedAt:'2026-11-06T08:00:00.000Z',error:null});
const data=()=>({markets:{tse:market('tse','2330'),otc:market('otc','8299')}});
const failed=()=>({quotes:[],fetchedAt:null,error:'offline'});

test('standalone updater prefers its checked-out snapshot over a stale remote fallback',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stock-local-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const output=path.join(directory,'closing-prices.json');
  const previous=createSnapshot(data());previous.markets.tse.quotes[0].date='2026-11-06';writeSnapshot(output,previous);
  let remoteCalls=0;
  const current=data();current.markets.otc=failed();
  const result=await updateStockData({output,provider:{getQuotes:async()=>current},loadPrevious:async()=>{remoteCalls++;return null;}});
  assert.equal(remoteCalls,0);assert.equal(result.markets.tse.quotes[0].date,'2026-11-06');
  assert.equal(result.markets.otc.fetchedAt,previous.markets.otc.fetchedAt);assert.ok(result.markets.otc.error);
});

test('missing or corrupt local snapshots fall back to published data',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stock-remote-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const output=path.join(directory,'closing-prices.json');
  for(const corrupt of [false,true]){
    if(corrupt)fs.writeFileSync(output,'{bad');
    let remoteCalls=0;const current=data();current.markets.otc=failed();
    const result=await updateStockData({output,provider:{getQuotes:async()=>current},loadPrevious:async()=>{remoteCalls++;return createSnapshot(data());}});
    assert.equal(remoteCalls,1);assert.equal(result.markets.otc.quotes[0].code,'8299');
  }
});
test('snapshot preserves actual dates and both markets and writes usable JSON atomically',t=>{
  const snapshot=createSnapshot(data(),null,'2026-11-06T09:00:00.000Z');
  assert.equal(snapshot.schemaVersion,1);assert.equal(snapshot.markets.tse.quotes[0].date,'2026-11-05');assert.equal(snapshot.generatedAt,'2026-11-06T09:00:00.000Z');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stock-snapshot-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const output=path.join(directory,'assets/data/closing-prices.json');writeSnapshot(output,snapshot);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),snapshot);assert.equal(fs.existsSync(output+'.tmp'),false);
});
test('one failing market keeps the previous dated quotes and indicates stale data',()=>{
  const previous=createSnapshot(data(),null),current=data();current.markets.otc=failed();current.markets.tse.quotes[0].close=200;
  const next=createSnapshot(current,previous);assert.equal(next.markets.tse.quotes[0].close,200);
  assert.equal(next.markets.otc.quotes[0].close,100);assert.equal(next.markets.otc.fetchedAt,'2026-11-06T08:00:00.000Z');assert.ok(next.markets.otc.error);
});
test('complete source failure or missing trustworthy fallback stops publication',()=>{
  const previous=createSnapshot(data(),null),current=data();current.markets.tse=failed();current.markets.otc=failed();
  assert.throws(()=>createSnapshot(current,previous),/更新失敗/);
  const partial=data();partial.markets.otc=failed();assert.throws(()=>createSnapshot(partial,null),/上櫃/);
  previous.markets.otc.quotes[0].date='2099-12-31';assert.throws(()=>createSnapshot(partial,previous),/上櫃/);
});

test('older official trading dates cannot roll back an already published market',()=>{
  const previous=createSnapshot(data(),null),current=data();previous.markets.tse.quotes[0].date='2026-11-06';
  const next=createSnapshot(current,previous);assert.equal(next.markets.tse.quotes[0].date,'2026-11-06');assert.ok(next.markets.tse.error);
});
