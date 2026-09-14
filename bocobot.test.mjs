// Bộ test của con bot: đọc câu hỏi, và cái luật im lặng.
//
// Nửa dưới cho con bot chạy thật — một nền tảng giả trên cổng tự cấp, một nguồn giá giả — vì
// thứ dễ hỏng nhất ở đây là việc **không** gửi gì, và không có cách nào kiểm một tin nhắn không
// được gửi ngoài cách để nó có cơ hội gửi rồi đếm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

import {
  askedChartFor, askedFor, askedHelpFor, askedNewsFor, askedTechnicalFor, canonicalMessage, commandsFor, HELP,
  privateRecipientFor, run,
  SORRY,
} from './bocobot.mjs';
import { normalize } from './market/quote.mjs';
import { chartRich, intradayChart, parseChartPeriod, rangeSession } from './market/chart.mjs';
import { askedHeatmapFor, heatmapRich } from './market/heatmap.mjs';
import { googleNews, MAX_NEWS_REPLY_CHARS, newsMessage } from './market/news.mjs';
import {
  analyze, atr, ema, rsi, sma, technicalAnalysis, technicalMessage, technicalRich,
} from './market/technical.mjs';

const ME = { username: 'bocobot', displayName: 'Bảng giá' };
const TOP_ME = { username: 'topbot', displayName: 'Top Bot' };
const message = (fields) => ({
  conversationId: 'p1',
  conversationType: 'group',
  messageId: 'm1',
  from: { userId: 'u1', displayName: 'Người hỏi' },
  ...fields,
});

// ---- đọc câu hỏi ----------------------------------------------------------------------------

test('một mã là một lệnh', () => {
  const asked = askedFor(message({ text: '/vic', command: 'vic' }), ME);
  assert.deepEqual(asked.symbols, ['VIC']);
  assert.equal(asked.strict, true);
  assert.equal(asked.addressed, false);   // chưa ai gọi tên bot này
});

test('lệnh mang theo mã thì tất cả đều được hỏi', () => {
  const asked = askedFor(message({ text: '/vic hpg', command: 'vic', commandArgs: 'hpg' }), ME);
  assert.deepEqual(asked.symbols, ['VIC', 'HPG']);
});

test('/gia là lệnh của bot này, nên nó nhận là đang được hỏi', () => {
  const asked = askedFor(message({ text: '/gia vic hpg', command: 'gia', commandArgs: 'vic hpg' }), ME);
  assert.deepEqual(asked.symbols, ['VIC', 'HPG']);
  assert.equal(asked.addressed, true);
});

test('gọi tên thì cả câu được đọc, và cái tên không bị đem đi tra', () => {
  const asked = askedFor(message({ text: '@bocobot vic hpg' }), ME);
  assert.deepEqual(asked.symbols, ['VIC', 'HPG']);
  assert.equal(asked.addressed, true);
  assert.equal(asked.strict, false);      // một câu nói, không phải một lệnh
});

test('tên hiển thị cũng là một cách gọi', () => {
  // Trước tháng 8/2026 nền tảng viết tên hiển thị vào chỗ nhắc tên, và những tin nhắn ấy vẫn còn.
  const asked = askedFor(message({ text: '@Bảng giá vic' }), ME);
  assert.deepEqual(asked.symbols, ['VIC']);
});

test('gọi bot trống hoặc help thì là hỏi hướng dẫn', () => {
  assert.deepEqual(askedHelpFor(message({ text: '@topbot' }), TOP_ME), { addressed: true });
  assert.deepEqual(askedHelpFor(message({ text: '@topbot help' }), TOP_ME), { addressed: true });
  assert.deepEqual(askedHelpFor(message({ text: '@topbot help -v' }), TOP_ME), { addressed: true });
  assert.deepEqual(askedHelpFor(message({ text: '@Top Bot help' }), TOP_ME), { addressed: true });
  assert.equal(askedHelpFor(message({ text: '@topbot vic' }), TOP_ME), null);
  assert.equal(askedHelpFor(message({ text: 'topbot help' }), TOP_ME), null);
});

test('nhắn riêng cũng phải gõ đúng lệnh, như trong nhóm', () => {
  // Hộp thư 1:1 từng được đọc lỏng: `vic` trần trụi ra bảng giá, và mọi câu chuyện có một chữ
  // ba ký tự hình mã cũng ra bảng giá.
  const direct = { conversationType: 'direct' };
  assert.equal(askedFor(message({ ...direct, text: 'vic' }), ME), null);
  assert.equal(askedFor(message({ ...direct, text: 'hôm nay vic đẹp thế' }), ME), null);

  assert.deepEqual(askedFor(message({ ...direct, text: '!vic' }), ME).symbols, ['VIC']);
  assert.deepEqual(askedFor(message({ ...direct, text: '@bocobot vic' }), ME).symbols, ['VIC']);
});

test('một câu trong nhóm không nói với bot thì không phải việc của bot', () => {
  assert.equal(askedFor(message({ text: 'hôm nay vic đẹp thế' }), ME), null);
});

test('lệnh của con bot bên cạnh vẫn đi qua đây, và đi qua như một chữ chưa biết', () => {
  const asked = askedFor(message({ text: '/tienlen', command: 'tienlen' }), ME);
  assert.deepEqual(asked.symbols, ['TIENLEN']);
  assert.equal(asked.addressed, false);   // và chính chỗ này quyết định nó sẽ im
});

// ---- cho nó chạy thật -----------------------------------------------------------------------

const VIC = {
  sym: 'VIC', r: 244.5, c: 261.6, f: 227.4, lastPrice: 256.1, lot: 751860,
  openPrice: '244.7', highPrice: '260.0', lowPrice: '244.7', avePrice: '255.12',
};

