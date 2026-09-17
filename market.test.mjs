// Bộ test của phần biết về giá: chuẩn hoá, câu chữ, cái sàng mã, và bộ nhớ vài giây.
//
// Không có mạng ở đây. Mọi thứ nhận nguồn giá qua tham số, nên bộ test dựng một nguồn giả và
// đếm xem nó bị gọi mấy lần — đó là cách duy nhất kiểm được hai thứ vô hình: bot **không** hỏi
// lại feed khi vừa hỏi xong, và bot **không** nói gì khi lệnh không phải của nó.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, line, missing, reply, money, count, sessionNote, SHARES_PER_LOT,
} from './market/quote.mjs';
import { withCache } from './market/vps.mjs';
import { looksLikeCode, tokensIn, makeGuard } from './market/symbols.mjs';
import { sectorsOf, vndirectSectors } from './market/sectors.mjs';
import {
  boardDetail, companyCard, companyCards, companyEntities, companyOf, plainText, vietcapCompany,
} from './market/company.mjs';
import { dailyHistory, dailyRows } from './market/chart.mjs';

const VIC = {
  sym: 'VIC', r: 244.5, c: 261.6, f: 227.4,
  lastPrice: 256.1, lot: 751860,
  openPrice: '244.7', highPrice: '260.0', lowPrice: '244.7', avePrice: '255.12',
};

test('bản ghi thô thành một cái giá', () => {
  const quote = normalize(VIC);
  assert.equal(quote.symbol, 'VIC');
  assert.equal(quote.price, 256.1);
  assert.equal(quote.reference, 244.5);
  assert.equal(quote.change, 11.6);       // tính lại, không đọc của feed
  assert.equal(quote.percent, 4.74);
  assert.equal(quote.traded, true);
});

test('khối lượng là cổ phiếu, không phải lô', () => {
  // Cái sai gấp mười này không nhìn thấy bằng mắt: con số vẫn hợp lý, chỉ ít đi một chữ số.
  assert.equal(SHARES_PER_LOT, 10);
  assert.equal(normalize(VIC).volume, 7518600);
});

test('chưa khớp lệnh nào thì nói vậy, không nói giá bằng không', () => {
  const quote = normalize({ ...VIC, lastPrice: 0, lot: 0 });
  assert.equal(quote.traded, false);
  assert.equal(quote.price, 244.5);       // lấy tham chiếu làm chỗ đứng
  assert.equal(quote.change, 0);
  assert.match(line(quote), /^VIC — chưa khớp · TC 244,5$/);
});

test('một mã là một dòng', () => {
  assert.equal(line(normalize(VIC)), 'VIC 256,1 ▲ +4,74% · KL 7.518.600');
});

test('giảm giá thì mũi tên và dấu đều đổi chiều', () => {
  const down = normalize({ ...VIC, lastPrice: 240.0 });
  assert.equal(down.change, -4.5);
  assert.match(line(down), /▼ -1,84%/);
});

test('đứng giá không mang dấu', () => {
  const flat = normalize({ ...VIC, lastPrice: 244.5 });
  assert.match(line(flat), /▬ 0%/);
});

test('trần và sàn được gọi tên, vì trong chat không có màu', () => {
  assert.match(line(normalize({ ...VIC, lastPrice: 261.6 })), /TRẦN/);
  assert.match(line(normalize({ ...VIC, lastPrice: 227.4 })), /SÀN/);
  assert.doesNotMatch(line(normalize(VIC)), /TRẦN|SÀN/);
});

test('số viết theo lối tiếng Việt', () => {
  assert.equal(money(256.1), '256,1');
  assert.equal(money(21.65), '21,65');
  assert.equal(count(7518600), '7.518.600');
});

