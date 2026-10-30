// Bộ test của phần biết về giá: chuẩn hoá, câu chữ, cái sàng mã, và bộ nhớ vài giây.
//
// Không có mạng ở đây. Mọi thứ nhận nguồn giá qua tham số, nên bộ test dựng một nguồn giả và
// đếm xem nó bị gọi mấy lần — đó là cách duy nhất kiểm được hai thứ vô hình: bot **không** hỏi
// lại feed khi vừa hỏi xong, và bot **không** nói gì khi lệnh không phải của nó.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, line, missing, reply, money, count, sessionNote, SHARES_PER_LOT, MOST_TEXT,
} from './market/quote.mjs';
import { withCache } from './market/vps.mjs';
import { looksLikeCode, tokensIn, makeGuard } from './market/symbols.mjs';
import { sectorsOf, vndirectSectors } from './market/sectors.mjs';
import {
  boardDetail, companyCard, companyCards, companyEntities, companyOf, plainText, vietcapCompany,
} from './market/company.mjs';
import { dailyHistory, dailyRows } from './market/chart.mjs';
import { foreignOf, vndirectForeign } from './market/foreign.mjs';
import { eased } from './market/heatmap.mjs';
import { changes, sessionShare, strengthMessage, withToday } from './market/strength.mjs';
import { reboundMessage } from './market/rebound.mjs';
import { phaseLines, phaseOf, strategyCaption, strategyMessage } from './market/strategy.mjs';
import { sectorFlows, stockFlow } from './market/flow.mjs';
import { pulseSeries } from './market/pulse.mjs';
import { sectorMessage } from './market/screens.mjs';
import { basketSvg, flowSvg, strategySvg } from './market/screens-chart.mjs';

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