/// Một nền tảng bot đủ dùng: nói tên mình, nhận danh sách lệnh, phát ra một xấp cập nhật đúng
/// một lần, và ghi lại mọi thứ được gửi vào phòng.
async function stubApi(updates) {
  const sent = [];
  const registered = [];
  let queue = [...updates];

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', async () => {
      const path = request.url.split('?')[0];
      const answer = (value) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };

      if (path === '/getMe') return answer(ME);
      if (path === '/setCommands') {
        registered.push(...JSON.parse(body).commands);
        return answer({ ok: true });
      }
      if (path === '/sendMessage') {
        sent.push(JSON.parse(body));
        return answer({ messageId: `m${sent.length}` });
      }
      if (path === '/getUpdates') {
        if (queue.length) {
          const batch = queue;
          queue = [];
          return answer(batch);
        }
        // Chờ một nhịp rồi trả rỗng: thật thì cuộc gọi này treo ba mươi giây, ở đây chỉ cần đủ
        // để vòng lặp không quay tít.
        await wait(20);
        return answer([]);
      }
      response.writeHead(404);
      response.end('{}');
    });
  });

  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return { sent, registered, api: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/// Nguồn giá giả: biết đúng những mã được kể tên, và đếm số lần bị hỏi.
function stubMarket({ listed = ['VIC', 'HPG'], broken = false } = {}) {
  return {
    async universe() { return listed; },
    async quotes(symbols) {
      if (broken) throw new Error('feed không trả lời');
      return symbols.filter((s) => listed.includes(s)).map((s) => normalize({ ...VIC, sym: s }));
    },
  };
}

function stubNews({ broken = false } = {}) {
  const calls = [];
  return {
    calls,
    async latest(symbol) {
      calls.push(symbol);
      if (broken) throw new Error('rss không trả lời');
      return [
        {
          title: `${symbol} mở rộng dự án mới`,
          summary: 'Doanh nghiệp công bố kế hoạch đầu tư và cập nhật tiến độ trong quý này.',
          source: 'Nguồn A',
          link: `https://example.test/${symbol.toLowerCase()}/1`,
          publishedAt: new Date('2026-09-08T02:30:00Z'),
        },
        {
          title: `${symbol} có thêm chuyển động trên thị trường`,
          summary: 'Cổ phiếu được nhắc tới trong nhóm vốn hóa lớn sau phiên giao dịch gần nhất.',
          source: 'Nguồn B',
          link: `https://example.test/${symbol.toLowerCase()}/2`,
          publishedAt: new Date('2026-09-08T01:00:00Z'),
        },
        {
          title: `${symbol} cập nhật thông tin doanh nghiệp`,
          summary: 'Các mảng kinh doanh chính ghi nhận thêm thông tin mới.',
          source: 'Nguồn C',
          link: `https://example.test/${symbol.toLowerCase()}/3`,
          publishedAt: new Date('2026-09-07T09:00:00Z'),
        },
        {
          title: `${symbol} được nhà đầu tư chú ý`,
          summary: 'Thanh khoản tăng so với trung bình những phiên trước đó.',
          source: 'Nguồn D',
          link: `https://example.test/${symbol.toLowerCase()}/4`,
          publishedAt: new Date('2026-09-07T08:00:00Z'),
        },
        {
          title: `${symbol} xuất hiện trong báo cáo mới`,
          summary: 'Một báo cáo thị trường cập nhật góc nhìn về triển vọng cổ phiếu.',
          source: 'Nguồn E',
          link: `https://example.test/${symbol.toLowerCase()}/5`,
          publishedAt: new Date('2026-09-07T07:00:00Z'),
        },
        {
          title: `${symbol} tin thứ sáu`,
          summary: 'Tin này không được hiện vì chỉ lấy năm tin.',
          source: 'Nguồn F',
          link: `https://example.test/${symbol.toLowerCase()}/6`,
          publishedAt: new Date('2026-09-06T07:00:00Z'),
        },
      ];
    },
  };
}

function stubChart({ broken = false, rich = null } = {}) {
  const calls = [];
  return {
    calls,
    async rich(symbol, quote, period) {
      calls.push({ symbol, quote, period });
      if (broken) throw new Error('chart không trả lời');
      return rich;
    },
  };
}

function stubHeatmap({ broken = false, rich = null } = {}) {
  const calls = [];
  return {
    calls,
    async rich(market, asked) {
      calls.push({ market, asked });
      if (broken) throw new Error('heatmap không trả lời');
      return rich ?? heatmapRich([
        normalize({ ...VIC, sym: 'VIC', lastPrice: 250, r: 244.5, lot: 900000 }),
        normalize({ ...VIC, sym: 'SHB', lastPrice: 12, r: 12.1, c: 12.9, f: 11.3, lot: 1500000 }),
        normalize({ ...VIC, sym: 'HPG', lastPrice: 28, r: 27.8, c: 29.7, f: 25.9, lot: 1200000 }),
        normalize({ ...VIC, sym: 'FPT', lastPrice: 102, r: 103, c: 110.2, f: 95.8, lot: 300000 }),
      ], { at: new Date('2026-09-07T03:00:00Z'), filter: asked.filter });
    },
  };
}

function stubTechnical({ broken = false } = {}) {
  const calls = [];
  return {
    calls,
    async report(symbol) {
      calls.push(symbol);
      if (broken) throw new Error('nến không trả lời');
      const text = `PTKT ${symbol} · phiên 11/09/2026 · 243,3 (-1,78%)`;
      return {
        text,
        image: { fileName: `ptkt-${symbol.toLowerCase()}-2026-09-11.svg`, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
        rich: { blocks: [{ type: 'paragraph', text }] },
      };
    },
  };
}

function pickPeriod(period) {
  if (!period) return null;
  return {
    key: period.key,
    count: period.count,
    unit: period.unit,
    label: period.label,
    intraday: period.intraday,
    limit: period.limit,
  };
}

/**
 * Cho bot chạy tới khi nó đã làm xong việc, rồi bảo nó dừng.
 *
 * `settle` là một khoảng lặng có chủ ý: để chứng minh bot **không** gửi gì thì phải cho nó đủ
 * thời gian để gửi. Một bài test khẳng định sự im lặng mà không đợi thì chỉ đang đo tốc độ máy.
 */
async function withBot(
  updates,
  {
    market = stubMarket(), news = stubNews(), chart = stubChart(), heatmap = stubHeatmap(), technical = stubTechnical(),
    expect = 1, settle = 200,
  } = {},
) {
  const platform = await stubApi(updates);
  const stopping = new AbortController();
  const statePath = join(tmpdir(), `boco-${randomUUID()}.json`);

  const loop = run('token', {
    signal: stopping.signal,
    api: platform.api,
    market,
    news,
    chart,
    heatmap,
    technical,
    statePath,
    at: () => new Date('2026-09-07T03:00:00Z'),   // 10:00 thứ Hai: sàn đang mở, không có dòng ghi chú
  });

  // Đợi tới khi nó nói đủ số câu đang chờ, rồi lặng thêm một nhịp nữa.
  //
  // Không phải một khoảng chờ cố định. Khởi động giờ có một việc nặng — lấy giá cả sàn để xếp
  // hạng lệnh — và một con số đủ trên máy này là con số thiếu trên một máy đang bận, thành một
  // bài test đỏ mà không có gì hỏng. Nhịp lặng phía sau vẫn cần: nó là chỗ chứng minh **không**
  // có câu thứ hai, và chỗ chứng minh sự im lặng thì phải cho đủ thời gian để nói.
  const deadline = Date.now() + 5000;
  while (platform.sent.length < expect && Date.now() < deadline) await wait(20);
  await wait(settle);

  stopping.abort();
  await loop.catch(() => {});
  platform.close();
  return platform;
}

const update = (fields, id = 1) => ({ id, kind: 'message', message: message(fields) });

test('hỏi một mã thì được một dòng', async () => {
  const { sent } = await withBot([update({ text: '/vic', command: 'vic' })]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^VIC 256,1 ▲ \+4,74% · KL 7\.518\.600$/);
  assert.equal(sent[0].replyToMessageId, 'm1');   // trả lời vào đúng câu đã hỏi
});

test('hỏi ba mã thì vẫn là một tin nhắn', async () => {
  // Một phòng nhận một tin mỗi giây. Ba mã thành ba tin là hai lần chờ và một phòng bị đẩy trôi.
  const { sent } = await withBot([update({ text: '/gia vic hpg', command: 'gia', commandArgs: 'vic hpg' })]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text.split('\n').length, 2);
});

test('lệnh của bot khác thì không nói gì cả', async () => {
  const { sent } = await withBot([update({ text: '/tienlen', command: 'tienlen' })], { expect: 0 });
  assert.deepEqual(sent, []);
});

test('gõ hẳn một mã không có thì được nói cho biết', async () => {
  const { sent } = await withBot([update({ text: '/gia vic zzz', command: 'gia', commandArgs: 'vic zzz' })]);
  assert.match(sent[0].text, /VIC 256,1/);
  assert.match(sent[0].text, /ZZZ — không có dữ liệu/);
});

test('những chữ ba ký tự lẫn trong một câu thì bỏ qua, không kê thành lỗi', async () => {
  const { sent } = await withBot([update({ text: '@bocobot cho xem vic voi' })]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'VIC 256,1 ▲ +4,74% · KL 7.518.600');
  assert.doesNotMatch(sent[0].text, /CHO|XEM|VOI/);
});

test('gọi tên mà không có mã nào thì được nói cho biết', async () => {
  const { sent } = await withBot([update({ text: '@bocobot ơi' })]);
  assert.equal(sent[0].text, SORRY.nothing);
});

test('gọi bot trống thì trả hướng dẫn', async () => {
  const { sent } = await withBot([update({ text: '@bocobot' })]);

  assert.equal(sent[0].text, HELP);
  assert.match(sent[0].text, /!vboa bds — bất động sản/);
  assert.match(sent[0].text, /!view gex 3m — chart 3 tháng/);
  assert.match(sent[0].text, /gõ \/ thì cả nhóm cùng xem, ví dụ \/view vic/);
  assert.equal(sent[0].replyToMessageId, 'm1');
});

test('gọi bot help thì trả hướng dẫn thay vì đọc HELP như mã', async () => {
  const { sent } = await withBot([update({ text: '@bocobot help -v' })]);

  assert.equal(sent[0].text, HELP);
  assert.equal(sent[0].onlyForUserId, 'u1');
  assert.doesNotMatch(sent[0].text, /HELP — không có dữ liệu/);
});

test('trả lời người khác thì không phải việc của bot', async () => {
  // Đây là lỗi đã xảy ra thật, trong một phòng đã tắt chế độ riêng tư: mọi tin đều tới bot, nên
  // mọi lần ai đó trả lời ai đó đều được đọc như một câu hỏi. "vip zzzz" ra bảng giá VIP, và
  // câu báo lỗi "bug bot cứ tin reply" ra cả BOT lẫn TIN — ba từ ấy đều là mã có thật.
  assert.equal(askedFor(message({ text: 'vip zzzz', replyToMessageId: 'cua-nguoi-khac' }), ME), null);

  const { sent } = await withBot(
    [update({ text: 'giá pom đẹp thế', replyToMessageId: 'cua-nguoi-khac' })],
    { expect: 0 },
  );
  assert.deepEqual(sent, []);
});

test('trong hộp thư 1:1, quote một tin không phải của bot thì vẫn không phải việc của bot', () => {
  // Một tin quote là nói với cái nó quote. Bot không biết tin được quote là của ai, nên câu không
  // đúng cú pháp mà tình cờ có chữ ba ký tự hình mã thì phải im.
  const direct = { conversationType: 'direct', replyToMessageId: 'khong-biet-cua-ai' };
  assert.equal(askedFor(message({ ...direct, text: 'vip zzzz' }), ME), null);
  assert.equal(askedFor(message({ ...direct, text: 'cai nay sao the' }), ME), null);

  // Gọi tên hoặc gõ dấu gọi thì vẫn được nghe, quote hay không.
  assert.deepEqual(askedFor(message({ ...direct, text: '@bocobot vic' }), ME).symbols, ['VIC']);
  assert.deepEqual(askedFor(message({ ...direct, text: '!vic' }), ME).symbols, ['VIC']);

  // Và quote đúng một tin của bot thì như trong nhóm.
  const mine = new Set(['tin-cua-bot']);
  const onBot = message({ conversationType: 'direct', text: 'vic', replyToMessageId: 'tin-cua-bot' });
  assert.deepEqual(askedFor(onBot, ME, mine).symbols, ['VIC']);
});

test('trả lời tin của chính bot thì có', () => {
  const mine = new Set(['tin-cua-bot']);
  const asked = askedFor(message({ text: 'vic', replyToMessageId: 'tin-cua-bot' }), ME, mine);
  assert.deepEqual(asked.symbols, ['VIC']);
  assert.equal(asked.strict, false);      // vẫn chỉ trả lời cái tra được
  assert.equal(asked.addressed, false);   // và im nếu trong câu không có mã nào
});

test('trả lời tin của bot bằng một câu không có mã thì bot im', async () => {
  const { sent } = await withBot([update({ text: 'mua dc k', replyToMessageId: 'tin-cua-bot' })], { expect: 0 });
  assert.deepEqual(sent, []);
});

test('nguồn giá chết mà có người gọi thẳng thì nói ra, không im', async () => {
  const { sent } = await withBot(
    [update({ text: '/gia vic', command: 'gia', commandArgs: 'vic' })],
    { market: stubMarket({ broken: true }) },
  );
  assert.equal(sent[0].text, SORRY.source);
});

test('nguồn giá chết mà không ai gọi thẳng thì vẫn im', async () => {
  const { sent } = await withBot(
    [update({ text: '/vic', command: 'vic' })],
    { market: stubMarket({ broken: true }), expect: 0 },
  );
  assert.deepEqual(sent, []);
});

// ---- dấu gọi ---------------------------------------------------------------------------------

test('dấu chấm than là cách gọi bot', () => {
  const asked = askedFor(message({ text: '!vic' }), ME);
  assert.deepEqual(asked.symbols, ['VIC']);
  assert.equal(asked.addressed, true);
  assert.equal(asked.strict, true);      // gõ hẳn một dấu là có chủ ý, nên mã sai được nói ra
});

test('-v cuối lệnh là gửi riêng cho người gõ, không phải mã V', () => {
  assert.equal(privateRecipientFor(message({ text: '!gex -v' })), 'u1');
  assert.equal(privateRecipientFor(message({ text: '!gex 3m' })), null);
  assert.deepEqual(askedFor(message({ text: '!gex -v' }), ME).symbols, ['GEX']);
});

test('một dấu, nhiều mã', () => {
  assert.deepEqual(askedFor(message({ text: '!vic hpg fpt' }), ME).symbols, ['VIC', 'HPG', 'FPT']);
});

test('dấu gọi không kén khoảng trắng đằng trước', () => {
  assert.deepEqual(askedFor(message({ text: '  !vnindex' }), ME).symbols, ['VNINDEX']);
});

test('không có dấu gọi thì nghe được cũng không phải việc của bot', () => {
  // Chế độ riêng tư tắt nghĩa là bot đọc mọi câu trong phòng. Nghe được không phải là được hỏi:
  // 16 từ tiếng Việt thông dụng viết không dấu trùng mã niêm yết, và "hom nay" là một câu nói.
  assert.equal(askedFor(message({ text: 'hom nay vic dep the' }), ME), null);
  assert.equal(askedFor(message({ text: 'vic' }), ME), null);
});

test('dấu gọi chạy thật, từ đầu tới cuối', async () => {
  const { sent } = await withBot([update({ text: '!vic hpg' })]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text.split('\n').length, 2);
  assert.match(sent[0].text, /^VIC 256,1/);
});

test('dấu gọi nhận kỳ hạn chart cho đúng một mã', () => {
  assert.deepEqual(askedChartFor(message({ text: '!gex 1n' })), { symbol: 'GEX', period: '1n' });
  assert.deepEqual(askedChartFor(message({ text: '!gex 2d' })), { symbol: 'GEX', period: '2d' });
  assert.deepEqual(askedChartFor(message({ text: '!gex 3m' })), { symbol: 'GEX', period: '3m' });
  assert.deepEqual(askedChartFor(message({ text: '!gex 3m -v' })), { symbol: 'GEX', period: '3m' });
  assert.deepEqual(askedChartFor(message({ text: '!gex -v' })), null);
  assert.deepEqual(askedChartFor(message({ text: '!gex 2y' })), { symbol: 'GEX', period: '2y' });
  assert.deepEqual(askedChartFor(message({ text: '  !gex 6M' })), { symbol: 'GEX', period: '6m' });
  assert.equal(askedChartFor(message({ text: '!gex 1n hpg' })), null);
  assert.equal(askedChartFor(message({ text: '!tin gex' })), null);
  assert.equal(askedChartFor(message({ text: '!gex 0d' })), null);
});

test('!vboa là lệnh bản đồ nhiệt, không phải mã VBOA', () => {
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa' })), { addressed: true });
  assert.deepEqual(askedHeatmapFor(message({ text: '  !vboa bds' })), {
    addressed: true,
    filter: { key: 'bds', title: 'Bất động sản', sectors: ['Bất động sản'] },
  });
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa bank' })).filter.title, 'Bank chứng');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa oil' })).filter.title, 'Dầu khí');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa retail' })).filter.title, 'Bán lẻ');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa cn' })).filter.title, 'Công nghiệp');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa bank -v' })).filter.title, 'Bank chứng');
  assert.match(askedHeatmapFor(message({ text: '  !vboa hom nay' })).error, /Chỉ hỗ trợ/);
  assert.equal(askedHeatmapFor(message({ text: '!vic' })), null);
});