test('phiên giao dịch suy từ đồng hồ Việt Nam, không từ đồng hồ máy chủ', () => {
  const vn = (iso) => new Date(iso);                      // giờ ghi ở đây là UTC, VN = UTC+7
  assert.equal(sessionNote(vn('2026-09-07T03:00:00Z')), null);              // 10:00 thứ Hai
  assert.equal(sessionNote(vn('2026-09-07T07:00:00Z')), null);              // 14:00 thứ Hai
  assert.match(sessionNote(vn('2026-09-07T05:00:00Z')), /nghỉ trưa/);       // 12:00
  assert.match(sessionNote(vn('2026-09-07T09:00:00Z')), /đóng cửa/);        // 16:00
  assert.match(sessionNote(vn('2026-09-07T01:00:00Z')), /đóng cửa/);        // 08:00
  assert.match(sessionNote(vn('2026-09-05T03:00:00Z')), /Cuối tuần/);       // thứ Bảy
});

test('câu trả lời là một tin nhắn, theo đúng thứ tự đã hỏi', () => {
  const text = reply([normalize(VIC)], ['VIC', 'ZZZ'], new Date('2026-09-07T03:00:00Z'));
  assert.equal(text, 'VIC 256,1 ▲ +4,74% · KL 7.518.600\nZZZ — không có dữ liệu');
  assert.equal(missing('ZZZ'), 'ZZZ — không có dữ liệu');
});

test('lúc sàn đóng thì câu trả lời tự nói ra', () => {
  const text = reply([normalize(VIC)], ['VIC'], new Date('2026-09-07T09:00:00Z'));
  assert.match(text.split('\n').at(-1), /đóng cửa/);
});

// ---- cái sàng -------------------------------------------------------------------------------

test('hình dạng một mã', () => {
  for (const yes of ['VIC', 'HPG', 'FUEVFVND', 'E1VFVN30']) assert.ok(looksLikeCode(yes), yes);
  for (const no of ['VI', '1VIC', 'X', 'TIEN-LEN', '']) assert.ok(!looksLikeCode(no), no);
});

test('tách mã khỏi một câu, giữ thứ tự và bỏ trùng', () => {
  assert.deepEqual(tokensIn('vic, hpg / vic'), ['VIC', 'HPG']);
  assert.deepEqual(tokensIn(null), []);
});

function stubMarket({ listed = ['VIC', 'HPG'], has = [] } = {}) {
  const calls = { quotes: [], universe: 0 };
  return {
    calls,
    async universe() { calls.universe += 1; return listed; },
    async quotes(symbols) {
      calls.quotes.push(symbols);
      return symbols
        .filter((symbol) => listed.includes(symbol) || has.includes(symbol))
        .map((symbol) => normalize({ ...VIC, sym: symbol }));
    },
  };
}

test('mã niêm yết thì hỏi thẳng, không dò', async () => {
  const market = stubMarket();
  const guard = makeGuard({ market });
  assert.deepEqual(await guard.candidates(['VIC', 'HPG']), ['VIC', 'HPG']);
});

test('chữ không giống mã thì bị loại mà không tốn một lượt mạng nào', async () => {
  const guard = makeGuard({ market: stubMarket() });
  assert.deepEqual(await guard.candidates(['DI', 'ĂN', '123']), []);
});

test('lệnh của bot khác được dò đúng một lần rồi im mãi', async () => {
  // Đây là cái luật giữ cho bot không bị đá khỏi phòng: `/tienlen` tới cả ba con bot trong
  // phòng, và con bot giá phải học được rằng đó không phải việc của mình.
  const guard = makeGuard({ market: stubMarket() });
  assert.deepEqual(await guard.candidates(['TIENLEN']), ['TIENLEN']);   // lần đầu: dò thử
  guard.remember('TIENLEN', false);
  assert.deepEqual(await guard.candidates(['TIENLEN']), []);            // và không bao giờ nữa
});

test('chứng chỉ quỹ không có trong danh sách ba sàn vẫn vào được, qua một lần dò', async () => {
  const guard = makeGuard({ market: stubMarket({ has: ['FUEVFVND'] }) });
  assert.deepEqual(await guard.candidates(['FUEVFVND']), ['FUEVFVND']);
  guard.remember('FUEVFVND', true);
  assert.deepEqual(await guard.candidates(['FUEVFVND']), ['FUEVFVND']);
});

