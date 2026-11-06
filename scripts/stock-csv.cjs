function parseTwseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (char !== ',') {
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        if (char === '\r' && text[index + 1] === '\n') index++;
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw Error('Invalid official CSV.');
      field += char;
    }
  }
  if (quoted) throw Error('Incomplete official CSV.');
  row.push(field);
  if (row.some(value => value !== '')) rows.push(row);
  const headers = (rows.shift() || []).map(value => value.replace(/^\uFEFF/, '').trim());
  const mapping = {Date:'日期', Code:'證券代號', Name:'證券名稱', ClosingPrice:'收盤價', Change:'漲跌價差'};
  if (Object.values(mapping).some(name => !headers.includes(name))) throw Error('Missing official CSV columns.');
  return rows.map(values => {
    if (values.length !== headers.length) throw Error('Incomplete official CSV row.');
    return Object.fromEntries(Object.entries(mapping).map(([key, name]) => [key, values[headers.indexOf(name)]]));
  });
}
module.exports = {parseTwseCsv};