test('!vboa trả bản đồ nhiệt bằng ảnh SVG', async () => {
  const heatmap = stubHeatmap();
  const { sent } = await withBot([update({ text: '!vboa' })], { heatmap });

  assert.equal(heatmap.calls.length, 1);
  assert.equal(heatmap.calls[0].asked.filter, undefined);
  assert.equal(sent[0].text, 'Bản đồ nhiệt VN 07/09/2026');
  assert.equal(sent[0].text.split('\n').length, 1);
  assert.equal(sent[0].image.fileName, 'vboa-2026-09-07.svg');
  assert.match(sent[0].image.svg, /width="2560" height="1440" viewBox="0 0 1280 720"/);
  assert.match(sent[0].image.svg, /Tài chính/);
  assert.match(sent[0].image.svg, /Nguyên vật liệu/);
  assert.match(sent[0].image.svg, /Công nghệ thông tin/);
  assert.match(sent[0].image.svg, />VIC</);
  assert.equal(sent[0].replyToMessageId, 'm1');
});

test('!vboa bds chỉ vẽ nhóm bất động sản', async () => {
  const heatmap = stubHeatmap();
  const { sent } = await withBot([update({ text: '!vboa bds' })], { heatmap });

  assert.equal(heatmap.calls[0].asked.filter.key, 'bds');
  assert.equal(sent[0].text, 'Bản đồ nhiệt VN Bất động sản 07/09/2026');
  assert.equal(sent[0].image.fileName, 'vboa-bds-2026-09-07.svg');
  assert.match(sent[0].image.svg, /Bất động sản/);
  assert.match(sent[0].image.svg, />VIC</);
  assert.doesNotMatch(sent[0].image.svg, />HPG</);
});