test('trí nhớ về một lần dò cũng cũ đi', async () => {
  let clock = 0;
  const guard = makeGuard({ market: stubMarket(), now: () => clock, probeTtlMs: 100 });
  guard.remember('ZZZ', false);
  assert.deepEqual(await guard.candidates(['ZZZ']), []);
  clock = 1000;
  assert.deepEqual(await guard.candidates(['ZZZ']), ['ZZZ']);   // đủ lâu thì hỏi lại
});

test('mất danh sách niêm yết thì bot chậm hơn, không câm', async () => {
  const broken = {
    async universe() { throw new Error('sàn không trả lời'); },
    async quotes(symbols) { return symbols.map((symbol) => normalize({ ...VIC, sym: symbol })); },
  };
  const guard = makeGuard({ market: broken });
  assert.deepEqual(await guard.candidates(['VIC']), ['VIC']);
});

test('danh sách niêm yết chỉ lấy một lần cho tới khi cũ', async () => {
  const market = stubMarket();
  const guard = makeGuard({ market, universeTtlMs: 10_000, now: () => 0 });
  await Promise.all([guard.candidates(['VIC']), guard.candidates(['HPG']), guard.candidates(['VIC'])]);
  assert.equal(market.calls.universe, 1);
});

// ---- bộ nhớ vài giây ------------------------------------------------------------------------

test('hỏi lại ngay thì lấy trong trí nhớ, không nện vào feed của người ta', async () => {
  let clock = 0;
  const market = stubMarket();
  const cached = withCache(market, { ttlMs: 5000, now: () => clock });

  await cached.quotes(['VIC']);
  await cached.quotes(['VIC']);
  assert.equal(market.calls.quotes.length, 1);

  // Mã thứ hai chưa có thì chỉ hỏi mã thứ hai, không hỏi lại cả hai.
  await cached.quotes(['VIC', 'HPG']);
  assert.deepEqual(market.calls.quotes.at(-1), ['HPG']);

  clock = 6000;
  await cached.quotes(['VIC']);
  assert.deepEqual(market.calls.quotes.at(-1), ['VIC']);   // đủ cũ thì hỏi lại thật
});

// ---- DNSE ------------------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { kindOf, rfc1123, signature, dnseChart, dnse } from './market/dnse.mjs';
import { chain } from './market/chain.mjs';

test('loại mã đoán từ chính cái mã', () => {
  assert.equal(kindOf('vic'), 'stock');
  assert.equal(kindOf('FUEVFVND'), 'stock');
  assert.equal(kindOf('VN30F2609'), 'derivative');
  assert.equal(kindOf('VNINDEX'), 'index');
  assert.equal(kindOf('VN30'), 'index');          // chỉ số, dù trông như một mã ba chữ
});

test('ngày ký viết đuôi +0000, không phải GMT', () => {
  // Hai cách viết cùng một thời điểm, và chữ ký chỉ băm đúng chuỗi được gửi đi. Lệch là 401,
  // và cái 401 ấy không nói vì sao — nên nó được ghim ở đây.
  assert.equal(rfc1123(new Date('2026-09-07T03:04:05Z')), 'Mon, 07 Sep 2026 03:04:05 +0000');
});

test('chữ ký ký đúng chuỗi DNSE đợi', () => {
  const date = 'Mon, 07 Sep 2026 03:04:05 +0000';
  const header = signature({
    method: 'GET', path: '/price/VIC/secdef', key: 'k', secret: 's', date, nonce: 'n1',
  });

  const expected = encodeURIComponent(createHmac('sha256', 's')
    .update(`(request-target): get /price/VIC/secdef\ndate: ${date}\nnonce: n1`, 'utf8')
    .digest('base64'));

  assert.match(header, /^Signature keyId="k",algorithm="hmac-sha256",/);
  assert.match(header, /headers="\(request-target\) date"/);   // nonce KHÔNG được kể ở đây
  assert.ok(header.includes(`signature="${expected}"`), header);
  assert.ok(header.endsWith(',nonce="n1"'));
});

