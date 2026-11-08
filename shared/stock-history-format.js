const supportedCode=code=>typeof code==='string'&&/^(?:\d{4}|\d{4}[A-Z][A-Z0-9]{0,2}|0\d{4,5}[A-Z]?)$/.test(code);
const taipeiDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
function validDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const value=new Date(date);return Number.isFinite(value.getTime())&&value.toISOString().slice(0,10)===date&&date<=taipeiDate.format(new Date());
}
function validBar(bar){return !!bar&&validDate(bar.date)&&['open','high','low','close'].every(key=>typeof bar[key]==='number'&&Number.isFinite(bar[key])&&bar[key]>0)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=Math.max(bar.open,bar.close)&&bar.high>=bar.low&&Number.isSafeInteger(bar.volume)&&bar.volume>=0;}
function validHistory(value,code,market){return !!value&&value.schemaVersion===1&&supportedCode(value.code)&&value.code===code&&['tse','otc'].includes(value.market)&&value.market===market&&typeof value.name==='string'&&!!value.name.trim()&&typeof value.updatedAt==='string'&&Number.isFinite(Date.parse(value.updatedAt))&&Array.isArray(value.bars)&&value.bars.length>0&&value.bars.length<=2000&&value.bars.every((bar,i)=>validBar(bar)&&(!i||bar.date>value.bars[i-1].date));}
module.exports={supportedCode,validDate,validBar,validHistory};