test('!vboa -v chỉ gửi bản đồ nhiệt cho người gõ', async () => {
  const heatmap = stubHeatmap();
  const { sent } = await withBot([update({ text: '!vboa bank -v' })], { heatmap });

  assert.equal(heatmap.calls[0].asked.filter.key, 'bank');
  assert.equal(sent[0].onlyForUserId, 'u1');
  assert.equal(sent[0].text, 'Bản đồ nhiệt VN Bank chứng 07/09/2026');
  assert.equal(sent[0].image.fileName, 'vboa-bank-2026-09-07.svg');
});

test('!vboa lấy tối đa 500 mã thanh khoản lớn nhất', () => {
  const quotes = Array.from({ length: 501 }, (_, index) => normalize({
    ...VIC,
    sym: `X${String(index + 1).padStart(3, '0')}`,
    lastPrice: 10,
    r: 10,
    c: 10.7,
    f: 9.3,
    lot: 501 - index,
  }));
  const rich = heatmapRich(quotes, { at: new Date('2026-09-07T03:00:00Z') });

  assert.match(rich.image.svg, /data-symbol="X500"/);
  assert.doesNotMatch(rich.image.svg, /data-symbol="X501"/);
});

test('!vboa không nhận ngành ngoài danh sách hỗ trợ', async () => {
  const heatmap = stubHeatmap();
  const { sent } = await withBot([update({ text: '!vboa thep' })], { heatmap });

  assert.equal(heatmap.calls.length, 0);
  assert.equal(sent[0].text, 'Chỉ hỗ trợ: !vboa bds, !vboa bank, !vboa oil, !vboa retail, !vboa cn.');
});