function stubFetch(routes) {
  const asked = [];
  return {
    asked,
    async fetch(url) {
      asked.push(url);
      const answer = Object.entries(routes).find(([part]) => url.includes(part))?.[1];
      if (!answer) return { ok: false, status: 404, async json() { return {}; } };
      return { ok: true, status: 200, async json() { return answer; } };
    },
  };
}

const CANDLES = { t: [1, 2], o: [1650, 1660], h: [1670, 1680], l: [1640, 1650], c: [1655.5, 1670.2], v: [100, 250] };

test('nến ngày thành một cái giá, phiên trước làm tham chiếu', async () => {
  const stub = stubFetch({ 'symbol=VNINDEX': CANDLES });
  const [one] = await dnseChart({ fetchImpl: stub.fetch }).quotes(['vnindex']);

  assert.equal(one.symbol, 'VNINDEX');
  assert.equal(one.price, 1670.2);
  assert.equal(one.reference, 1655.5);
  assert.equal(one.change, 14.7);
  assert.equal(one.percent, 0.89);
  assert.equal(one.volume, 250);
  assert.match(stub.asked[0], /ohlcs\/index\?/);        // đúng đường của chỉ số
});

test('mã nguồn này không có thì nó nói không có, chứ không dựng ra một cái giá rỗng', async () => {
  const stub = stubFetch({ 'symbol=ZZZ': { status: 400, code: 'BAD_REQUEST' } });
  assert.deepEqual(await dnseChart({ fetchImpl: stub.fetch }).quotes(['ZZZ']), []);
});

test('không có khoá thì vẫn có giá, chỉ là không có trần sàn', async () => {
  const stub = stubFetch({ 'symbol=VIC': CANDLES });
  const source = dnse({ fetchImpl: stub.fetch, key: '', secret: '' });
  const [one] = await source.quotes(['VIC']);
  assert.equal(one.price, 1670.2);
  assert.equal(one.ceiling, 0);
  assert.ok(!stub.asked.some((url) => url.includes('secdef')));   // và không gọi đường có khoá
});

test('có khoá thì tham chiếu chính thức thay chỗ giá đóng cửa hôm trước', async () => {
  // Đây là cả lý do tầng có khoá tồn tại: ngày chốt quyền, tham chiếu được điều chỉnh và không
  // còn bằng giá đóng cửa phiên trước. Thiếu nó, một mã đứng giá hiện lên là giảm mấy phần trăm.
  const stub = stubFetch({
    'symbol=VIC': CANDLES,
    'secdef': [{ boardId: 'G1', basicPrice: 1670.2, ceilingPrice: 1787, floorPrice: 1553.4 }],
  });
  const [one] = await dnse({ fetchImpl: stub.fetch, key: 'k', secret: 's' }).quotes(['VIC']);

  assert.equal(one.reference, 1670.2);
  assert.equal(one.change, 0);
  assert.equal(one.percent, 0);
  assert.equal(one.ceiling, 1787);
});

test('tầng có khoá hỏng thì cái giá vẫn đi tiếp', async () => {
  const stub = stubFetch({ 'symbol=VIC': CANDLES });   // secdef trả 404
  const [one] = await dnse({ fetchImpl: stub.fetch, key: 'k', secret: 's' }).quotes(['VIC']);
  assert.equal(one.price, 1670.2);
});

// ---- dây nguồn --------------------------------------------------------------------------------

function source(name, { has = [], broken = false } = {}) {
  const calls = [];
  return {
    calls,
    name,
    async universe() { return has; },
    async quotes(symbols) {
      calls.push(symbols);
      if (broken) throw new Error(`${name} không trả lời`);
      return symbols.filter((s) => has.includes(s)).map((s) => normalize({ ...VIC, sym: s }));
    },
  };
}

test('nguồn đầu đủ thì nguồn sau không bị đụng tới', async () => {
  const first = source('a', { has: ['VIC'] });
  const second = source('b', { has: ['VIC'] });
  await chain(first, second).quotes(['VIC']);
  assert.deepEqual(second.calls, []);
});