test('danh sách niêm yết hỏi một lần rồi nhớ, và hai người hỏi cùng lúc chỉ thành một lượt gọi', async () => {
  // Bảng nhiệt sống hỏi danh sách này **mỗi nhịp đẩy**. Không nhớ thì đó là ba request mỗi ba giây
  // suốt phiên, để nhận về đúng một danh sách y nguyên — và một phần tư giây cộng vào quãng chờ
  // của người vừa bấm vào một ô mã.
  let calls = 0;
  let clock = 0;
  const source = {
    async universe() { calls += 1; return ['VIC', 'HPG']; },
    async quotes() { return []; },
  };
  const market = withCache(source, { universeTtlMs: 1000, now: () => clock });

  await Promise.all([market.universe(), market.universe()]);
  assert.equal(calls, 1, 'hai người hỏi cùng lúc vẫn là một lượt gọi');
  await market.universe();
  assert.equal(calls, 1);

  clock = 1500;
  assert.deepEqual(await market.universe(), ['VIC', 'HPG']);
  assert.equal(calls, 2);   // đủ lâu thì hỏi lại

  // Danh sách rỗng là nguồn đang hỏng: đừng nhớ nó, nếu không cái hỏng ấy sống thêm mười phút.
  let broken = 0;
  const empty = withCache({ async universe() { broken += 1; return []; }, async quotes() { return []; } }, { now: () => 0 });
  await empty.universe();
  await empty.universe();
  assert.equal(broken, 2);
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

test('khối ngoại: bản ghi thô thành bảng khoá theo ngày, giá trị đổi sang nghìn đồng', () => {
  const rows = foreignOf([
    { tradingDate: '2026-09-17', buyVol: 664031, sellVol: 1425400, buyVal: 1.607773311e11, sellVal: 3.441799e11 },
    { tradingDate: '2026-09-17', buyVol: 1, sellVol: 1, buyVal: 1, sellVal: 1 },   // trùng ngày: giữ dòng đầu
    { tradingDate: 'hôm qua', buyVol: 5 },                                          // ngày không đọc được thì bỏ
    { buyVol: 7 },
  ]);

  assert.equal(rows.size, 1);
  const day = rows.get('2026-09-17');
  assert.equal(day.buyVolume, 664031);
  assert.equal(day.sellVolume, 1425400);
  // Nguồn trả bằng đồng; cả bot nói chuyện bằng nghìn đồng.
  assert.equal(Math.round(day.buyValue), 160777331);
  assert.deepEqual([...foreignOf(null).keys()], []);
});

test('nguồn khối ngoại nhớ lại, và hỏng thì ném để bảng vẫn dựng được mà không có hai cột ấy', async () => {
  let calls = 0;
  const answer = { ok: true, json: async () => ({ data: [{ tradingDate: '2026-09-17', buyVol: 1, sellVol: 2, buyVal: 1000, sellVal: 2000 }] }) };
  let clock = 0;
  const source = vndirectForeign({ fetchImpl: async () => { calls += 1; return answer; }, ttlMs: 1000, now: () => clock });

  assert.equal((await source.rows('VIC')).size, 1);
  await source.rows('VIC');
  assert.equal(calls, 1);
  clock = 1500;
  await source.rows('VIC');
  assert.equal(calls, 2);

  const broken = vndirectForeign({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(() => broken.rows('VIC'), /503/);
});

test('nắn ô trong một ngành: đầu bảng nhường 10% cho đuôi, tổng diện tích không đổi', () => {
  // Treemap chia đúng theo tiền thì vài mã đầu ngốn gần hết ô và hai phần ba số mã còn lại nhỏ tới
  // mức không ghi nổi cái tên. Nắn lại chỉ đổi **cách vẽ**, không đổi số liệu.
  const nhom = [900, 600, 300, 120, 60, 40, 30, 20, 10, 10].map((value, i) => ({ symbol: `M${i}`, value }));
  const sau = eased(nhom);

  const truoc = nhom.reduce((sum, one) => sum + one.value, 0);
  assert.equal(Math.round(sau.reduce((sum, one) => sum + one.value, 0)), truoc);

  // Đầu bảng là tiền tố nhỏ nhất đủ chạm 60% diện tích — ở đây là hai mã lớn nhất.
  assert.equal(sau[0].value, 810);
  assert.equal(sau[1].value, 540);
  assert.ok(sau.slice(2).every((one, i) => one.value > nhom[i + 2].value), 'đuôi phải to lên');

  // Ngành chỉ có một mã, hoặc toàn mã đầu bảng, thì không có ai để nhường.
  assert.deepEqual(eased([{ symbol: 'A', value: 5 }]).map((one) => one.value), [5]);
  assert.deepEqual(eased([{ symbol: 'A', value: 0 }, { symbol: 'B', value: 0 }]).map((one) => one.value), [0, 0]);
});

test('nến phiên đang chạy dựng từ nến 1 phút, khối lượng ước cả phiên', () => {
  // 10:15 giờ VN = 03:15 UTC: đã qua 75 trong 255 phút giao dịch.
  const at = new Date('2026-10-16T03:15:00Z');
  assert.equal(Math.round(sessionShare(at) * 255), 75);
  assert.equal(sessionShare(new Date('2026-10-16T05:00:00Z')), 150 / 255); // nghỉ trưa
  assert.equal(sessionShare(new Date('2026-10-16T08:00:00Z')), 1);          // 15:00

  const day = (iso, close) => ({ time: Date.parse(iso) / 1000, open: close, high: close, low: close, close, volume: 1000 });
  const rows = [day('2026-10-14T02:00:00Z', 10), day('2026-10-15T02:00:00Z', 11)];
  const minute = (iso, o, h, l, c, v) => ({ time: Date.parse(iso) / 1000, open: o, high: h, low: l, close: c, volume: v });
  const minutes = [
    minute('2026-10-15T07:44:00Z', 11, 11, 11, 11, 99),   // hôm qua — phải bị bỏ
    minute('2026-10-16T02:15:00Z', 11.2, 11.5, 11.1, 11.4, 300),
    minute('2026-10-16T03:14:00Z', 11.4, 11.6, 11.0, 11.3, 200),
  ];
  const { rows: out, partial } = withToday(rows, minutes, at);
  assert.equal(out.length, 3);
  assert.equal(partial, 75 / 255);
  assert.deepEqual(
    { open: out[2].open, high: out[2].high, low: out[2].low, close: out[2].close, volume: Math.round(out[2].volume) },
    { open: 11.2, high: 11.6, low: 11.0, close: 11.3, volume: 1700 },
  );

  // Đã có nến hôm nay (nguồn nến ngày cập nhật kịp) thì thay chứ không thêm.
  assert.equal(withToday(out, minutes, at).rows.length, 3);
  // Hôm nay chưa khớp gì thì giữ nguyên.
  assert.deepEqual(withToday(rows, minutes.slice(0, 1), at), { rows, partial: null, paced: false });

  // Đủ 5 phiên trước thì ước theo nhịp cùng giờ: mỗi phiên khớp 400 trước 10:15 và 600 sau đó,
  // tức tới giờ này thường đã khớp 40% — hôm nay khớp 500 thì cả phiên ước 1.250, không phải 1.700.
  const past = ['09', '12', '13', '14', '15'].flatMap((d) => [
    minute(`2026-10-${d}T02:15:00Z`, 11, 11, 11, 11, 400),
    minute(`2026-10-${d}T07:00:00Z`, 11, 11, 11, 11, 600),
  ]);
  const paced = withToday(rows, [...past, ...minutes.slice(1)], at);
  assert.equal(paced.paced, true);
  assert.equal(Math.round(paced.rows.at(-1).volume), 1250);
});

test('so bản hiện tại với bản cuối ngày', () => {
  const report = (list) => ({ results: list.map(([symbol, status]) => ({ symbol, status })) });
  const label = (r) => r.status;
  const before = report([['A', 'vùng mua'], ['B', 'nền rộng'], ['C', null], ['D', 'vùng mua']]);
  const now = report([['A', 'vùng mua'], ['B', 'vượt nền'], ['C', 'vùng mua'], ['D', null]]);
  assert.deepEqual(changes(before, now, label), ['~ B: nền rộng → vượt nền', '+ C: vùng mua', '− D: rớt khỏi vùng mua']);
});

test('dòng tiền đo bằng tỷ trọng, không bằng giá trị tuyệt đối', () => {
  // 66 phiên: 60 phiên nền rồi 5 phiên gần nhất (cộng một phiên đầu để có giá 5 phiên trước).
  const series = (base, recent, from, to) => Array.from({ length: 66 }, (_, i) => ({
    time: 1_700_000_000 + i * 86400, open: 10, high: 10, low: 10,
    close: i < 61 ? from : to,
    volume: (i < 61 ? base : recent) / ((i < 61 ? from : to) * 1000),
  }));
  // Cả sàn gấp đôi: A gấp ba (hút tiền), B gấp đôi (giữ phần), C chỉ tăng 75% (bị rút dù vẫn tăng).
  const flows = [
    stockFlow('A1', series(2e9, 6e9, 10, 11)), stockFlow('A2', series(2e9, 6e9, 10, 11)), stockFlow('A3', series(2e9, 6e9, 10, 11)),
    stockFlow('B1', series(2e9, 4e9, 10, 10)), stockFlow('B2', series(2e9, 4e9, 10, 10)), stockFlow('B3', series(2e9, 4e9, 10, 10)),
    stockFlow('C1', series(8e9, 14e9, 10, 9)), stockFlow('C2', series(8e9, 14e9, 10, 9)), stockFlow('C3', series(8e9, 14e9, 10, 9)),
  ];
  assert.equal(Math.round(flows[0].ratio * 10) / 10, 3);
  assert.equal(Math.round(flows[0].ret5), 10);

  const { sectors } = sectorFlows(flows, (symbol) => symbol[0]);
  assert.deepEqual(sectors.map((s) => s.name), ['A', 'B', 'C']);
  assert.ok(sectors[0].shift > 0 && sectors[2].shift < 0, 'C giao dịch nhiều hơn mà vẫn mất tỷ trọng');
  assert.equal(Math.round(sectors[1].shift * 10), 0);
});

test('nhịp thị trường: phân phối, nỗ lực hồi phục, ngày xác nhận', () => {
  // Mỗi phiên: [% thay đổi, KL]. Giảm dần về đáy, hồi 3 phiên KL thấp, rồi ngày 4 tăng mạnh KL cao.
  const steps = [
    ...Array(10).fill([-1, 100]),
    [-1, 120], [-1, 130],          // 2 phiên phân phối (giảm, KL cao hơn phiên trước)
    [+0.5, 80], [+0.3, 70], [+0.2, 60], // ngày 1–3: hồi với KL thấp — chưa tính
    [+1.5, 150],                   // ngày 4: tăng ≥ 1,2% với KL cao hơn → xác nhận
  ];
  let close = 1000;
  const rows = steps.map(([change, volume], i) => {
    const open = close;
    close = close * (1 + change / 100);
    return { time: 1_700_000_000 + i * 86400, open, high: Math.max(open, close), low: Math.min(open, close), close, volume };
  });
  const series = pulseSeries(rows);
  assert.equal(series[11].state, 'correction');
  assert.equal(series[11].distribution, 2);
  assert.deepEqual(series.slice(12, 15).map((p) => [p.state, p.attemptDay]), [['attempt', 1], ['attempt', 2], ['attempt', 3]]);
  assert.equal(series[15].state, 'confirmed');
  assert.equal(series[15].distribution, 0, 'phân phối của đợt giảm trước không tính sang xu hướng mới');

  // Cùng nhịp hồi nhưng ngày 4 tăng mà KL thấp hơn phiên trước: không xác nhận.
  rows[15].volume = 50;
  assert.equal(pulseSeries(rows)[15].state, 'attempt');
});

test('ngành đông mã thì bớt mã cuối danh sách cho vừa một tin, và nói còn bao nhiêu mã', () => {
  const members = Array.from({ length: 60 }, (_, i) => ({
    symbol: `M${String(i).padStart(2, '0')}`, close: 12.3, ret5: 1.5, ret20: -2.25, value5: 25e9, ratio: 1.4,
  }));
  const report = { sectors: [{ name: 'Bất động sản', share5: 12.5, shift: 1.2, ratio: 1.3, ret5: 2.1, members }] };

  const text = sectorMessage(report, 'bat dong san');
  assert.ok(text.length <= MOST_TEXT, `${text.length} ký tự`);
  assert.match(text, /^Bất động sản\n/);
  assert.match(text, /\n• M00 /);
  const shown = text.split('\n').filter((line) => line.startsWith('• ')).length;
  assert.ok(shown > 0 && shown < 60);
  assert.match(text, new RegExp(`\n… và ${60 - shown} mã nữa, tiền tăng thêm ít hơn\.\n`));
  assert.match(text, /không phải khuyến nghị đầu tư\.$/);

  // Ngành ít mã thì giữ đủ, không có dòng "… và".
  const few = sectorMessage({ sectors: [{ ...report.sectors[0], members: members.slice(0, 5) }] }, 'động sản');
  assert.equal(few.split('\n').filter((line) => line.startsWith('• ')).length, 5);
  assert.doesNotMatch(few, /… và/);
});

test('hình !dongtien: mỗi ngành một thanh, ba kiểu thanh cho ba nhóm', () => {
  const sector = (name, shift, ret5) => ({ name, shift, ret5, share5: 10, ratio: 1, ret20: 0, breadth: 50, members: [] });
  const report = {
    sectors: [sector('Ngân hàng', 4.7, 2.2), sector('Dầu khí', 0.9, -7), sector('Bất động sản & <xây>', -2, -3.2)],
    total5: 11111e9, totalBase: 13000e9, count: 199, day: '2026-10-16',
  };
  const svg = flowSvg(report);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, />Ngân hàng</);
  assert.match(svg, />Bất động sản &amp; &lt;xây&gt;</);   // tên ngành được thoát ký tự
  assert.match(svg, /fill="url\(#sold\)"/);              // tiền vào mà giá giảm: thanh sọc
  assert.match(svg, />\+4,7</);
  assert.doesNotMatch(svg, /[+-]0</);                     // không có "+0" hay "-0"
  assert.equal(flowSvg({ ...report, sectors: [] }), null);
});

test('hình !manh / !hoiphuc: mỗi mã một ô, có vạch pivot và cắt lỗ; không có mã thì không có hình', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ time: 1_760_000_000 + i * 86400, close: 20 + i / 10 }));
  const strong = (symbol, status) => ({
    symbol, status, leader: true, score: 2, rsRank: 90, close: 27.9, change: 1.2,
    plan: { pivot: 28.5, toPivot: -2.1, entry: 28.5, stop: 26.1, risk: 8.4 },
  });
  const report = { results: [strong('AAA', 'setup'), strong('BBB', 'breakout'), { ...strong('CCC', 'setup'), leader: false }], day: '2026-10-16' };
  const svg = basketSvg('strong', report, () => rows, { groupOf: () => 'VN30' });
  // Vượt nền đứng trước vùng mua, và mã không dẫn dắt thì không vẽ.
  assert.ok(svg.indexOf('>BBB<') < svg.indexOf('>AAA<'));
  assert.doesNotMatch(svg, />CCC</);
  assert.match(svg, />vượt nền</);
  assert.match(svg, />28,5</);
  assert.match(svg, />26,1</);
  assert.equal(basketSvg('strong', { results: [], day: '2026-10-16' }, () => rows), null);

  const candidate = { ...strong('DDD', 'setup'), candidate: true, plan: { ...strong().plan, target: 30.7, gain: 7.7, rr: 1.4 } };
  const picture = basketSvg('rebound', { results: [candidate], day: '2026-10-16' }, () => rows);
  assert.match(picture, />sát pivot</);
  assert.match(picture, /bán 30,7 \(\+7,7%\)/);
});