test('nguồn bản đồ nhiệt chết thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!vboa' })], { heatmap: stubHeatmap({ broken: true }) });
  assert.equal(sent[0].text, SORRY.source);
});

test('kỳ hạn chart được đọc động từ số và đơn vị', () => {
  assert.deepEqual(
    pickPeriod(parseChartPeriod('1d')),
    { key: '1d', count: 1, unit: 'd', label: '1 ngày', intraday: true, limit: null },
  );
  assert.deepEqual(
    pickPeriod(parseChartPeriod('12m')),
    { key: '12m', count: 12, unit: 'm', label: '12 tháng', intraday: false, limit: null },
  );
  assert.deepEqual(
    pickPeriod(parseChartPeriod('4y')),
    { key: '4y', count: 4, unit: 'y', label: '4 năm', intraday: false, limit: null },
  );
  assert.deepEqual(
    pickPeriod(parseChartPeriod('5n')),
    { key: '5n', count: 5, unit: 'y', label: '5 năm', intraday: false, limit: null },
  );
  assert.equal(parseChartPeriod('21y'), null);
});

test('hỏi một mã bằng dấu gọi thì kèm chart trong rich message', async () => {
  const rich = chartRich({
    symbol: 'VIX',
    day: '2026-09-07',
    labels: ['09:15', '09:20', '09:25'],
    closes: [13.2, 13.35, 13.4],
    open: 13.2,
    close: 13.4,
    high: 13.45,
    low: 13.15,
    change: 0.2,
    percent: 1.52,
  }, normalize({ ...VIC, sym: 'VIX', r: 13.1, lastPrice: 13.4 }));
  const chart = stubChart({ rich });
  const { sent } = await withBot(
    [update({ text: '!vix' })],
    { market: stubMarket({ listed: ['VIX'] }), chart },
  );

  assert.deepEqual(chart.calls.map((call) => call.symbol), ['VIX']);
  assert.match(sent[0].text, /^VIX 256,1/);
  assert.equal(sent[0].image.fileName, 'vix-2026-09-07.svg');
  assert.match(sent[0].image.svg, /<line x1="86" y1="64" x2="86"/);
  assert.match(sent[0].image.svg, />13,45</);
  assert.match(sent[0].image.svg, />13,2</);
  assert.match(sent[0].image.svg, />13,15</);
  assert.equal(sent[0].rich.blocks[0].type, 'paragraph');
  assert.match(sent[0].rich.blocks[1].text, /Cao 13,45 \(\+250đ\)/);
});

test('hỏi một mã kèm kỳ hạn thì chart nhận kỳ hạn đó', async () => {
  const rich = chartRich(rangeSession('GEX', {
    t: [
      Date.parse('2025-09-08T03:00:00Z') / 1000,
      Date.parse('2026-03-09T03:00:00Z') / 1000,
      Date.parse('2026-09-08T03:00:00Z') / 1000,
    ],
    c: [18, 22.5, 26.2],
    h: [18.4, 23, 26.8],
    l: [17.8, 21.9, 25.7],
    v: [1000, 2000, 3000],
  }, { key: '1n', label: '1 năm' }));
  const chart = stubChart({ rich });
  const { sent } = await withBot(
    [update({ text: '!gex 1n' })],
    { market: stubMarket({ listed: ['GEX'] }), chart },
  );

  assert.deepEqual(chart.calls.map((call) => [call.symbol, call.period]), [['GEX', '1n']]);
  assert.equal(sent[0].image.fileName, 'gex-1n-2026-09-08.svg');
  assert.match(sent[0].image.svg, /GEX 1 năm đến 08\/09\/2026/);
  assert.match(sent[0].rich.blocks[1].text, /Đầu kỳ 18 · Cao 26,8 · Thấp 17,8 · Cuối kỳ 26,2 · KL 6\.000/);
});

test('hỏi chart với -v thì chỉ gửi cho người gõ', async () => {
  const rich = chartRich(rangeSession('GEX', {
    t: [
      Date.parse('2026-07-08T03:00:00Z') / 1000,
      Date.parse('2026-08-08T03:00:00Z') / 1000,
      Date.parse('2026-09-08T03:00:00Z') / 1000,
    ],
    c: [18, 20, 21],
    h: [18.4, 20.2, 21.2],
    l: [17.8, 19.7, 20.8],
    v: [1000, 2000, 3000],
  }, { key: '3m', label: '3 tháng' }));
  const chart = stubChart({ rich });
  const { sent } = await withBot(
    [update({ text: '!gex 3m -v' })],
    { market: stubMarket({ listed: ['GEX'] }), chart },
  );

  assert.deepEqual(chart.calls.map((call) => [call.symbol, call.period]), [['GEX', '3m']]);
  assert.equal(sent[0].onlyForUserId, 'u1');
  assert.equal(sent[0].image.fileName, 'gex-3m-2026-09-08.svg');
});

test('chart 1d dùng nến trong phiên, còn kỳ hạn dài dùng nến ngày', async () => {
  const urls = [];
  const chart = intradayChart({
    now: () => Date.parse('2026-09-09T08:00:00Z'),
    async fetchImpl(url) {
      urls.push(String(url));
      const daily = String(url).includes('resolution=1D');
      return new Response(JSON.stringify(daily
        ? {
          t: [
            Date.parse('2026-09-07T03:00:00Z') / 1000,
            Date.parse('2026-09-08T03:00:00Z') / 1000,
            Date.parse('2026-09-09T03:00:00Z') / 1000,
          ],
          c: [18, 19, 20],
          h: [18.2, 19.2, 20.2],
          l: [17.8, 18.8, 19.8],
          v: [100, 200, 300],
        }
        : {
          t: [
            Date.parse('2026-09-09T02:15:00Z') / 1000,
            Date.parse('2026-09-09T02:20:00Z') / 1000,
          ],
          c: [18, 18.1],
          h: [18.1, 18.2],
          l: [17.9, 18],
          v: [100, 200],
        }));
    },
  });

  await chart.rich('GEX', {}, '1d');
  const ranged = await chart.rich('GEX', {}, '2d');

  assert.match(urls[0], /resolution=5/);
  assert.match(urls[1], /resolution=1D/);
  assert.equal(ranged.image.fileName, 'gex-2d-2026-09-09.svg');
  assert.match(ranged.blocks[0].text, /Đầu kỳ 19/);
});

test('chart nhiều điểm thì nhãn trục X trải tới cuối phiên', () => {
  const labels = Array.from({ length: 46 }, (_, index) => `${String(9 + Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}`);
  labels[0] = '09:15';
  labels[45] = '14:45';
  const rich = chartRich({
    symbol: 'NVL',
    day: '2026-09-09',
    labels,
    closes: Array.from({ length: 46 }, (_, index) => 12.9 + index / 100),
    open: 12.9,
    close: 13,
    high: 13,
    low: 12.7,
    change: 0.1,
    percent: 0.78,
  }, { reference: 12.9 });

  assert.match(rich.image.svg, />09:15</);
  assert.match(rich.image.svg, />14:45</);
  assert.doesNotMatch(rich.image.svg, />09:40</);
});

