const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseTwseCsv}=require('../scripts/stock-csv.cjs');
test('official CSV maps real dates and prices, handles quoted commas and escaped quotes',()=>{
  const csv='\uFEFF日期,證券代號,證券名稱,收盤價,漲跌價差\r\n"1151106","2330","台積電","2,200.00","-40.0000"\r\n"1151106","2887Z1","名稱,""特別股""","--","0.00"\r\n';
  assert.deepEqual(parseTwseCsv(csv),[{Date:'1151106',Code:'2330',Name:'台積電',ClosingPrice:'2,200.00',Change:'-40.0000'},{Date:'1151106',Code:'2887Z1',Name:'名稱,"特別股"',ClosingPrice:'--',Change:'0.00'}]);
});
test('incomplete CSV or missing official columns cannot replace cached prices',()=>{
  assert.throws(()=>parseTwseCsv('日期,證券代號\n1151106,2330'),/CSV/);
  assert.throws(()=>parseTwseCsv('日期,證券代號,證券名稱,收盤價,漲跌價差\n"1151106'),/CSV/);
  assert.throws(()=>parseTwseCsv('日期,證券代號,證券名稱,收盤價,漲跌價差\n1151106,2330'),/CSV/);
});