test('mã nguồn đầu không có thì rơi xuống nguồn sau, và chỉ mã ấy rơi', async () => {
  const first = source('a', { has: ['VIC'] });
  const second = source('b', { has: ['VNINDEX'] });
  const got = await chain(first, second).quotes(['VIC', 'VNINDEX']);

  assert.deepEqual(got.map((one) => one.symbol).sort(), ['VIC', 'VNINDEX']);
  assert.deepEqual(second.calls, [['VNINDEX']]);
});

test('nguồn đầu chết thì mọi thứ rơi xuống nguồn sau, không ai biết', async () => {
  const got = await chain(source('a', { broken: true }), source('b', { has: ['VIC'] })).quotes(['VIC']);
  assert.equal(got.length, 1);
});

test('mọi nguồn cùng chết thì phải ném, vì im lặng lúc này là nói dối', async () => {
  // Không ném thì bot trả về "không có dữ liệu" — người hỏi tưởng mã mình gõ không tồn tại,
  // trong khi thứ hỏng là cả dây nguồn.
  await assert.rejects(
    chain(source('a', { broken: true }), source('b', { broken: true })).quotes(['VIC']),
    /không trả lời/,
  );
});

test('mã không nguồn nào có thì không phải là lỗi', async () => {
  assert.deepEqual(await chain(source('a'), source('b')).quotes(['ZZZ']), []);
});

// ---- bảng ngành ------------------------------------------------------------------------------

const ICB = [
  { vietnameseName: 'Dầu khí', codeList: 'BSR,PVC,PVD,PVS,PLX,OIL' },
  { vietnameseName: 'Bất động sản', codeList: 'VIC,VHM,VGC,VCG' },
  { vietnameseName: 'Hàng hóa và dịch vụ công nghiệp', codeList: 'PVT,HAH,GEX' },
  { vietnameseName: 'Dịch vụ tiện ích', codeList: 'GAS,POW' },
  { vietnameseName: '', codeList: 'ZZZ' },
];

test('phân ngành ICB thành bảng mã → ngành, mã trùng thì lần đầu thắng', () => {
  const sectors = sectorsOf([...ICB, { vietnameseName: 'Tài chính', codeList: 'VGC,VCG' }]);

  assert.equal(sectors.get('BSR'), 'Dầu khí');
  assert.equal(sectors.get('VIC'), 'Bất động sản');
  assert.equal(sectors.get('VGC'), 'Bất động sản');   // không bị ngành kể sau giành mất
  assert.equal(sectors.get('ZZZ'), undefined);        // ngành không tên thì không phải một ngành
  assert.equal(sectors.get('KHONGCO'), undefined);
});

test('mã mà bảng điện Việt Nam đọc khác ICB thì ghi đè', () => {
  // ICB nhìn việc doanh nghiệp làm: PVT chở dầu bằng tàu nên thành vận tải, GAS phân phối khí nên
  // thành tiện ích. Người ngồi trước bảng giá nhìn họ nhà: cả hai lên xuống theo giá dầu.
  const sectors = sectorsOf(ICB);
  assert.equal(sectors.get('PVT'), 'Dầu khí');
  assert.equal(sectors.get('GAS'), 'Dầu khí');
  assert.equal(sectors.get('HAH'), 'Hàng hóa và dịch vụ công nghiệp');   // không đụng mã khác
});

test('bảng ngành hỏi một lần rồi nhớ, nguồn chết thì trả bảng rỗng chứ không ném', async () => {
  let asked = 0;
  const source = vndirectSectors({
    async fetchImpl() {
      asked += 1;
      return new Response(JSON.stringify({ data: ICB }));
    },
  });
  assert.equal((await source.map()).get('BSR'), 'Dầu khí');
  await source.map();
  assert.equal(asked, 1);

  const dead = vndirectSectors({ async fetchImpl() { throw new Error('mạng hỏng'); } });
  assert.equal((await dead.map()).size, 0);   // bản đồ vẫn vẽ được, cả thị trường vào nhóm "Khác"
});

// ---- hồ sơ doanh nghiệp ----------------------------------------------------------------------