test('chart vẽ biến động theo đồng để không bị bẹt sát trục 0', () => {
  const rich = chartRich({
    symbol: 'BSR',
    day: '2026-09-09',
    labels: ['09:15', '10:00', '13:00', '14:45'],
    closes: [27.35, 28.2, 27.15, 27.35],
    open: 27.35,
    close: 27.35,
    high: 28.2,
    low: 27.15,
    change: 0,
    percent: 0,
  }, { reference: 27 });

  assert.match(rich.image.svg, />28,2</);
  assert.match(rich.image.svg, />27,35</);
  assert.match(rich.image.svg, />27,15</);
  assert.match(rich.image.svg, /<polyline points=/);
  assert.doesNotMatch(rich.blocks[0].text, /Thang Y/);
  assert.match(rich.blocks[0].text, /Cao 28,2 \(\+850đ\)/);
  assert.match(rich.blocks[0].text, /Thấp 27,15 \(-200đ\)/);
});

test('hỏi nhiều mã thì không kèm chart', async () => {
  const chart = stubChart();
  const { sent } = await withBot([update({ text: '!vic hpg' })], { chart });
  assert.deepEqual(chart.calls, []);
  assert.equal(sent[0].rich, undefined);
});

test('nguồn chart chết thì vẫn trả giá', async () => {
  const chart = stubChart({ broken: true });
  const { sent } = await withBot([update({ text: '!vic' })], { chart });
  assert.deepEqual(chart.calls.map((call) => call.symbol), ['VIC']);
  assert.match(sent[0].text, /^VIC 256,1/);
  assert.equal(sent[0].rich, undefined);
});

test('!tin vic là lệnh tin tức, không bị đọc thành giá TIN và VIC', async () => {
  const news = stubNews();
  const { sent } = await withBot([update({ text: '!tin vic' })], { news });
  assert.deepEqual(news.calls, ['VIC']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^5 bài viết gần nhất về VIC:\n1\. VIC mở rộng dự án mới/);
  assert.equal(sent[0].text.split('\n').length, 6);
  assert.doesNotMatch(sent[0].text, /https:\/\/example\.test\/vic\/1/);
  assert.equal(sent[0].rich.blocks[1].entities[0].url, 'https://example.test/vic/1');
  assert.doesNotMatch(sent[0].text, /^TIN /m);
});

test('!tin chạy động cho mọi mã hợp lệ', async () => {
  const news = stubNews();
  const { sent } = await withBot([update({ text: '!tin fpt' })], { news });
  assert.deepEqual(news.calls, ['FPT']);
  assert.match(sent[0].text, /^5 bài viết gần nhất về FPT:/);
  assert.doesNotMatch(sent[0].text, /https:\/\/example\.test\/fpt\/1/);
  assert.equal(sent[0].rich.blocks[1].entities[0].url, 'https://example.test/fpt/1');
});

test('tin tức giấu 5 link trong rich text thay vì in URL dài ra ngoài', async () => {
  const news = stubNews();
  const { sent } = await withBot([update({ text: '!tin mwg' })], { news });
  assert.deepEqual(news.calls, ['MWG']);
  assert.equal(sent[0].text.match(/https:\/\/example\.test\/mwg\//g), null);
  assert.equal(sent[0].rich.blocks.slice(1).flatMap((block) => block.entities).length, 5);
  assert.equal(sent[0].rich.blocks[1].entities[0].offset, 3);
  assert.ok(sent[0].text.length <= MAX_NEWS_REPLY_CHARS);
});

test('rich text bọc link quanh tiêu đề bài viết', () => {
  const message = newsMessage('MWG', [{
    title: 'Một tiêu đề',
    source: 'Báo A',
    link: 'https://bao-a.test/mwg',
    publishedAt: new Date('2026-09-08T02:30:00Z'),
  }]);

  assert.equal(message.text, '5 bài viết gần nhất về MWG:\n1. Một tiêu đề (Báo A · 09:30 08-09)');
  assert.deepEqual(message.rich.blocks[1].entities, [{
    type: 'link',
    offset: 3,
    length: 'Một tiêu đề'.length,
    url: 'https://bao-a.test/mwg',
  }]);
});

test('nguồn tin đổi link Google News thành link gốc của bài báo', async () => {
  const seen = [];
  const feed = `<?xml version="1.0"?>
    <rss><channel><item>
      <title><![CDATA[FPT có tin mới - Báo Gốc]]></title>
      <link>https://news.google.com/rss/articles/ABCDEF?oc=5</link>
      <source>Báo Gốc</source>
      <description><![CDATA[FPT có tin mới]]></description>
      <pubDate>Tue, 08 Sep 2026 02:30:00 GMT</pubDate>
    </item></channel></rss>`;

  const news = googleNews({
    async fetcher(url, options = {}) {
      seen.push({ url: String(url), method: options.method ?? 'GET' });
      if (String(url).startsWith('https://news.google.com/rss/search')) return new Response(feed);
      if (String(url).startsWith('https://news.google.com/rss/articles/ABCDEF')) {
        return new Response('<c-wiz><div data-n-a-sg="sig" data-n-a-ts="1788858484"></div></c-wiz>');
      }
      if (String(url).startsWith('https://news.google.com/_/DotsSplashUi/data/batchexecute')) {
        return new Response(')]}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://bao-goc.test/fpt\\",1]"]]');
      }
      throw new Error(`không mong fetch ${url}`);
    },
  });

  const articles = await news.latest('FPT');
  assert.equal(articles[0].link, 'https://bao-goc.test/fpt');
  assert.deepEqual(seen.map((call) => call.method), ['GET', 'GET', 'POST']);
});

test('!tin một mình thì nhắc cú pháp, còn giá mã TIN là !view tin', async () => {
  assert.match(askedNewsFor(message({ text: '!tin' })).error, /!tin vic/);

  const news = stubNews();
  const { sent } = await withBot(
    [update({ text: '!view tin', command: 'view', commandArgs: 'tin', commandPrefix: '!', private: true })],
    { market: stubMarket({ listed: ['TIN'] }), news },
  );
  assert.deepEqual(news.calls, []);
  assert.match(sent[0].text, /^TIN 256,1/);
});

test('!tin chỉ nhận một mã tin tức mỗi lần', async () => {
  const news = stubNews();
  const { sent } = await withBot([update({ text: '!tin vic gex' })], { news });
  assert.deepEqual(news.calls, []);
  assert.equal(sent[0].text, 'Mỗi lần chỉ xem tin cho một mã, ví dụ: !tin vic.');
  assert.doesNotMatch(sent[0].text, /^TIN /m);
});

test('!ptkt đọc đúng một mã, và không bị đọc thành giá PTKT', () => {
  assert.deepEqual(askedTechnicalFor(message({ text: '!ptkt vic' })), { addressed: true, symbol: 'VIC' });
  assert.deepEqual(askedTechnicalFor(message({ text: '!PTKT hpg -v' })), { addressed: true, symbol: 'HPG' });
  assert.match(askedTechnicalFor(message({ text: '!ptkt' })).error, /ví dụ: !ptkt vic/);
  assert.match(askedTechnicalFor(message({ text: '!ptkt vic hpg' })).error, /một mã/);
  assert.equal(askedTechnicalFor(message({ text: 'ptkt vic' })), null);
  assert.equal(askedTechnicalFor(message({ text: '!tin vic' })), null);
});

test('!ptkt vic gửi bài phân tích của đúng mã ấy, một tin nhắn', async () => {
  const technical = stubTechnical();
  const { sent } = await withBot([update({ text: '!ptkt vic' })], { technical });
  assert.deepEqual(technical.calls, ['VIC']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^PTKT VIC · /);
  assert.equal(sent[0].image.fileName, 'ptkt-vic-2026-09-11.svg');   // hình đi cùng chữ, một tin nhắn
  assert.equal(sent[0].replyToMessageId, 'm1');
});

test('!ptkt nhiều mã thì nhắc cú pháp, không phân tích mã nào', async () => {
  const technical = stubTechnical();
  const { sent } = await withBot([update({ text: '!ptkt vic hpg' })], { technical });
  assert.deepEqual(technical.calls, []);
  assert.equal(sent[0].text, 'Mỗi lần chỉ phân tích kỹ thuật một mã, ví dụ: !ptkt vic.');
});

test('!ptkt kèm -v thì chỉ gửi cho người hỏi', async () => {
  const { sent } = await withBot([update({ text: '!ptkt vic -v' })]);
  assert.equal(sent[0].onlyForUserId, 'u1');
});

test('nguồn nến chết khi !ptkt thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!ptkt vic' })], { technical: stubTechnical({ broken: true }) });
  assert.equal(sent[0].text, SORRY.source);
});