test('!manh: mã chạy xa hoặc nền rộng kèm vùng chờ về MA10–MA20; không có vùng hợp lệ thì không in', () => {
  const leader = (symbol, status, pullback) => ({
    symbol, status, leader: true, score: 2, rsRank: 95, close: 15.8, change: -1.5,
    liquidity: { pass: true },
    hard: [], quality: [],
    plan: { pivot: 16.1, toPivot: 1.9, entry: 16.1, stop: 14.7, risk: 9, target: 18.9, volumeRatio: 1, pullback },
  });
  const report = {
    results: [
      leader('MSB', 'wide', { low: 15, high: 15.5, entry: 15, risk: 2 }),
      leader('VIC', 'wide', null),
    ],
    market: null, pulse: null, day: '2026-10-30',
  };
  const text = strengthMessage(report);
  assert.match(text, /MSB 15,8 · RS 95 · cắt lỗ 14,7, rủi ro 9% · chờ về MA10–MA20 15–15,5, cắt lỗ 14,7 \(-2% từ 15\)/);
  assert.doesNotMatch(text, /VIC[^\n]*chờ về/);
});

test('!manh: danh sách theo dõi luôn in mã thiếu đúng một điều kiện, RS đủ cao, chưa chạy khỏi pivot', () => {
  const pass = (key, short) => ({ key, short, name: short, pass: true, text: 'ok' });
  const stock = (symbol, rsRank, toPivot, hard) => ({
    symbol, rsRank, status: 'setup', leader: false, score: 1, close: 50, change: 0,
    liquidity: { pass: true }, quality: [], hard,
    plan: { pivot: 52, toPivot, entry: 52, stop: 47, risk: 9, volumeRatio: 1 },
  });
  const full = [pass('trend', 'kênh trên'), pass('slope', 'MA đi lên'), pass('high', 'gần đỉnh')];
  const lacking = (key, text) => [...full, pass('rs', 'RS')].map((c) => (c.key === key ? { ...c, pass: false, text } : c));
  const report = {
    results: [
      // Có một mã dẫn dắt — danh sách theo dõi vẫn phải in.
      { ...stock('LEAD', 95, -2, [...full, pass('rs', 'RS')]), leader: true },
      stock('AAA', 85, -3.8, lacking('rs', 'RS 85/99 trong rổ')),
      stock('BBB', 60, -1, lacking('rs', 'RS 60/99 trong rổ')),         // RS quá thấp
      stock('CCC', 88, 7, lacking('high', 'cách đỉnh -16%')),            // đã chạy khỏi pivot
      stock('DDD', 92, -4, [{ ...full[0], pass: false }, ...full.slice(1), { ...pass('rs', 'RS'), pass: false }]), // thiếu hai
      { ...stock('EEE', 90, -8, lacking('trend', 'giá dưới MA50')), ma20: 55 },  // vừa rơi khỏi kênh, dưới MA20
    ],
    market: null, pulse: null, day: '2026-10-30',
  };
  const text = strengthMessage(report);
  assert.match(text, /Theo dõi — gần thành dẫn dắt, thiếu một điều kiện:\n1\. AAA 50 · RS 85 · pivot 52 \(-3,8%\) · thiếu RS \(RS 85\/99 trong rổ\)/);
  assert.doesNotMatch(text, /BBB|CCC|DDD|EEE/);
});