const VIETCAP_VIC = {
  ticker: 'VIC', organCode: 'VIC', comGroupCode: 'VNINDEX',
  viOrganName: 'Tập đoàn Vingroup - Công ty CP',
  enOrganName: 'VinGroup Joint Stock Company',
  sectorVn: 'Bất động sản',
  marketCap: 1873015585317700, issueShare: 7762186429,
  maximumForeignPercentage: 0.48017596, foreignerPercentage: 0.03152865, freeFloatPercentage: 0.2999999999,
  listingDate: '2007-09-19T00:00:00',
  lowestPrice1Year: 66700, highestPrice1Year: 265000, averageMatchVolume1Month: 6071050,
  profile: '<div style="FONT-FAMILY: Arial;">T&#7853;p đo&agrave;n Vingroup - C&ocirc;ng ty Cổ phần (VIC)&nbsp;th&agrave;nh lập năm 2002.</div>',
};

test('bản ghi Vietcap thành hồ sơ doanh nghiệp', () => {
  const profile = companyOf(VIETCAP_VIC);
  assert.equal(profile.symbol, 'VIC');
  assert.equal(profile.exchange, 'HOSE');
  assert.equal(profile.foreignRoom, 48);
  assert.equal(profile.foreignHeld, 3.2);
  assert.equal(profile.low52, 66.7);            // giá của nguồn tính bằng đồng, bot nói nghìn đồng
  assert.equal(profile.listed, '19/09/2007');   // đọc thẳng từ chuỗi, không lùi một ngày vì múi giờ

  // Mã tổ chức không phải ticker — ACV là `ACVN` — nên hồ sơ nhận nhau bằng `ticker`, không bằng nó.
  assert.equal(companyOf({ organCode: 'ACVN', viOrganName: 'Cảng Hàng không' }), null);
  assert.equal(companyOf(null), null);
});

test('mô tả HTML của nguồn thành chữ đọc được', () => {
  assert.equal(plainText('<div>C&ocirc;ng ty&nbsp;Technocom</div>'), 'Công ty Technocom');
  assert.equal(plainText('T&#7853;p đo&agrave;n'), 'Tập đoàn');      // dấu thanh đi bằng thực thể số
  assert.equal(plainText('&Ocirc;ng &amp; b&agrave;'), 'Ông & bà');   // chữ hoa suy từ chữ thường
  assert.equal(plainText('<script>alert(1)</script>xin chào'), 'xin chào');
  assert.equal(plainText('<p>một</p><p>hai</p>'), 'một hai');
});

test('thẻ hồ sơ không kê dòng mà nguồn không có', () => {
  // Một thẻ ghi "Vốn hoá: —" trông như số liệu hỏng, trong khi sự thật là nguồn không nói.
  const card = companyCard(companyOf({ ...VIETCAP_VIC, marketCap: null, sectorVn: '' }));
  const labels = card.rows.map(([label]) => label);
  assert.equal(labels.includes('Vốn hoá'), false);
  assert.equal(labels.includes('Ngành'), false);
  assert.ok(labels.includes('Sàn'));
  assert.equal(companyCard(null), null);

  const full = companyCard(companyOf(VIETCAP_VIC));
  assert.equal(full.title, 'VIC — Tập đoàn Vingroup - Công ty CP');
  assert.ok(full.rows.some(([label, value]) => label === 'Vốn hoá' && value === '1.873.016 tỷ đồng'));
  assert.ok(full.rows.some(([label, value]) => label === 'Room ngoại' && value === '48% · đang nắm 3,2%'));
});

test('entity hồ sơ không dính vào chữ bên cạnh và không đè entity khác', () => {
  const cards = new Map([['VIC', companyCard(companyOf(VIETCAP_VIC))]]);
  assert.deepEqual(companyEntities('VICEM chưa niêm yết', cards), []);
  assert.deepEqual(companyEntities('VIC 241,3', cards, [{ offset: 0, length: 3 }]), []);

  const [view] = companyEntities('Giá VIC hôm nay', cards);
  assert.equal(view.view, 'company');
  assert.deepEqual([view.offset, view.length], [4, 3]);
});