// ---- lệnh ! theo tài liệu 15/09/2026 ----------------------------------------------------------

test('lệnh máy chủ đã tách thì đọc theo command và commandArgs, kể cả khi gọi @tênbot', () => {
  const privateCall = message({
    text: '!ptkt@bocobot vic', command: 'ptkt', commandArgs: 'vic', commandPrefix: '!', private: true,
  });
  assert.equal(canonicalMessage(privateCall, ME).text, '!ptkt vic');
  assert.deepEqual(askedTechnicalFor(canonicalMessage(privateCall, ME)), { addressed: true, symbol: 'VIC' });

  const slash = message({ text: '/gia vic hpg', command: 'gia', commandArgs: 'vic hpg', commandPrefix: '/' });
  assert.deepEqual(askedFor(canonicalMessage(slash, ME), ME).symbols, ['VIC', 'HPG']);
  assert.deepEqual(askedFor(message({ text: '!gia vic' }), ME).symbols, ['VIC']);
});

test('dấu ！ toàn độ rộng, ký tự vô hình và @tênbot trong chữ của phòng vẫn là lệnh của bot này', () => {
  assert.deepEqual(askedFor(canonicalMessage(message({ text: '\u200B ！ｖｉｃ' }), ME), ME).symbols, ['VIC']);
  assert.deepEqual(askedFor(canonicalMessage(message({ text: '!vic@bocobot hpg' }), ME), ME).symbols, ['VIC', 'HPG']);
  assert.equal(canonicalMessage(message({ text: '!ptkt@botkhac vic' }), ME), null);
});

test('lệnh riêng !ptkt@bocobot được trả lời bằng tin cho đúng người gõ, không reply', async () => {
  const technical = stubTechnical();
  const { sent } = await withBot(
    [update({ text: '!ptkt@bocobot vic', command: 'ptkt', commandArgs: 'vic', commandPrefix: '!', private: true })],
    { technical },
  );
  assert.deepEqual(technical.calls, ['VIC']);
  assert.equal(sent[0].onlyForUserId, 'u1');           // chỉ người gõ thấy, như -v
  assert.equal(sent[0].replyToMessageId, undefined);
});

test('lệnh riêng khai báo sẵn như !vic tới bot thì vẫn ra giá', async () => {
  const { sent } = await withBot([update({ text: '!vic', command: 'vic', commandArgs: null, commandPrefix: '!', private: true })]);
  assert.match(sent[0].text, /^VIC 256,1/);
});

test('lệnh lạ gọi đích danh bot vẫn được trả lời, không im', async () => {
  const { sent } = await withBot([update({ text: '!xyz@bocobot', command: 'xyz', commandArgs: null, commandPrefix: '!', private: true })]);
  assert.equal(sent.length, 1);
});

test('lệnh khai báo là tên của chính bot, không viết cứng bocobot', () => {
  assert.deepEqual(commandsFor(TOP_ME).map((one) => one.command), ['view', 'ptkt', 'tin', 'vboa', 'topbot']);
  assert.deepEqual(commandsFor(ME).map((one) => one.command), ['view', 'ptkt', 'tin', 'vboa', 'bocobot']);
  assert.deepEqual(askedHelpFor(message({ text: '!topbot' }), TOP_ME), { addressed: true });
});

test('!help@bocobot và !bocobot trả hướng dẫn, còn !help nói giữa phòng thì không', async () => {
  const { sent } = await withBot([update({ text: '!help@bocobot', command: 'help', commandArgs: null, commandPrefix: '!', private: true })]);
  assert.equal(sent[0].text, HELP);
  assert.deepEqual(askedHelpFor(message({ text: '!bocobot' }), ME), { addressed: true });
  assert.equal(askedHelpFor(message({ text: '!help' }), ME), null);
});

test('!view vic là giá VIC như !vic trước đây, cả khi máy chủ đã tách lệnh lẫn khi đọc chữ của phòng', () => {
  const delivered = canonicalMessage(message({
    text: '!view vic hpg', command: 'view', commandArgs: 'vic hpg', commandPrefix: '!', private: true,
  }), ME);
  assert.equal(delivered.text, '!vic hpg');
  assert.deepEqual(askedFor(delivered, ME).symbols, ['VIC', 'HPG']);

  const slash = canonicalMessage(message({ text: '/view gex 3m', command: 'view', commandArgs: 'gex 3m', commandPrefix: '/' }), ME);
  assert.deepEqual(askedChartFor(slash), { symbol: 'GEX', period: '3m' });

  assert.equal(canonicalMessage(message({ text: '!view vic' }), ME).text, '!vic');
  assert.equal(canonicalMessage(message({ text: '!vic' }), ME).text, '!vic');   // lối cũ vẫn đọc được
});

