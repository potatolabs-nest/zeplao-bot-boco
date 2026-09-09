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

import { askedChartFor, askedFor, askedNewsFor, run, SORRY } from './bocobot.mjs';
import { normalize } from './market/quote.mjs';
import { chartRich, rangeSession } from './market/chart.mjs';
import { googleNews, MAX_NEWS_REPLY_CHARS, newsMessage } from './market/news.mjs';

const ME = { username: 'bocobot', displayName: 'Bảng giá' };
const message = (fields) => ({ conversationId: 'p1', conversationType: 'group', messageId: 'm1', ...fields });

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

test('nhắn riêng thì không phải gọi tên', () => {
  const asked = askedFor(message({ conversationType: 'direct', text: 'vic' }), ME);
  assert.deepEqual(asked.symbols, ['VIC']);
  assert.equal(asked.addressed, false);   // trả lời cái tra được, và im khi không có gì
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

/**
 * Cho bot chạy tới khi nó đã làm xong việc, rồi bảo nó dừng.
 *
 * `settle` là một khoảng lặng có chủ ý: để chứng minh bot **không** gửi gì thì phải cho nó đủ
 * thời gian để gửi. Một bài test khẳng định sự im lặng mà không đợi thì chỉ đang đo tốc độ máy.
 */
async function withBot(
  updates,
  { market = stubMarket(), news = stubNews(), chart = stubChart(), expect = 1, settle = 200 } = {},
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
  assert.deepEqual(askedChartFor(message({ text: '  !gex 6M' })), { symbol: 'GEX', period: '6m' });
  assert.equal(askedChartFor(message({ text: '!gex 1n hpg' })), null);
  assert.equal(askedChartFor(message({ text: '!tin gex' })), null);
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

test('!tin một mình vẫn là hỏi giá mã TIN', async () => {
  assert.equal(askedNewsFor(message({ text: '!tin' })), null);

  const news = stubNews();
  const { sent } = await withBot(
    [update({ text: '!tin' })],
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

test('nguồn tin chết thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!tin vic' })], { news: stubNews({ broken: true }) });
  assert.equal(sent[0].text, SORRY.news);
});

test('khởi động là xoá sạch danh sách lệnh cũ', async () => {
  // Không đăng ký gì cả, và nói ra điều đó: `setCommands` thay nguyên si, nên một danh sách
  // rỗng là cách duy nhất dọn những gì đã đăng ký ở lần chạy trước.
  const { registered } = await withBot([], { expect: 0 });
  assert.deepEqual(registered, []);
});