test('hồ sơ hỏi một lần rồi nhớ, và mã lạ trả về 200 kèm data rỗng chứ không phải 404', async () => {
  let asked = 0;
  const source = vietcapCompany({
    async fetchImpl(url) {
      asked++;
      const known = String(url).endsWith('/VIC');
      return new Response(JSON.stringify({ data: known ? VIETCAP_VIC : null }));
    },
  });

  assert.equal((await source.profile('vic')).symbol, 'VIC');
  await source.profile('VIC');
  assert.equal(asked, 1, 'hỏi lại một mã vừa hỏi là nện vào feed của người khác');
  assert.equal(await source.profile('ZZZ'), null);
});

test('nguồn hồ sơ chậm thì câu trả lời vẫn đi, không đợi', async () => {
  const stuck = { profile: () => new Promise(() => {}) };
  assert.equal((await companyCards(stuck, ['VIC'], { waitMs: 20 })).size, 0);
});

// ---- mười phiên gần nhất ----------------------------------------------------------------------

test('nến ngày thành các phiên, mới nhất trước, mỗi phiên so với phiên liền trước nó', () => {
  const rows = dailyRows({
    t: [1757030400, 1757116800, 1757203200, 1757289600],
    c: [100, 102, 102, 99],
    v: [1000, 2000, 3000, 4000],
  }, 3);

  assert.deepEqual(rows.map((row) => row.close), [99, 102, 102]);
  assert.deepEqual(rows.map((row) => row.percent), [-2.94, 0, 2]);
  // Phiên cũ nhất trong cửa sổ không có phiên trước để so — nói 0 chứ không bịa ra một con số.
  assert.equal(dailyRows({ t: [1757030400], c: [100], v: [10] })[0].percent, 0);
  assert.deepEqual(dailyRows(null), []);
  assert.deepEqual(dailyRows({ c: [1] }), []);
});

test('nguồn nến ngày nhớ lại, không hỏi lại mỗi lần ai mở trang', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ t: [1757030400, 1757116800], c: [100, 101], v: [10, 20] }) };
  };
  let clock = 0;
  const source = dailyHistory({ fetchImpl, now: () => clock, ttlMs: 1000 });

  assert.equal((await source.rows('VIC')).length, 2);
  await source.rows('VIC');
  assert.equal(calls, 1);
  clock = 1500;
  await source.rows('VIC');
  assert.equal(calls, 2);
});

test('trang chi tiết gộp hồ sơ, giá hôm nay và mười phiên — thiếu cái nào thì thiếu mình nó', () => {
  const quote = { symbol: 'VIC', price: 256.1, reference: 244.5, ceiling: 261.6, floor: 227.4, open: 244.7, high: 260, low: 244.7, average: 255.12, volume: 7518600, change: 11.6, percent: 4.74, traded: true };
  const full = boardDetail({ symbol: 'VIC', quote, sector: 'Bất động sản', history: [{ day: '07/09/2026', close: 256.1, change: 11.6, percent: 4.74, volume: 7518600 }] });

  // Không có hồ sơ mà vẫn có trang: số của phiên tới từ chính cái bảng người ta vừa bấm vào.
  assert.equal(full.n, '');
  assert.equal(full.f, 0);
  assert.equal(full.w, 'Bất động sản');
  assert.deepEqual(full.q[0], ['Khối lượng', '7.518.600']);
  assert.deepEqual(full.hb, ['KLTB 1 phiên', '7.518.600']);

  // Ngược lại: có hồ sơ, chưa có nến — bảng vắng mặt chứ không thành một cái khung rỗng.
  const noDays = boardDetail({ symbol: 'VIC', card: companyCard(companyOf({ ticker: 'VIC', viOrganName: 'Vingroup', comGroupCode: 'VNINDEX', marketCap: 1e12 })), quote });
  assert.deepEqual(noDays.h, []);
  assert.equal(noDays.hb, null);
  assert.equal(noDays.f, 1);
  assert.ok(noDays.r.some(([label]) => label === 'Vốn hoá'));
});