// ---- phân tích kỹ thuật ---------------------------------------------------------------------

const candles = (length, price, { volume = 2e6 } = {}) => Array.from({ length }, (_, i) => {
  const close = price(i);
  return { time: 1754013600 + i * 86400, open: i ? price(i - 1) : close, high: close * 1.01, low: close * 0.99, close, volume };
});
const SATURDAY = new Date('2026-09-12T03:00:00Z');
const INDEX_ROWS = candles(260, (i) => 1000 * 1.001 ** i);
const RISING = candles(260, (i) => 20 * 1.004 ** i * (1 + 0.02 * Math.sin(i / 3)));
const FALLING = candles(260, (i) => 40 * 0.996 ** i * (1 + 0.02 * Math.sin(i / 3)));
const asRaw = (rows) => ({
  t: rows.map((row) => row.time), o: rows.map((row) => row.open), h: rows.map((row) => row.high),
  l: rows.map((row) => row.low), c: rows.map((row) => row.close), v: rows.map((row) => row.volume),
});

test('chỉ báo tính đúng trên những chuỗi kiểm được bằng tay', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.equal(rsi(Array.from({ length: 16 }, (_, i) => i + 1), 14).at(-1), 100);
  assert.equal(rsi(Array.from({ length: 16 }, (_, i) => 16 - i), 14).at(-1), 0);
  assert.ok(Math.abs(atr(candles(20, () => 10), 14).at(-1) - 0.2) < 1e-9);
});

test('xu hướng tăng ra tích cực, kèm điểm mua dưới giá và cắt lỗ dưới điểm mua', () => {
  const analysis = analyze('ABC', RISING, INDEX_ROWS, { at: SATURDAY });
  assert.equal(analysis.verdict, 'positive');
  assert.ok(analysis.steps.length >= 6 && analysis.steps.length <= 10);

  const { plan } = analysis;
  assert.ok(plan.stop < plan.buy[0]);
  assert.ok(plan.buy[0] <= plan.buy[1]);
  assert.ok(plan.buy[1] <= analysis.close);
  assert.ok(plan.targets[0] > analysis.close);

  const text = technicalMessage(analysis);
  assert.match(text, /^PTKT ABC · phiên /);
  assert.match(text, /\nTÍCH CỰC · tin cậy (CAO|TRUNG BÌNH|THẤP) \(/);
  assert.match(text, /\nMua: .+ hoặc khi vượt /);
  assert.match(text, /\nChốt lời: .+ · Cắt lỗ: /);
  assert.equal(text.split('\n').filter((line) => line.startsWith('- ')).length, analysis.steps.length);
});

test('!ptkt trả vài dòng chữ ngắn, còn con số nằm trên hình SVG', () => {
  const reply = technicalRich(analyze('ABC', RISING, INDEX_ROWS, { at: SATURDAY }));
  assert.ok(reply.text.length <= 700, `${reply.text.length} ký tự`);
  assert.ok(reply.text.split('\n').every((line) => line.length <= 90));
  assert.equal(reply.rich.blocks[0].text, reply.text);
  assert.match(reply.image.fileName, /^ptkt-abc-\d{4}-\d{2}-\d{2}\.svg$/);

  const { svg } = reply.image;
  assert.match(svg, /width="2000" height="2600" viewBox="0 0 1000 1300"/);
  for (const label of ['TÍCH CỰC', 'MA20', 'MA50', 'MA200', 'Mua ', 'Chốt lời', 'Cắt lỗ', 'TB20', 'quá mua', 'quá bán', 'Tín hiệu']) {
    assert.ok(svg.includes(label), `thiếu ${label}`);
  }
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
});

test('xu hướng giảm ra tiêu cực và không khuyên mua', () => {
  const analysis = analyze('ABC', FALLING, INDEX_ROWS, { at: SATURDAY });
  assert.equal(analysis.verdict, 'negative');
  const text = technicalMessage(analysis);
  assert.match(text, /\nTIÊU CỰC · /);
  assert.match(text, /\nMua: chưa/);

  const { svg } = technicalRich(analysis).image;
  assert.ok(svg.includes('TIÊU CỰC'));
  assert.ok(svg.includes('Bán '));
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
});

test('chưa đủ nến thì không phân tích, thiếu VN-Index thì bỏ hai bước so với thị trường', () => {
  assert.equal(analyze('ABC', RISING.slice(0, 34), INDEX_ROWS, { at: SATURDAY }), null);
  const withMarket = analyze('ABC', RISING, INDEX_ROWS, { at: SATURDAY });
  const alone = analyze('ABC', RISING, null, { at: SATURDAY });
  assert.equal(withMarket.steps.length - alone.steps.length, 2);
  assert.ok(alone.steps.length >= 6);
  assert.doesNotMatch(technicalMessage(alone), /VN-Index/);
});

test('nguồn nến: mã không có thật là không có dữ liệu, VN-Index hỏng thì vẫn phân tích', async () => {
  const fetched = [];
  const technical = technicalAnalysis({
    now: () => SATURDAY.getTime(),
    async fetchImpl(url) {
      fetched.push(String(url));
      if (/symbol=ZZZZ/.test(url)) return new Response('{}', { status: 400 });
      if (/symbol=VNINDEX/.test(url)) return new Response('lỗi', { status: 502 });
      return Response.json(asRaw(RISING));
    },
  });

  assert.equal(await technical.report('zzzz'), 'ZZZZ — không có dữ liệu');
  const reply = await technical.report('abc');
  assert.match(reply.text, /^PTKT ABC · /);
  assert.doesNotMatch(reply.text, /VN-Index/);
  assert.match(reply.image.svg, /^<svg /);
  assert.ok(fetched.some((url) => url.includes('/stock?') && url.includes('resolution=1D')));
});

test('nguồn nến chết hẳn thì ném, để bot nói nguồn đang không trả lời', async () => {
  const technical = technicalAnalysis({ fetchImpl: async () => new Response('lỗi', { status: 503 }) });
  await assert.rejects(technical.report('VIC'));
});

test('nguồn tin chết thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!tin vic' })], { news: stubNews({ broken: true }) });
  assert.equal(sent[0].text, SORRY.news);
});

test('khởi động là thay danh sách lệnh cũ bằng đúng một lệnh bocobot, không khai báo mã nào', async () => {
  // Mã đã khai báo thì `!vic` thành lệnh riêng và biến khỏi nhóm. Nên gửi đúng một từ: tên bot.
  const { registered } = await withBot([], { expect: 0 });
  assert.deepEqual(registered.map((one) => one.command), ['view', 'ptkt', 'tin', 'vboa', 'bocobot']);
  assert.ok(registered.every((one) => one.description.length <= 256));
});