test('!hoiphuc: danh sách theo dõi kể mã thiếu đúng một điều kiện, trừ mã không còn downtrend', () => {
  const pass = (key, short) => ({ key, short, name: short, pass: true, text: 'ok' });
  const fail = (key, short, text) => ({ key, short, name: short, pass: false, text });
  const stock = (symbol, bottom, score = 1) => ({
    symbol, bottom, score, close: 20, fromHigh: -30, confirmed: bottom.every((c) => c.pass),
    candidate: false, liquidity: { pass: true }, signs: [], plan: { pivot: 22, toPivot: -9.1 }, status: 'building',
  });
  const full = [pass('context', 'downtrend'), pass('bottom', 'đáy chính'), pass('higherLow', 'đáy sau cao hơn'), pass('repair', 'MA20 quay lên')];
  const without = (key, text) => full.map((c) => (c.key === key ? fail(c.key, c.short, text) : c));
  const report = {
    results: [
      stock('AAA', without('repair', 'giá dưới MA20 20 · MA20 -1%')),
      stock('BBB', without('context', 'không còn downtrend')),
      stock('CCC', [fail('context', 'downtrend', 'x'), fail('bottom', 'đáy chính', 'y'), ...full.slice(2)]),
    ],
    market: null, pulse: null, day: '2026-10-30',
  };
  const text = reboundMessage(report);
  assert.match(text, /Theo dõi — gần xác nhận đáy, thiếu một điều kiện:\n1\. AAA 20 · pivot 22 \(-9,1%\) · thiếu MA20 quay lên \(giá dưới MA20 20 · MA20 -1%\)/);
  assert.doesNotMatch(text, /BBB|CCC/);
});

