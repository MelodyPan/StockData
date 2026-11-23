const {supportedCode}=require('./stock-history-format.js');
function taipeiDay(value=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function validEventDate(value){return typeof value==='string'&&/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function validTime(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now()+300000;}
function validEvent(e){return !!e&&supportedCode(e.code)&&typeof e.name==='string'&&!!e.name.trim()&&e.name.length<=120&&validEventDate(e.date)&&['權','息','權息'].includes(e.type)&&['cashDividend','stockRatio','subscriptionRatio','subscriptionPrice'].every(k=>e[k]===null||(typeof e[k]==='number'&&Number.isFinite(e[k])&&e[k]>=0));}
function eventKey(e){return e.code+'|'+e.date;}
function validExDividendSnapshot(d){return !!d&&d.schemaVersion===1&&validTime(d.generatedAt)&&!!d.markets&&['tse','otc'].every(m=>{const v=d.markets[m];return !!v&&v.market===m&&(v.updatedAt===null||validTime(v.updatedAt))&&(v.error===null||typeof v.error==='string')&&(v.updatedAt!==null||!!v.error)&&Array.isArray(v.events)&&v.events.length<=20000&&v.events.every((e,i)=>validEvent(e)&&(!i||eventKey(e)>eventKey(v.events[i-1])))&&(v.updatedAt===null?v.events.length===0:Date.parse(v.updatedAt)<=Date.parse(d.generatedAt));});}
function nextExDividend(snapshot,market,code,today=taipeiDay()){
 if(!snapshot||!['tse','otc'].includes(market)||!supportedCode(code))return null;
 return snapshot.markets[market].events.filter(e=>e.code===code&&e.date>=today).sort((a,b)=>a.date.localeCompare(b.date))[0]||null;
}
module.exports={taipeiDay,validEventDate,validEvent,validExDividendSnapshot,nextExDividend,eventKey};
