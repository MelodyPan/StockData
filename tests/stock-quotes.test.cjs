const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {normalizeQuotes, createQuoteProvider, createStockHandler} = require('../scripts/stock-quotes.cjs');
const tse = [{Date:'1151105',Code:'2330',Name:'台積電',ClosingPrice:'1,000.50',Change:'-20.00'}];
const otc = [{Date:'1151105',SecuritiesCompanyCode:'8299',CompanyName:'群聯',Close:'650.00',Change:'+5.00'}];

test('official market fields become dated quotes; blank prices never become zero', () => {
  assert.deepEqual(normalizeQuotes(tse,'tse'), [{code:'2330',name:'台積電',market:'tse',date:'2026-11-05',close:1000.5,change:-20}]);
  assert.equal(normalizeQuotes(otc,'otc')[0].close,650);
  for (const value of ['',null,'--','NaN']) assert.equal(normalizeQuotes([{...tse[0],ClosingPrice:value}],'tse')[0].close,null);
  assert.equal(normalizeQuotes([{...tse[0],Date:'1150230'}],'tse').length,0);
  assert.equal(normalizeQuotes([{...tse[0],Date:'broken'}],'tse').length,0);
});

test('provider shares concurrent requests and caches each market independently', async () => {
  let calls=0, time=1000;
  const provider=createQuoteProvider({now:()=>time,ttl:100,fetchJson:async url=>{calls++;return url.includes('twse')?tse:otc;}});
  const [a,b]=await Promise.all([provider.getQuotes(),provider.getQuotes()]);
  assert.equal(a.markets.tse.quotes[0].close,1000.5); assert.deepEqual(a,b); assert.equal(calls,2);
  await provider.getQuotes(); assert.equal(calls,2);
  time=1200; await provider.getQuotes(); assert.equal(calls,4);
});

test('one failed or malformed market keeps stale quotes without erasing healthy data', async () => {
  let fail=false,time=1000;
  const provider=createQuoteProvider({now:()=>time,ttl:10,fetchJson:async url=>url.includes('twse')?(fail?{error:'bad'}:tse):otc});
  await provider.getQuotes();fail=true;time=2000;
  const data=await provider.getQuotes();
  assert.equal(data.markets.tse.quotes[0].code,'2330'); assert.ok(data.markets.tse.error);
  assert.equal(data.markets.tse.fetchedAt,'1970-01-01T00:00:01.000Z');
  assert.equal(data.markets.otc.error,null);
  const offline=createQuoteProvider({fetchJson:async()=>{throw Error('offline');}});
  const empty=await offline.getQuotes();assert.deepEqual(empty.markets.tse.quotes,[]);assert.ok(empty.markets.otc.error);
});

test('local API serves only the fixed GET route and rejects foreign origins', async t => {
  const server=http.createServer(createStockHandler(createQuoteProvider({fetchJson:async url=>url.includes('twse')?tse:otc})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await(await fetch(base+'/api/stock/quotes')).json()).markets.otc.quotes[0].code,'8299');
  assert.equal((await fetch(base+'/api/stock/quotes',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/stock/quotes',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(base+'/api/stock/quotes?url=https://example.com')).status,404);
  assert.equal((await fetch(base+'/other')).status,404);
});

test('partly malformed refresh must not erase cached stocks or report success', async () => {
  let broken=false,time=1000;
  const provider=createQuoteProvider({now:()=>time,ttl:10,fetchJson:async url=>url.includes('twse')?
    [tse[0],{...tse[0],Code:'2317',Date:broken?'1150230':'1151105'}]:otc});
  await provider.getQuotes();broken=true;time=2000;
  const result=await provider.getQuotes();
  assert.equal(result.markets.tse.quotes.length,2);assert.ok(result.markets.tse.error);
});

test('official preferred share code 2887Z1 does not invalidate the whole listed market', async () => {
  const provider=createQuoteProvider({fetchJson:async url=>url.includes('twse')?[...tse,{...tse[0],Code:'2887Z1',Name:'台新新光己特'}]:otc});
  const result=await provider.getQuotes();
  assert.equal(result.markets.tse.error,null);assert.equal(result.markets.tse.quotes[1].code,'2887Z1');
});

test('manual force refresh bypasses TTL while simultaneous clicks share one official request',async()=>{
  let calls=0;const provider=createQuoteProvider({fetchJson:async url=>{calls++;return url.includes('twse')?tse:otc;}});
  await provider.getQuotes();await provider.getQuotes();assert.equal(calls,2);
  await Promise.all([provider.getQuotes({force:true}),provider.getQuotes({force:true})]);assert.equal(calls,4);
});