test('pha thị trường: điều chỉnh hoặc dưới MA50 là downtrend, trên MA50 kèm xác nhận là uptrend, còn lại đi ngang', () => {
  const up = { regime: 'up', close: 1800, ma20: 1790, ma50: 1750 };
  const down = { regime: 'down', close: 1700, ma20: 1720, ma50: 1760 };
  const mixed = { regime: 'mixed', close: 1760, ma20: 1740, ma50: 1750 };
  assert.equal(phaseOf(down, { state: 'attempt' }), 'down');
  assert.equal(phaseOf(up, { state: 'correction' }), 'down');
  assert.equal(phaseOf(up, { state: 'confirmed' }), 'up');
  assert.equal(phaseOf(up, { state: 'pressure' }), 'sideways');
  assert.equal(phaseOf(mixed, { state: 'confirmed' }), 'sideways');
  assert.equal(phaseOf(null, null), null);

  const lines = phaseLines(down, { state: 'attempt', distribution: 9 });
  assert.match(lines[0], /^Pha thị trường: DOWNTREND · tỷ trọng cổ phiếu 0–20%/);
  assert.match(lines[2], /Có ngày xác nhận thì thăm dò/);
  assert.deepEqual(phaseLines(null, null), []);
});

test('!strategy: chỉ in hành động của pha hiện tại, kèm lý do và điều kiện chuyển pha', () => {
  const down = { regime: 'down', close: 1741, ma20: 1720, ma50: 1760 };
  const attempt = { state: 'attempt', distribution: 9, attemptDay: 8, low: 1677.2 };
  const text = strategyMessage(down, attempt, { day: '2026-10-30' });
  assert.match(text, /^CHIẾN LƯỢC · phiên 30\/10\/2026\nPha hiện tại: DOWNTREND — giữ vốn/);
  assert.match(text, /Vì sao: VN-Index dưới MA50 · MA20 dưới MA50 · đang nỗ lực hồi phục, chưa xác nhận · 9 phiên phân phối\/25/);
  assert.match(text, /Tỷ trọng cổ phiếu 0–20%/);
  assert.match(text, /Lúc này: Ngày 8 của nhịp hồi từ đáy 1.677,2, chưa có ngày xác nhận: chưa mua đuổi/);
  assert.doesNotMatch(text, /UPTREND|ĐI NGANG|80–100%/);
  assert.ok(text.length < 2000, `dài ${text.length} ký tự`);

  const up = strategyMessage({ regime: 'up', close: 1800, ma20: 1790, ma50: 1750 }, { state: 'confirmed', distribution: 1 });
  assert.match(up, /Pha hiện tại: UPTREND/);
  assert.match(up, /Tỷ trọng cổ phiếu 80–100%/);
  assert.doesNotMatch(up, /DOWNTREND|Lúc này/);

  const bare = strategyMessage(null, null);
  assert.match(bare, /Chưa lấy được dữ liệu VN-Index/);
  assert.match(bare, /Kỷ luật chung/);
});

test('chú thích !strategy: một dòng pha và tỷ trọng, ảnh mới là câu trả lời', () => {
  const caption = strategyCaption({ regime: 'down', close: 1741, ma20: 1720, ma50: 1760 }, { state: 'attempt', distribution: 9 }, { day: '2026-10-30' });
  assert.equal(caption, 'Chiến lược phiên 30/10/2026: DOWNTREND · tỷ trọng cổ phiếu 0–20% · chi tiết trong ảnh');
  assert.equal(strategyCaption(null, null), null);
});

test('hình !strategy: pha hiện tại tô đặc, thước tỷ trọng, sáu ô hành động; không có pha thì không có hình', () => {
  const svg = strategySvg({ regime: 'down', close: 1741.62, ma20: 1720, ma50: 1760 }, { state: 'attempt', distribution: 9 }, { day: '2026-10-30' });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, />Chiến lược theo pha thị trường</);
  assert.match(svg, />phiên 30\/10\/2026 · VN-Index 1\.741,62</);
  assert.match(svg, /font-weight="800" fill="#ffffff">DOWNTREND</);   // pha hiện tại: chữ trắng trên nền đặc
  assert.match(svg, /fill="#898781">UPTREND</);                        // pha khác: chữ xám
  assert.match(svg, />0–20%</);
  assert.match(svg, />Rủi ro mỗi lệnh</);
  assert.match(svg, />Lúc này</);
  assert.match(svg, />▼</);
  assert.equal(strategySvg(null, null), null);
});
