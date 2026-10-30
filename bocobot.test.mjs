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
  askedChartFor, askedFor, askedGoldFor, askedHelpFor, askedNewsFor, askedResultsFor, askedLiquidityFor, askedScreenFor, askedSuggestFor, askedTechnicalFor, askedWorldFor, boardSymbols, canonicalMessage, commandsFor, HELP, MOST_COMMANDS,
  privateRecipientFor, run, WORLD_COMMAND,
  SORRY,
} from './bocobot.mjs';
import { MOST_TEXT, normalize } from './market/quote.mjs';
import { chartRich, intradayChart, parseChartPeriod, rangeSession, withSessionData } from './market/chart.mjs';
import { askedHeatmapFor, boardState, heatmapRich } from './market/heatmap.mjs';
import { googleNews, MAX_NEWS_REPLY_CHARS, newsMessage } from './market/news.mjs';
import { GLOSSARY, TERM_VIEW, termEntities, withTerms } from './market/glossary.mjs';
import { MOST_SEGMENTS, parseResultsPeriod, resultsMessage, resultsRich, resultsSvg } from './market/results.mjs';
import { pickPeriod as pickReportPeriod, profileOf, vietcapReport, vietcapResults } from './market/vietcap.mjs';
import { COMPANY_VIEW } from './market/company.mjs';
import { publishWidget, widgetFiles, zip } from './widget.mjs';
import { compare, liquidityRich, sessionsFrom } from './market/liquidity.mjs';
import { btmcSilver, mihongGold, vnGold, vnGoldText, vnSilver, vnSilverText, worldQuote, worldText, yahooQuotes } from './market/gold.mjs';
import { MIN_MARKET_CAP, suggestions, suggestMessage, suggestRich, withQuote } from './market/suggest.mjs';
import {
  analyze, atr, ema, rsi, sma, technicalAnalysis, technicalMessage, technicalRich, withSession,
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
const hasViewEntity = (body) => [...(body.entities ?? []), ...(body.rich?.blocks ?? []).flatMap((block) => block.entities ?? [])]
  .some((entity) => entity?.type === 'view')
  || (body.keyboard?.rows ?? []).flat().some((button) => button?.view);

async function stubApi(updates, {
  refuseImages = false, refuseViews = false, widgetAnswers = [], keepCommands = null, refuseSessions = false,
  quiet = false,
} = {}) {
  const sent = [];
  const registered = [];
  /// Mọi lần khai báo, theo thứ tự — `registered` chỉ giữ lần cuối, mà cái hỏng nằm ở lần đầu.
  const declares = [];
  /// Số lần bot đọc lại danh sách lệnh sau khi khai — mốc để biết nó đã biết kết quả.
  let readBack = 0;
  /// Phiên bảng nhiệt: mở, cho ai xem, và những gói đã đẩy.
  const sessions = [];
  const shown = [];
  /// Mọi lần bot sửa hồ sơ của chính nó.
  const settings = [];
  /// Những phiên bot tự đóng.
  const ended = [];
  const pushes = [];
  const widgets = [];
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

      // Kèm đúng danh sách lệnh đã khai: bot đọc lại chỗ này để biết máy chủ có giữ đủ không.
      // `keepCommands` là máy chủ giữ thiếu — đúng thứ đang bị nghi ngoài đời thật.
      if (path === '/getMe') {
        if (declares.length) readBack += 1;
        return answer({ ...ME, quietMention: quiet, commands: keepCommands === null ? registered : registered.slice(0, keepCommands) });
      }
      if (path === '/setMe') {
        settings.push(JSON.parse(body));
        return answer({ ...ME, ...JSON.parse(body) });
      }
      if (path === '/setCommands') {
        const { commands } = JSON.parse(body);
        registered.splice(0, registered.length, ...commands);
        declares.push(commands.map((one) => one.command));
        return answer({ ok: true });
      }
      if (path === '/endSessions') return answer({ ended: 0 });
      if (path === '/endSession') { ended.push(JSON.parse(body)); return answer({ ok: true }); }
      if (path === '/createSession') {
        if (refuseSessions) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end('{"error":"bot_not_in_conversation","message":"This bot is not in that conversation."}');
          return undefined;
        }
        sessions.push(JSON.parse(body));
        return answer({ sessionId: `s${sessions.length}` });
      }
      if (path === '/showSession') {
        shown.push(JSON.parse(body));
        return answer({ ok: true });
      }
      if (path === '/pushState') {
        pushes.push(JSON.parse(body));
        return answer({ ok: true });
      }
      if (path === '/sendMessage') {
        if (refuseImages && JSON.parse(body).image) {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          return response.end('{"error":"write_not_carried_out","message":"write not carried out.","details":{}}');
        }
        if (refuseViews && hasViewEntity(JSON.parse(body))) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          return response.end('{"error":"bot_has_no_widget","message":"This bot has no widget.","details":{}}');
        }
        sent.push(JSON.parse(body));
        return answer({ messageId: `m${sent.length}` });
      }
      if (path === '/setWidget') {
        widgets.push({ contentType: request.headers['content-type'], bytes: Buffer.byteLength(body), url: request.url });
        const scripted = widgetAnswers.shift();
        if (scripted) {
          response.writeHead(scripted[0], { 'Content-Type': 'application/json' });
          return response.end(scripted[1]);
        }
        return answer({ version: 1, unchanged: false, views: { term: { entry: 'term.html', as: 'popover' } } });
      }
      if (path === '/getUpdates') {
        // Giữ tin lại tới khi bot khai báo xong, khi bài test đang kiểm chính kết quả khai báo:
        // thật thì người ta gõ sau lúc bot khởi động, còn ở đây hai việc chạy đua nhau.
        if (keepCommands !== null && !readBack) {
          await wait(20);
          return answer([]);
        }
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
  return {
    sent, registered, declares, widgets, sessions, shown, pushes, settings, ended,
    api: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
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

function stubLiquidity({ broken = false } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async rich() {
      calls += 1;
      if (broken) throw new Error('Vietcap trả lời 503');
      return {
        text: 'Thanh khoản VN-Index phiên 21/10/2026 tới 14:12: 16.535 tỷ đồng',
        image: { fileName: 'thanhkhoan-2026-10-21.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
        rich: { blocks: [] },
      };
    },
  };
}

/**
 * Vàng trong nước giả, đúng hình Mi Hồng: một chỉ, và có cả loại chỉ thu vào.
 *
 * `buyingPrice`/`sellingPrice` là đồng **một chỉ** — cái bẫy của nguồn này, nên stub giữ nguyên
 * đơn vị ấy để bài test bắt được phép nhân mười ở `vnGold`.
 */
function stubGold({ broken = false, rows = null } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async price() {
      calls += 1;
      if (broken) throw new Error('Mi Hồng trả lời 503');
      return vnGold(rows ?? [
        {
          code: 'SJC', buyingPrice: 14050000, sellingPrice: 14200000, dateTime: '27/10/2026 09:30',
        },
        {
          code: '999', buyingPrice: 14050000, sellingPrice: 14200000, dateTime: '27/10/2026 09:30',
        },
        // Chỉ thu vào, không bán ra: `sellingPrice` bằng 0, và số 0 ấy không được in thành giá.
        { code: '950', buyingPrice: 12150000, sellingPrice: 0, dateTime: '27/10/2026 09:30' },
      ]);
    },
  };
}

/**
 * Bạc trong nước giả, đúng hình BTMC: một **túi phẳng** có tên trường tự đánh số, và đơn vị ghi
 * trong tên sản phẩm.
 *
 * Stub giữ cả hai đặc điểm ấy, vì cả hai đều là chỗ dễ đọc sai: tên trường đổi số theo dòng, và
 * quy cách nằm trong chính cái tên.
 */
/// Một dòng thô của BTMC, đúng hình: tên trường tự đánh số và quy cách nằm trong chính cái tên.
const btmcSilverRow = (name, buy, sell) => ({
  '@n_1': name, '@pb_1': String(buy), '@ps_1': String(sell), '@d_1': '27/10/2026 11:40',
});

function stubSilver({ broken = false, rows = null } = {}) {
  let calls = 0;
  // Đúng thứ tự của nguồn thật: 1 KG, 5 LƯỢNG, 0,5 KG lẫn vào — chỉ dòng "1 LƯỢNG" là dùng.
  const kept = rows ?? [
    btmcSilverRow('BẠC THỎI BẠC RỒNG THĂNG LONG Ag 999 1 KG (BẠC RỒNG THĂNG LONG Ag 999)', 45892186, 48025466),
    btmcSilverRow('BẠC MIẾNG PHÚ QUÝ Ag 999 5 LƯỢNG (PHÚ QUÝ)', 8575000, 8840000),
    btmcSilverRow('BẠC MIẾNG PHÚ QUÝ Ag 999 1 LƯỢNG (PHÚ QUÝ)', 1715000, 1768000),
    btmcSilverRow('BẠC THỎI BẠC RỒNG THĂNG LONG Ag 999 0,5 KG (BẠC RỒNG THĂNG LONG Ag 999)', 22946093, 24012733),
    btmcSilverRow('BẠC MIẾNG BẠC RỒNG THĂNG LONG Ag 999 5 LƯỢNG (BẠC RỒNG THĂNG LONG Ag 999)', 8605000, 9005000),
    btmcSilverRow('BẠC MIẾNG BẠC RỒNG THĂNG LONG Ag 999 1 LƯỢNG (BẠC RỒNG THĂNG LONG Ag 999)', 1721000, 1801000),
  ];

  return {
    get calls() { return calls; },
    async price() {
      calls += 1;
      if (broken) throw new Error('BTMC trả lời 503');
      return vnSilver(kept);
    },
  };
}

/// XAU và DXY giả, đúng hình phản hồi Yahoo.
function stubWorld({ broken = false } = {}) {
  const calls = [];
  const one = (symbol, price, reference) => worldQuote(symbol, {
    chart: {
      result: [{
        meta: {
          currency: 'USD', regularMarketTime: Date.UTC(2026, 9, 27, 4, 30) / 1000,
        },
        indicators: { quote: [{ close: [reference, price] }] },
      }],
    },
  });

  return {
    calls,
    async quotes(symbols) {
      calls.push(symbols);
      if (broken) throw new Error('Yahoo trả lời 429');
      const made = {
        XAU: one('XAU', 4030.7, 4038.4),
        XAG: one('XAG', 53.31, 54.108),
        DXY: one('DXY', 102.037, 101.96),
      };
      return symbols.map((symbol) => made[symbol]).filter(Boolean);
    },
  };
}

function stubSuggest({ broken = false } = {}) {
  const calls = [];
  return {
    calls,
    async top(market, company) {
      calls.push({ market, company });
      if (broken) throw new Error('nến không trả lời');
      return { at: new Date('2026-09-07T03:00:00Z'), scanned: 0, picks: [] };
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

    /// Cùng bài ấy dạng dữ liệu, cho tab PTKT trong widget.
    async card(symbol) {
      calls.push(`card:${symbol}`);
      if (broken) throw new Error('nến không trả lời');
      return {
        day: '11/09/2026',
        live: 0,
        verdict: 'TÍCH CỰC',
        kind: 'positive',
        confidence: 'TRUNG BÌNH',
        reason: '4/5 tín hiệu cùng chiều',
        steps: [['Xu hướng tăng rõ', 2], ['RSI 60: tích cực', 1]],
        plan: ['Mua: 235,6–241,2', 'Cắt lỗ: 231,5'],
        zones: { supports: ['235,6'], resistances: ['242'] },
        chart: { close: [10, 11, 12], ma20: [null, 10.5, 11], ma50: [null, null, 10.8], first: '23/06/2026', last: '11/09/2026', support: 9.5, resistance: 12.5 },
      };
    },
  };
}

/**
 * Nguồn hồ sơ doanh nghiệp giả.
 *
 * Mặc định của `run` là nguồn thật, nên khung test phải luôn truyền cái này vào: một bộ test gọi
 * ra Vietcap là một bộ test đỏ khi mất mạng, và là một bộ test nện vào feed của người khác mỗi lần
 * ai đó chạy `npm test`.
 */
function stubCompany({ broken = false, quiet = false } = {}) {
  const calls = [];
  return {
    calls,
    async profile(symbol) {
      calls.push(symbol);
      if (broken) throw new Error('nguồn hồ sơ chết');
      if (quiet) return null;
      return {
        symbol,
        nameVi: `Công ty Cổ phần ${symbol}`,
        nameEn: `${symbol} Joint Stock Company`,
        exchange: 'HOSE',
        sector: 'Bất động sản',
        marketCap: 1873015585317700,
        shares: 7762186429,
        foreignRoom: 48,
        foreignHeld: 3.2,
        freeFloat: 30,
        listed: '19/09/2007',
        low52: 66.7,
        high52: 265,
        volume20: 6071050,
        about: 'Một công ty có thật trong bài test này.',
      };
    },
  };
}

/// Mười phiên gần nhất, giả. Mặc định của `run` gọi ra API nến ngày thật — và một bộ test đi ra
/// internet là một bộ test đỏ khi mất mạng, đỏ trên CI, và đỏ vào đúng hôm nguồn kia bảo trì.
function stubHistory({ broken = false } = {}) {
  const calls = [];
  return {
    calls,
    async rows(symbol) {
      calls.push(symbol);
      if (broken) throw new Error('nguồn nến chết');
      return [
        { day: '07/09/2026', close: 256.1, change: 11.6, percent: 4.74, volume: 7518600, value: 1925514060 },
        { day: '04/09/2026', close: 244.5, change: -2.5, percent: -1.01, volume: 6100000, value: 1491450000 },
        { day: '03/09/2026', close: 247, change: 0, percent: 0, volume: 5200000, value: 1284400000 },
      ];
    },
  };
}

/// Khối ngoại giả, khoá theo ngày như nguồn thật. Không có nó thì mỗi cú bấm trong bài test là
/// một lời gọi ra VNDirect.
function stubForeign({ broken = false } = {}) {
  return {
    async rows() {
      if (broken) throw new Error('khối ngoại không trả lời');
      return new Map([
        ['2026-09-07', { buyVolume: 664031, sellVolume: 1425400, buyValue: 160777331, sellValue: 344179900 }],
        ['2026-09-04', { buyVolume: 928009, sellVolume: 1547409, buyValue: 224201980, sellValue: 373392410 }],
      ]);
    },
  };
}

/// Bảng ngành giả. Mặc định của `run` gọi ra VNDirect, và một bộ test gọi ra internet là một bộ
/// test đỏ khi mất mạng.
function stubScreens({ broken = false, long = 0, picture = false } = {}) {
  const calls = [];
  const answer = (name) => async (asked) => {
    calls.push({ name, ...asked });
    if (broken) throw new Error('nến không trả lời');
    if (picture) {
      const text = `${name.toUpperCase()} · phiên 16/10/2026`;
      return { text, image: { fileName: `${name}-2026-10-16.svg`, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, rich: { blocks: [{ type: 'paragraph', text }] } };
    }
    if (long) return Array.from({ length: long }, (_, i) => `dòng ${i} ${'x'.repeat(40)}`).join('\n');
    return `${name.toUpperCase()}${asked.live ? ' hiện tại' : ''}${asked.sector ? ` · ${asked.sector}` : ''}`;
  };
  return { calls, strong: answer('manh'), rebound: answer('hoiphuc'), flow: answer('dongtien'), strategy: answer('strategy') };
}

function stubSectors() {
  return { async map() { return new Map([['VIC', 'Bất động sản'], ['HPG', 'Tài nguyên']]); } };
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
    suggest = stubSuggest(), liquidity = stubLiquidity(),
    results = null, company = stubCompany(), sectors = stubSectors(), board = { tickMs: 40 },
    history = stubHistory(), foreign = stubForeign(), screens = stubScreens(),
    gold = stubGold(), silver = stubSilver(), world = stubWorld(),
    expect = 1, settle = 200, refuseImages = false, refuseViews = false, widgetAnswers = [], keepCommands = null,
    refuseSessions = false, quiet = false,
    // 10:00 thứ Hai: sàn đang mở, không có dòng ghi chú. Bài nào cần sàn đóng thì đưa giờ khác vào.
    at = () => new Date('2026-09-07T03:00:00Z'),
  } = {},
) {
  const platform = await stubApi(updates, { refuseImages, refuseViews, widgetAnswers, keepCommands, refuseSessions, quiet });
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
    suggest,
    liquidity,
    results,
    company,
    history,
    foreign,
    screens,
    sectors,
    board,
    gold,
    silver,
    world,
    statePath,
    at,
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

test('nghe được /vgc trong phòng thì vẫn trả giá, dù máy chủ không giao lệnh ấy', async () => {
  // Máy chủ chỉ giao `/từ` cho bot đã khai đúng chữ ấy, và bảng lệnh có giới hạn — nên có những mã
  // không bao giờ tới được bằng đường lệnh. Dòng chữ vẫn tới, vì chủ bot đã tắt chế độ riêng tư, và
  // người gõ `/vgc` thì đang hỏi giá VGC: không có cách đọc nào khác cho ba chữ ấy.
  const { sent } = await withBot([update({ text: '/vgc' })], { market: stubMarket({ listed: ['VGC'] }) });
  assert.match(sent[0].text, /^VGC 256,1/);
});

test('nghe được /từ lạ thì im, không chen vào lệnh của bot bên cạnh', async () => {
  // Nghe lỏm thì phải im phần không tra được: `/tienlen` là lệnh của con bot chơi bài, và một câu
  // "không tra được gì" chen vào đó là bot này nói leo trong phòng của người khác.
  const { sent } = await withBot([update({ text: '/tienlen' })], { expect: 0 });
  assert.deepEqual(sent, []);

  // Kể cả khi chữ ấy đúng hình một mã nhưng không có thật.
  const unknown = await withBot([update({ text: '/zzz' })], { expect: 0 });
  assert.deepEqual(unknown.sent, []);
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
  const { sent } = await withBot([update({ text: '@bocobot help' })]);

  // Hướng dẫn đứng trước, dòng trạng thái khai báo lệnh đi sau — nên so bằng `startsWith`.
  assert.ok(sent[0].text.startsWith(HELP));
  assert.match(sent[0].text, /!board bds — bất động sản/);
  assert.match(sent[0].text, /\/gex 3m — chart 3 tháng/);
  assert.match(sent[0].text, /Gõ \/ thì cả nhóm cùng xem, gõ ! thì chỉ bạn thấy/);
  assert.equal(sent[0].replyToMessageId, 'm1');
});

test('gọi bot help thì trả hướng dẫn thay vì đọc HELP như mã', async () => {
  const { sent } = await withBot([update({ text: '@bocobot help -v' })]);

  assert.ok(sent[0].text.startsWith(HELP));
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
  assert.deepEqual(askedHeatmapFor(message({ text: '!bangdien' })), { addressed: true });
  assert.deepEqual(askedHeatmapFor(message({ text: '!bangdien oil' })).filter.title, 'Dầu khí');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa oil' })).filter.title, 'Dầu khí');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa retail' })).filter.title, 'Bán lẻ');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa cn' })).filter.title, 'Công nghiệp');
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa bank -v' })).filter.title, 'Bank chứng');
  assert.match(askedHeatmapFor(message({ text: '  !board hom nay' })).error, /Chỉ hỗ trợ/);
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

test('!board không nhận ngành ngoài danh sách hỗ trợ, và tên cũ !vboa vẫn chạy', async () => {
  const heatmap = stubHeatmap();
  const { sent } = await withBot([update({ text: '!board thep' })], { heatmap });

  assert.equal(heatmap.calls.length, 0);
  assert.equal(sent[0].text, 'Chỉ hỗ trợ: !board bds, !board bank, !board oil, !board retail, !board cn.');

  // Tên cũ vẫn nhận: người dùng có trí nhớ ngón tay, và một lệnh im vì vừa đổi tên trông y như một
  // lệnh hỏng.
  assert.deepEqual(askedHeatmapFor(message({ text: '!vboa bank' })).filter.title, 'Bank chứng');
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

test('bấm vào mã trong dòng giá là mở hồ sơ doanh nghiệp', async () => {
  const company = stubCompany();
  const { sent } = await withBot([update({ text: '/vic', command: 'vic' })], { company });

  assert.deepEqual(company.calls, ['VIC']);
  const view = (sent[0].entities ?? []).find((one) => one.view === 'company');
  assert.ok(view, 'dòng giá phải mang một view hồ sơ');
  assert.equal(view.type, 'view');
  assert.equal(sent[0].text.slice(view.offset, view.offset + view.length), 'VIC');
  assert.equal(view.data.title, 'VIC — Công ty Cổ phần VIC');
  assert.deepEqual(view.data.rows[0], ['Sàn', 'HOSE']);
  assert.ok(view.data.rows.some(([label, value]) => label === 'Vốn hoá' && value === '1.873.016 tỷ đồng'));
});

test('nguồn hồ sơ chết thì vẫn có giá, chỉ là không bấm vào mã được', async () => {
  // Hồ sơ là phần thêm vào một dòng giá. Người ta hỏi giá.
  const { sent } = await withBot(
    [update({ text: '/vic', command: 'vic' })],
    { company: stubCompany({ broken: true }) },
  );
  assert.match(sent[0].text, /^VIC 256,1/);
  assert.equal((sent[0].entities ?? []).some((one) => one.view === 'company'), false);
});

test('mã không tra được giá thì không mở hồ sơ ra', async () => {
  // Dòng của nó là một lời xin lỗi, không phải chỗ để bấm vào.
  const company = stubCompany();
  const { sent } = await withBot(
    [update({ text: '/gia vic zzz', command: 'gia', commandArgs: 'vic zzz' })],
    { market: stubMarket({ listed: ['VIC'] }), company },
  );
  assert.deepEqual(company.calls, ['VIC']);
  assert.match(sent[0].text, /ZZZ — không có dữ liệu/);
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
    { market: stubMarket({ listed: ['VIX'] }), chart, expect: 1 },
  );

  // Một tin: hình và dòng giá cùng nhau, thuật ngữ trên dòng giá vẫn bấm được. Hai thứ ấy từng
  // loại trừ nhau — client vẽ chữ của tin có ảnh bằng một đường không mang entity — và hết loại
  // trừ từ 16/09/2026.
  assert.deepEqual(chart.calls.map((call) => call.symbol), ['VIX']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].image.fileName, 'vix-2026-09-07.svg');
  assert.match(sent[0].text, /^VIX 256,1/);
  assert.equal(sent[0].replyToMessageId, 'm1');
  // Chú thích đi **trong khối rich**, không phải `entities` gắn thẳng trên tin: client vẽ tin có
  // ảnh bằng markup, nên chú thích để ngoài markup là chú thích lưu xong không ai bấm được. Đúng
  // lỗi đã gặp: `!ptkt` bấm được vì nó gửi rich, dòng giá thì không.
  assert.equal(sent[0].entities, undefined);
  assert.equal(sent[0].rich.blocks.length, 1);   // đúng một đoạn: số liệu phiên nằm trong hình
  assert.ok(sent[0].rich.blocks[0].entities?.length, 'chú thích nằm trong khối rich');
  assert.match(sent[0].image.svg, /<svg [^>]*width="1440" height="840" viewBox="0 0 720 420"/);   // không bé tí
  assert.match(sent[0].image.svg, /<line x1="86" y1="84" x2="86"/);
  // Mốc là tham chiếu 13,1, không phải cây nến đầu phiên 13,2: giá thấp nhất phiên vẫn nằm trên
  // tham chiếu nên hiện +50đ, và đó đúng là điều dòng chữ ▲ +2,29% đang nói.
  assert.match(sent[0].image.svg, /Mở 13,2 · Cao 13,45 \(\+350đ\) · Thấp 13,15 \(\+50đ\) · TC 13,1/);
  assert.match(sent[0].image.svg, />13,45</);
  assert.match(sent[0].image.svg, />13,1</);
  assert.match(sent[0].image.svg, />13,15</);
});

test('số trên hình và số trong chữ là một, kể cả khi mở cửa nhảy giá so với tham chiếu', () => {
  // Đúng cái lỗi đã báo: TC 13,1 nhưng phiên mở ở 13,2. Đo theo cây nến đầu phiên ra +1,52%, đo
  // theo tham chiếu — như dòng chữ vẫn đo — ra +2,29%. Hình từng nói số thứ nhất, chữ nói số thứ
  // hai, trong cùng một tin nhắn.
  const quote = normalize({ ...VIC, sym: 'VIX', r: 13.1, lastPrice: 13.4 });
  const rich = chartRich({
    symbol: 'VIX',
    mode: 'intraday',
    day: '2026-09-07',
    labels: ['09:15', '09:20', '09:25'],
    closes: [13.2, 13.35, 13.38],
    open: 13.2,
    close: 13.38,
    high: 13.45,
    low: 13.15,
    change: 0.18,
    percent: 1.36,
  }, quote);

  assert.match(rich.image.svg, />VIX 13,4 ▲ \+2,29%[^<]* · KL /);
  assert.equal(rich.image.svg.includes('+1,36%'), false);
  assert.equal(rich.blocks, undefined);   // không còn đoạn chữ rời ở dưới
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
    { market: stubMarket({ listed: ['GEX'] }), chart, expect: 1 },
  );

  assert.deepEqual(chart.calls.map((call) => [call.symbol, call.period]), [['GEX', '1n']]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].image.fileName, 'gex-1n-2026-09-08.svg');
  assert.match(sent[0].text, /^GEX /);
  assert.match(sent[0].image.svg, /GEX 1 năm đến 08\/09\/2026/);
  assert.match(sent[0].image.svg, /Đầu kỳ 18 · Cao 26,8 · Thấp 17,8 · Cuối kỳ 26,2 · KL 6\.000/);
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
  assert.match(ranged.image.svg, /Đầu kỳ 19/);
});

test('chart dài hạn giữa phiên lấy cây nến cuối từ nến 5 phút của hôm nay', () => {
  const daily = {
    t: [Date.parse('2026-09-11T02:00:00Z') / 1000, Date.parse('2026-09-14T02:00:00Z') / 1000],
    o: [240, 243], h: [245, 244], l: [239, 240], c: [243.3, 241.4], v: [4000, 4100],
  };
  const minutes = {
    t: [Date.parse('2026-09-14T07:55:00Z') / 1000, Date.parse('2026-09-15T02:15:00Z') / 1000, Date.parse('2026-09-15T07:20:00Z') / 1000],
    o: [241, 242, 241.5], h: [241.6, 243.2, 241.8], l: [240.9, 241.9, 240.8], c: [241.4, 242.1, 240.9], v: [50, 700, 300],
  };
  const merged = withSessionData(daily, minutes);
  assert.equal(merged.t.length, 3);
  assert.deepEqual(
    [merged.o.at(-1), merged.h.at(-1), merged.l.at(-1), merged.c.at(-1), merged.v.at(-1)],
    [242, 243.2, 240.8, 240.9, 1000],
  );

  // Nến ngày đã có hôm nay thì giữ nguyên.
  assert.equal(withSessionData(merged, minutes), merged);
  assert.equal(withSessionData(daily, null), daily);
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
  assert.doesNotMatch(rich.image.svg, /Thang Y/);
  assert.match(rich.image.svg, /Cao 28,2 \(\+850đ\)/);
  assert.match(rich.image.svg, /Thấp 27,15 \(-200đ\)/);
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

test('!ptkt vic gửi bài phân tích của đúng mã ấy, hình và chữ trong một tin', async () => {
  const technical = stubTechnical();
  const { sent } = await withBot([update({ text: '!ptkt vic' })], { technical, expect: 1 });
  assert.deepEqual(technical.calls, ['VIC']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].image.fileName, 'ptkt-vic-2026-09-11.svg');
  assert.equal(sent[0].replyToMessageId, 'm1');
  assert.match(sent[0].text, /^PTKT VIC · /);
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

test('!manh, !hoiphuc, !dongtien chạy đúng bộ lọc, không đi tra giá mã MANH', async () => {
  const screens = stubScreens();
  const market = stubMarket();
  const { sent } = await withBot([
    update({ text: '!manh' }),
    update({ text: '!hoiphuc hientai', messageId: 'm2' }, 2),
    update({ text: '!dongtien hiện tại ngân hàng', messageId: 'm3' }, 3),
  ], { screens, market, expect: 3 });
  assert.deepEqual(screens.calls, [
    { name: 'manh', live: false, sector: '' },
    { name: 'hoiphuc', live: true, sector: '' },
    { name: 'dongtien', live: true, sector: 'ngân hàng' },
  ]);
  assert.deepEqual(sent.map((one) => one.text), ['MANH', 'HOIPHUC hiện tại', 'DONGTIEN hiện tại · ngân hàng']);
  assert.equal(sent[0].replyToMessageId, 'm1');
});

test('!strategy và !chienluoc trả bảng chiến lược, chữ thừa phía sau bỏ qua', async () => {
  const screens = stubScreens();
  const { sent } = await withBot([
    update({ text: '!strategy' }),
    update({ text: '!chienluoc hientai abc', messageId: 'm2' }, 2),
  ], { screens, market: stubMarket(), expect: 2 });
  assert.deepEqual(screens.calls, [
    { name: 'strategy', live: false, sector: '' },
    { name: 'strategy', live: false, sector: '' },
  ]);
  assert.deepEqual(sent.map((one) => one.text), ['STRATEGY', 'STRATEGY']);
});

test('!manh kèm mã thì nhắc cú pháp, không chấm rổ', async () => {
  const screens = stubScreens();
  const { sent } = await withBot([update({ text: '!manh fpt' })], { screens });
  assert.deepEqual(screens.calls, []);
  assert.match(sent[0].text, /^Gõ !manh hoặc !manh hientai/);
  assert.equal(askedScreenFor(message({ text: '!manhxyz' })), null);
});

test('!dongtien có hình thì hình và chữ đi cùng một tin, như !ptkt', async () => {
  const { sent } = await withBot([update({ text: '!dongtien' })], { screens: stubScreens({ picture: true }) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].image.fileName, 'dongtien-2026-10-16.svg');
  assert.match(sent[0].text, /^DONGTIEN · phiên /);
  assert.equal(sent[0].replyToMessageId, 'm1');
});

test('tin quá 2000 ký tự thì cắt ở dòng cuối còn vừa, không để máy chủ từ chối cả tin', async () => {
  const { sent } = await withBot([update({ text: '!dongtien' })], { screens: stubScreens({ long: 100 }) });
  assert.ok(sent[0].text.length <= MOST_TEXT, `${sent[0].text.length} ký tự`);
  assert.match(sent[0].text, /^dòng 0 /);
  assert.match(sent[0].text, /x\n… \(tin dài quá, đã cắt bớt\)$/);
});

test('nguồn nến chết khi !dongtien thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!dongtien -v' })], { screens: stubScreens({ broken: true }) });
  assert.equal(sent[0].text, SORRY.source);
  assert.equal(sent[0].onlyForUserId, 'u1');
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
  const chinh = ['view', 'ptkt', 'sugg', 'liqu', 'thanhkhoan', 'vang', 'sjc', 'bac', 'tg', 'tin', 'kq', 'manh', 'hoiphuc', 'dongtien', 'strategy', 'chienluoc', 'board', 'bangdien', 'vboa', 'bang'];
  assert.deepEqual(commandsFor(TOP_ME).map((one) => one.command), [...chinh, 'topbot']);
  assert.deepEqual(commandsFor(ME).map((one) => one.command), [...chinh, 'bocobot']);
  assert.deepEqual(askedHelpFor(message({ text: '!topbot' }), TOP_ME), { addressed: true });
});

test('!help@bocobot và !bocobot trả hướng dẫn, còn !help nói giữa phòng thì không', async () => {
  const { sent } = await withBot([update({ text: '!help@bocobot', command: 'help', commandArgs: null, commandPrefix: '!', private: true })]);
  assert.ok(sent[0].text.startsWith(HELP));
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

test('máy chủ không nhận hình thì vẫn gửi chữ cho người hỏi, không im', async () => {
  // 15/09/2026: tin bot kèm hình bị trả 503 write_not_carried_out, tin chữ vẫn đi.
  const chart = stubChart({ rich: { image: { fileName: 'vic.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, blocks: [] } });
  const { sent } = await withBot(
    [update({ text: '!view vic', command: 'view', commandArgs: 'vic', commandPrefix: '!', private: true })],
    { chart, refuseImages: true },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].image, undefined);
  assert.match(sent[0].text, /^VIC 256,1/);
  assert.match(sent[0].text, /Chưa gửi được hình lúc này/);
  assert.equal(sent[0].onlyForUserId, 'u1');
});

test('chỉ lệnh luôn luôn mở bảng mới được khai opensWidget', async () => {
  // Khai chữ ấy là ứng dụng dựng khung ngay lúc tin được gửi, không đợi bot. Nên khai cho một lệnh
  // khi thì mở bảng khi thì trả lời bằng chữ là những lần sau người ta thấy một cái khung rỗng hiện
  // ra rồi tắt — nền tảng đã phải gỡ đúng lỗi ấy một lần, và cờ này sinh ra để không ai đoán nữa.
  const mo = commandsFor(ME).filter((one) => one.opensWidget);
  assert.deepEqual(mo.map((one) => one.command), ['bang']);

  const { registered } = await withBot([], { expect: 0 });
  assert.deepEqual(registered.filter((one) => one.opensWidget).map((one) => one.command), ['bang']);
});

test('!bang mở bảng sống, và đó là lệnh đã khai opensWidget', async () => {
  const { sessions, shown, sent } = await withBot(
    [update({ text: '!bang', command: 'bang', commandArgs: null, commandPrefix: '!', private: true })],
    { expect: 0, settle: 400 },
  );
  assert.equal(sessions.length, 1);
  assert.equal(shown[0]?.to, 'u1');
  assert.deepEqual(sent, []);   // bảng là câu trả lời, không kèm tin nào
});

test('mã thanh khoản cao được khai báo làm lệnh, không trùng lệnh chính, không quá 100', () => {
  assert.deepEqual(
    commandsFor(ME, ['VIC', 'TIN', 'HPG', 'VIEW']).map((one) => one.command),
    ['view', 'ptkt', 'sugg', 'liqu', 'thanhkhoan', 'vang', 'sjc', 'bac', 'tg', 'tin', 'kq', 'manh', 'hoiphuc', 'dongtien', 'strategy', 'chienluoc', 'board', 'bangdien', 'vboa', 'bang', 'bocobot', 'vic', 'hpg'],
  );
  const many = Array.from({ length: MOST_COMMANDS + 100 }, (_, i) => `M${String(i).padStart(4, '0')}`);
  assert.equal(commandsFor(ME, many).length, MOST_COMMANDS);
});

test('/vic gửi cho cả nhóm, !vic chỉ người gõ thấy', async () => {
  const group = await withBot([update({ text: '/vic', command: 'vic', commandArgs: null, commandPrefix: '/' })]);
  assert.match(group.sent[0].text, /^VIC 256,1/);
  assert.equal(group.sent[0].onlyForUserId, undefined);
  assert.equal(group.sent[0].replyToMessageId, 'm1');

  const alone = await withBot([update({ text: '!vic', command: 'vic', commandArgs: null, commandPrefix: '!', private: true })]);
  assert.match(alone.sent[0].text, /^VIC 256,1/);
  assert.equal(alone.sent[0].onlyForUserId, 'u1');
  assert.equal(alone.sent[0].replyToMessageId, undefined);
});

test('/manh gửi cho cả nhóm, !manh hientai chỉ người gõ thấy', async () => {
  const group = await withBot([update({ text: '/manh', command: 'manh', commandArgs: null, commandPrefix: '/' })]);
  assert.equal(group.sent[0].text, 'MANH');
  assert.equal(group.sent[0].onlyForUserId, undefined);
  assert.equal(group.sent[0].replyToMessageId, 'm1');

  const alone = await withBot([update({ text: '!manh hientai', command: 'manh', commandArgs: 'hientai', commandPrefix: '!', private: true })]);
  assert.equal(alone.sent[0].text, 'MANH hiện tại');
  assert.equal(alone.sent[0].onlyForUserId, 'u1');
  assert.equal(alone.sent[0].replyToMessageId, undefined);
});

// ---- chú thích thuật ngữ ----------------------------------------------------------------------

const readZip = (buffer) => {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.set(name, buffer.subarray(start, start + size));
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return entries;
};

test('thuật ngữ được đánh dấu đúng chỗ, lần đầu, không dính vào chữ khác', () => {
  const text = 'PTKT VIC · giá trên MA20, MA50, MA200 · TCB 24 · TC 23 · KL 1.000 · R:R 2';
  const marked = termEntities(text).map((entity) => text.slice(entity.offset, entity.offset + entity.length));
  assert.deepEqual(marked, ['PTKT', 'MA20', 'MA50', 'MA200', 'TC', 'KL', 'R:R']);
  assert.ok(termEntities(text).every((entity) => entity.type === 'view' && entity.view === TERM_VIEW && entity.data.title));

  // Không đè lên link sẵn có: một view không được chung ký tự với entity khác.
  const link = { type: 'link', offset: 0, length: 12, url: 'https://example.test' };
  assert.deepEqual(termEntities('RSI và MACD rồi RSI', [link]).map((entity) => entity.offset), [16]);
  assert.deepEqual(termEntities('RSI và MACD. RSI', [{ ...link, length: 3 }]).map((entity) => entity.offset), [7, 13]);
});

test('chú thích vào entities của tin chữ, vào khối rich khi có rich, và cả trên tin có hình', () => {
  const plain = withTerms({ text: 'VIC 256,1 ▲ +4,74% · KL 7.518.600' });
  assert.equal(plain.entities[0].data, GLOSSARY.KL);

  const rich = withTerms({ text: 'x', rich: { blocks: [{ type: 'paragraph', text: 'RSI 60' }, { type: 'divider' }] } });
  assert.equal(rich.entities, undefined);
  assert.equal(rich.rich.blocks[0].entities[0].view, TERM_VIEW);

  // Tin có hình nay cũng được chú thích: từ 16/09/2026 client vẽ chữ của nó bằng đúng bộ đọc của
  // tin chữ. Trước ngày ấy, chú thích gắn ở đây là chú thích không ai mở được — nên bot phải xé
  // câu trả lời thành hai tin, và đó là thứ vừa bỏ đi.
  const picture = { text: 'PTKT VIC · MA200 · RSI 60', image: { fileName: 'a.svg', svg: '<svg/>' } };
  const marked = withTerms(picture);
  assert.ok(marked.entities.some((entity) => entity.data === GLOSSARY.MA200));
  assert.equal(marked.image, picture.image);

  // Sticker thì vẫn không: không có chữ nào để đánh dấu.
  const sticker = { stickerId: 's1', text: 'MA200' };
  assert.equal(withTerms(sticker), sticker);

  const nothing = { text: 'không có gì' };
  assert.equal(withTerms(nothing), nothing);
  assert.ok(Object.values(GLOSSARY).every((entry) => entry.title && entry.body));
});

test('câu trả lời mang chú thích, và máy chủ từ chối chú thích thì vẫn nhận được câu trả lời', async () => {
  const marked = await withBot([update({ text: '/gia vic', command: 'gia', commandArgs: 'vic' })]);
  assert.deepEqual(marked.sent[0].entities.find((entity) => entity.view === TERM_VIEW).data, GLOSSARY.KL);

  const refused = await withBot([update({ text: '/gia vic', command: 'gia', commandArgs: 'vic' })], { refuseViews: true });
  assert.equal(refused.sent.length, 1);
  assert.match(refused.sent[0].text, /^VIC 256,1/);
  assert.equal(refused.sent[0].entities, undefined);
});

test('widget là một gói zip đọc lại được, widget.json trỏ tới trang có trong gói', () => {
  const files = widgetFiles();
  const entries = readZip(zip(files));
  assert.deepEqual([...entries.keys()], files.map((file) => file.path));
  const manifest = JSON.parse(entries.get('widget.json').toString('utf8'));
  assert.equal(manifest.views[TERM_VIEW].entry, 'term.html');
  assert.equal(manifest.views[COMPANY_VIEW].entry, 'company.html');

  // Mọi view đã khai phải có trang của nó trong gói. Một `entry` trỏ vào chỗ trống thì máy chủ chối
  // **cả gói**, nên đổi tên một trang là mất luôn những thẻ chẳng liên quan gì tới nó.
  for (const [name, view] of Object.entries(manifest.views)) {
    assert.ok(entries.has(view.entry), `view ${name} trỏ tới ${view.entry} mà gói không có`);
  }
  assert.ok(entries.has('term.js') && entries.has('company.js') && entries.has('view.js') && entries.has('view.css'));
  assert.ok(!entries.has('zeplao.js'));
  assert.deepEqual(zip(files), zip(files));   // cùng thư mục, cùng byte: máy chủ nhận ra gói không đổi
});

test('khởi động là tải widget lên, dạng application/zip', async () => {
  const { widgets } = await withBot([], { expect: 0 });
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].contentType, 'application/zip');

  const calls = [];
  const answer = await publishWidget({
    api: 'https://bot.example', token: 't',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json({ version: 3, unchanged: true }); },
  });
  assert.equal(answer.unchanged, true);
  assert.equal(calls[0].url, 'https://bot.example/setWidget');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/zip');
});

test('bài phân tích kèm hình đi một tin, thuật ngữ trên chữ vẫn bấm được', async () => {
  const { sent } = await withBot(
    [update({ text: '!ptkt vic', command: 'ptkt', commandArgs: 'vic', commandPrefix: '!', private: true })],
    { expect: 1 },
  );
  assert.equal(sent.length, 1);
  assert.ok(sent[0].image);
  assert.equal(sent[0].keyboard, undefined);   // nút thì không: xấu, và không phải thứ đã hỏi
  const views = [...(sent[0].entities ?? []), ...(sent[0].rich?.blocks ?? []).flatMap((block) => block.entities ?? [])];
  assert.ok(views.some((entity) => entity.view === TERM_VIEW && entity.data.title.startsWith('PTKT')));

  // Và bấm được vào chính cái mã đang phân tích: hồ sơ doanh nghiệp không phải đặc quyền của dòng
  // giá. Thiếu đúng chỗ này là thứ người dùng nhìn thấy — chữ nào cũng gạch chân, trừ tên mã.
  assert.ok(
    views.some((entity) => entity.view === COMPANY_VIEW && entity.data.title.startsWith('VIC —')),
    'mã trong bài PTKT cũng mở được hồ sơ',
  );
  assert.equal(sent[0].onlyForUserId, 'u1');
});

test('widget cũ có view khác thì tải lại với allowViewRemoval', async () => {
  const { widgets } = await withBot([], {
    expect: 0,
    widgetAnswers: [[400, '{"error":"views_removed","message":"views removed","details":{"views":["graph"]}}']],
  });
  assert.equal(widgets.length, 2);
  assert.doesNotMatch(widgets[0].url, /allowViewRemoval/);
  assert.match(widgets[1].url, /allowViewRemoval=true/);
});

test('cả bảng niêm yết đều được khai, mã giao dịch nhiều tiền nhất đứng trước', async () => {
  // Cái lọc "phải có khối lượng" cũ biến bảng lệnh thành thứ đổi theo phiên: một mã ít giao dịch
  // hôm nay gọi được bằng `/`, hôm sau thì không, mà chẳng ai đổi gì cả. Nó có lý khi bảng lệnh
  // chỉ có 100 ô và xếp hạng cũng là chọn lọc; giờ trần là 2.000 nên không phải bỏ ai lại.
  const market = {
    async universe() { return ['AAA', 'BBB', 'CCC', 'x']; },
    async quotes() {
      return [
        { symbol: 'AAA', price: 10, volume: 100 },
        { symbol: 'CCC', price: 10, volume: 900 },
        { symbol: 'BBB', price: 12, volume: 0 },   // hôm nay không ai mua bán
      ];
    },
  };

  assert.deepEqual(await boardSymbols(market), ['CCC', 'AAA', 'BBB']);
  assert.deepEqual(await boardSymbols(market, 2), ['CCC', 'AAA']);   // hết chỗ thì mã ế rơi trước
});

test('gọi tên bot là mở bảng nhiệt sống, không phải gửi hướng dẫn', async () => {
  const { sent, sessions, shown, pushes } = await withBot([update({ text: '@bocobot' })], { expect: 0, settle: 400 });

  assert.equal(sessions.length, 1);
  // `userIds` rỗng: ở một bảng giá thì ai cũng là người xem. Ai được kể tên thành "người chơi" sẽ
  // bị client hỏi "đóng bảng là bỏ cuộc?", và chỗ cho người chơi thì chỉ có tám.
  assert.deepEqual(sessions[0].userIds, []);
  assert.ok(sessions[0].conversationId);
  assert.equal(shown[0].sessionId, 's1');
  assert.equal(shown[0].to, 'u1');

  const { state } = pushes[0];
  assert.ok(state.c.length > 0 && state.g.length > 0);
  assert.ok(JSON.stringify(state).length < 64 * 1024, 'một lần đẩy tối đa 64 KB');
  assert.deepEqual(sent, []);   // hướng dẫn nằm dưới chân bảng, không gửi thêm tin
});

/// Bấm vào một ô trong bảng: cập nhật `widget_action` mà nền tảng gửi tới, đúng hình dạng trong doc.
const tapped = (action, id = 2) => ({
  id,
  kind: 'widget_action',
  widgetAction: {
    sessionId: 's1', conversationId: 'p1', from: { userId: 'u1', displayName: 'Người hỏi' }, role: 'viewer', action,
  },
});

test('bấm vào một ô thì gói sau mang theo hồ sơ mã ấy, kèm khối lượng và giá trị hôm nay', async () => {
  const company = stubCompany();
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'VIC' })],
    { expect: 0, settle: 400, company },
  );

  const detail = pushes.map(({ state }) => state.d?.VIC).filter(Boolean).at(-1);
  assert.ok(detail, 'gói phải mang theo chi tiết của mã vừa bấm');
  assert.equal(detail.n, 'Công ty Cổ phần VIC');
  assert.equal(detail.w, 'HOSE · Bất động sản');
  assert.equal(detail.p, '256,1');

  // Hai con số người ta mở trang chi tiết ra để xem, và chúng phải là số của phiên hôm nay chứ
  // không phải số trong hồ sơ — hồ sơ là ảnh chụp cuối phiên trước.
  assert.deepEqual(detail.q[0], ['Khối lượng', '7.518.600']);
  assert.deepEqual(detail.q[1], ['Giá trị', '1.926 tỷ']);
  assert.ok(detail.r.some(([label]) => label === 'Vốn hoá'));
  assert.ok(!detail.r.some(([label]) => label === 'Sàn'), 'sàn đã nằm ngay dưới tên mã');

  // Mười phiên gần nhất, và khối lượng bình quân của đúng chừng ấy phiên — không phải "bình quân
  // tháng" của hồ sơ, vốn là một con số khác đứng ngay bên cạnh trong cùng trang.
  assert.equal(detail.h.length, 3);
  assert.deepEqual(detail.h[0].slice(0, 5), ['07/09', '256,1', '+4,74%', '7.518.600', '1.926 tỷ']);
  assert.equal(detail.h[0][5], 1);            // phiên tăng, để trang tô đúng màu
  assert.equal(detail.h[1][5], -1);

  // Khối ngoại ghép vào **theo ngày**, không theo thứ tự: hai nguồn khác nhau, và lệch một dòng thì
  // mọi con số vẫn hợp lý, chỉ đứng nhầm phiên — kiểu sai không ai nhìn ra.
  assert.deepEqual(detail.h[0].slice(6), ['161 tỷ', '344 tỷ']);
  assert.deepEqual(detail.h[2].slice(6), ['', '']);   // phiên nguồn kia không có thì để trống
  assert.deepEqual(detail.hb, ['KLTB 3 phiên', '6.272.867']);

  // Hỏi nguồn đúng một lần cho mỗi mã rồi nhớ — kể cả khi phần hâm sẵn cũng đang chạy nền.
  assert.deepEqual(company.calls.filter((symbol) => symbol === 'VIC'), ['VIC']);
  assert.ok(JSON.stringify(pushes.at(-1).state).length < 64 * 1024, 'một lần đẩy tối đa 64 KB');
});

test('trang gửi về cái gì thì cũng chỉ mở được mã đang có trên bảng', async () => {
  // Doc dặn thẳng: trang widget là file ai cũng sửa được, nên `action` phải kiểm như kiểm chữ người
  // lạ gõ vào. Mã không có trên bảng, chuỗi bậy, và cả một lời gọi hồ sơ trá hình đều không đi đâu.
  const company = stubCompany();
  const { pushes } = await withBot(
    [
      update({ text: '@bocobot' }),
      tapped({ open: 'ZZZ' }, 2),
      tapped({ open: '../../etc/passwd' }, 3),
      tapped({ open: 'VIC ' }, 4),
    ],
    { expect: 0, settle: 400, company },
  );

  assert.ok(pushes.length > 0);
  assert.ok(pushes.every(({ state }) => !state.d), 'không mã nào được mang theo');
  // Và không mã lạ nào bị mang đi hỏi nguồn. (Mã **trên bảng** thì có: chúng được hâm sẵn ở nền,
  // để cú bấm sắp tới khỏi phải đợi một lượt mạng — xem `warmProfiles`.)
  assert.ok(!company.calls.some((symbol) => !['VIC', 'HPG'].includes(symbol)), company.calls.join(','));
});

test('bài phân tích tính sẵn từ lúc mở trang, để bấm sang tab là có ngay', async () => {
  // Đợi cú bấm vào tab rồi mới tính là bắt người ta chịu cả một vòng hỏi đáp qua nền tảng **cộng**
  // quãng tính. Trả trước cái giá ấy lúc mở trang thì tab mở ra tức thì.
  const technical = stubTechnical();
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'VIC' })],
    { expect: 0, settle: 400, technical },
  );

  const card = pushes.map(({ state }) => state.d?.VIC?.tk).filter(Boolean).at(-1);
  assert.ok(card, 'mở trang chi tiết là gói đã mang sẵn bài phân tích');
  assert.equal(card.verdict, 'TÍCH CỰC');
  assert.equal(card.steps.length, 2);
  assert.ok(card.chart.close.length > 0);
  assert.ok(Number.isFinite(card.ms), 'và kể luôn nó tính mất bao lâu');

  // Chỉ mã được mở, và chỉ một lần: bốn lượt gọi nguồn nến cho mỗi cú bấm vào một ô màu thì nguồn
  // nào chịu nổi.
  assert.deepEqual(technical.calls, ['card:VIC']);
  assert.ok(pushes.every(({ state }) => !state.d?.HPG));
});

test('bấm sang tab PTKT một mã đã tính rồi thì không tính lại', async () => {
  const technical = stubTechnical();
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'VIC' }, 2), tapped({ ptkt: 'VIC' }, 3)],
    { expect: 0, settle: 500, technical },
  );

  assert.deepEqual(technical.calls, ['card:VIC']);
  assert.ok(pushes.at(-1).state.d?.VIC?.tk);
});

test('ô tìm mã mở được cả mã không có trên bảng, miễn là nó có niêm yết', async () => {
  // Bảng bày hai trăm sáu mươi ô to nhất trong hơn nghìn rưởi mã. Không có đường này thì phần còn
  // lại của sàn là vùng không ai bấm tới được.
  // TCX niêm yết nhưng hôm nay chưa khớp lệnh nào, nên nó không có chỗ trên bản đồ nhiệt — đúng
  // kiểu mã mà chỉ ô tìm kiếm mới với tới.
  const market = {
    async universe() { return ['VIC', 'HPG', 'TCX']; },
    async quotes(symbols) {
      return symbols
        .filter((symbol) => ['VIC', 'HPG', 'TCX'].includes(symbol))
        .map((symbol) => normalize(symbol === 'TCX' ? { ...VIC, sym: symbol, r: 0, lastPrice: 0, lot: 0 } : { ...VIC, sym: symbol }));
    },
  };
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'TCX' })],
    { expect: 0, settle: 400, market },
  );

  const onBoard = pushes.at(-1).state.c.map(([symbol]) => symbol);
  assert.ok(!onBoard.includes('TCX'), 'mã này đúng là không có trên bảng');
  const detail = pushes.map(({ state }) => state.d?.TCX).filter(Boolean).at(-1);
  assert.ok(detail, 'mà vẫn phải mở được trang chi tiết');
  assert.equal(detail.n, 'Công ty Cổ phần TCX');
});

test('đặt con trỏ vào ô tìm mã thì gói mang theo danh sách niêm yết, lúc khác thì không', async () => {
  // Bảy nghìn ký tự mỗi ba giây là bảy nghìn ký tự không ai đọc — nên chỉ gửi khi có người định gõ.
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ typing: 1 })],
    { expect: 0, settle: 400 },
  );
  assert.equal(pushes.map(({ state }) => state.all).filter(Boolean).at(-1), 'VIC,HPG');

  const quiet = await withBot([update({ text: '@bocobot' })], { expect: 0, settle: 300 });
  assert.ok(quiet.pushes.every(({ state }) => !state.all));
});

test('gõ một mã không niêm yết thì không có gì xảy ra', async () => {
  const company = stubCompany();
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'KHONGCO' })],
    { expect: 0, settle: 400, company },
  );

  assert.ok(pushes.every(({ state }) => !state.d), 'không mã lạ nào được mang theo');
  assert.ok(!company.calls.includes('KHONGCO'));
});

test('phiên mất mà người ta vẫn bấm thì bot mở lại bảng, không để chết vĩnh viễn', async () => {
  // Bot đóng nhầm vì tưởng hết người xem, hay một lần đẩy trả về `session_not_found` — cả hai đều
  // xoá phòng khỏi sổ, và từ đó mọi cú bấm rơi vào hư không: trang treo mãi, chỉ mở lại widget mới
  // sống. Cú bấm chính là bằng chứng có người đang ngồi đó.
  const { sessions, shown } = await withBot(
    // Không có tin nào mở bảng trước: cú bấm tới một phòng bot chưa hề mở bảng, đúng như sau khi
    // phòng ấy bị xoá khỏi sổ.
    [tapped({ open: 'VIC' }, 1)],
    { expect: 0, settle: 400 },
  );

  assert.equal(sessions.length, 1, 'phải mở lại một phiên cho phòng ấy');
  assert.equal(shown[0]?.to, 'u1');
});

test('bảng đóng theo thời gian không ai xem, không theo số lần đẩy', async () => {
  // Luật cũ đếm **số lần đẩy**: hai mươi lần liền không ai nhận thì đóng. Cái ngưỡng ấy trôi nhanh
  // chậm tuỳ bot đẩy dày hay thưa — mà từ khi mỗi cú bấm cũng sinh một lần đẩy, nó trôi trong chớp
  // mắt và bot đóng bảng ngay dưới tay người đang dùng. Sau đó mọi cú bấm rơi vào một phòng không
  // còn trong sổ: trang ngồi "đang lấy hồ sơ" mãi rồi khung tự tắt.
  const bo = await withBot(
    [update({ text: '@bocobot' })],
    { expect: 0, settle: 600, board: { tickMs: 40, idleMs: 120 } },
  );
  assert.equal(bo.ended.length, 1, 'quá hạn không ai xem thì vẫn phải đóng');
  assert.equal(bo.ended[0].sessionId, 's1');

  // Còn trong hạn thì không, dù đã đẩy bao nhiêu lần đi nữa.
  const giu = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'VIC' }, 2), tapped({ seat: [null, 'VIC', 'all'] }, 3)],
    { expect: 0, settle: 600 },
  );
  assert.deepEqual(giu.ended, []);
});

test('bot nhớ hộ chỗ người xem đang đứng, vì trang không tự nhớ được', async () => {
  // Widget chạy trong iframe `sandbox="allow-scripts"` không có `allow-same-origin`: origin mờ, và
  // chạm vào `localStorage` là ném lỗi. Nên chuyển sang phòng chat khác rồi quay lại là trang nạp
  // mới tinh — chỗ đang đứng chỉ còn lại nếu bot giữ hộ.
  const { pushes } = await withBot(
    [
      update({ text: '@bocobot' }),
      tapped({ seat: ['Ngân hàng', 'VIC', 'ptkt'] }, 2),
      tapped({ hello: 1 }, 3),
    ],
    { expect: 0, settle: 400 },
  );

  const seats = pushes.map(({ state }) => state.seats).filter(Boolean).at(-1);
  assert.deepEqual(seats?.u1, ['Ngân hàng', 'VIC', 'ptkt']);
});

test('chỗ ngồi cũng là chữ người lạ gõ vào: mã lạ bị bỏ, tên ngành bị cắt, tab lạ thành tab mặc định', async () => {
  const { pushes } = await withBot(
    [
      update({ text: '@bocobot' }),
      tapped({ seat: ['N'.repeat(200), 'ZZZ', 'chọc-ngoáy'] }, 2),
      tapped({ hello: 1 }, 3),
    ],
    { expect: 0, settle: 400 },
  );

  const seat = pushes.map(({ state }) => state.seats?.u1).filter(Boolean).at(-1);
  assert.equal(seat[0].length, 40);
  assert.equal(seat[1], null);
  assert.equal(seat[2], 'all');
});

test('mở nhiều mã thì gói không phình ra theo: chỉ mang mã còn đang xem', async () => {
  // Mỗi gói là một ảnh chụp đầy đủ và có trần cứng 64 KB. Mang theo mọi mã vừa xem thì tới mã thứ
  // bảy là gói chạm trần, bị chối, và bảng đứng im không một lời giải thích — người dùng phải tắt
  // widget bật lại mới đi tiếp được sáu mã nữa.
  const market = stubMarket({ listed: ['VIC', 'HPG', 'SSI', 'MBB', 'FPT', 'GEX', 'DXG'] });
  const { pushes } = await withBot(
    [
      update({ text: '@bocobot' }),
      ...['VIC', 'HPG', 'SSI', 'MBB', 'FPT', 'GEX', 'DXG'].flatMap((symbol, index) => [
        tapped({ open: symbol }, index * 2 + 2),
        tapped({ seat: [null, symbol, 'all'] }, index * 2 + 3),
      ]),
    ],
    { expect: 0, settle: 600, market },
  );

  const mang = Object.keys(pushes.at(-1).state.d ?? {});
  assert.deepEqual(mang, ['DXG'], `chỉ mã đang xem, không phải cả bảy: ${mang.join(',')}`);
  assert.ok(pushes.every(({ state }) => Object.keys(state.d ?? {}).length <= 2));
});

test('mã vào gói bằng đường chỗ ngồi vẫn được đi lấy hồ sơ', async () => {
  // Trang báo chỗ ngồi cũng đưa mã vào gói. Nếu không ai đi lấy dữ liệu cho nó thì gói ra `f: 0` —
  // mà `f: 0` nghĩa là "nguồn nói mã này không có hồ sơ", một câu trả lời dứt khoát, nên trang thôi
  // hỏi lại và ngồi mãi với một trang trống. Thứ gì đã nằm trong gói thì phải có người đi lấy cho nó.
  // Mã phải nằm **ngoài** nhóm được hâm sẵn, nếu không thì vòng hâm nền lấy hộ và cái lỗ không lộ
  // ra. Bảy mươi mã, và mã cuối bảng thì vòng hâm — mỗi mã cách nhau 150ms — chưa kịp tới.
  const nhieu = Array.from({ length: 70 }, (_, i) => `M${String(i).padStart(2, '0')}`);
  const company = stubCompany();
  const { pushes } = await withBot(
    // Chỉ có chỗ ngồi, **không** có lời "mở mã" — đúng cảnh lời ấy bị rơi giữa đường.
    [update({ text: '@bocobot' }), tapped({ seat: [null, 'M69', 'all'] }, 2)],
    { expect: 0, settle: 500, company, market: stubMarket({ listed: nhieu }) },
  );

  const detail = pushes.map(({ state }) => state.d?.M69).filter(Boolean).at(-1);
  assert.ok(detail, 'mã ấy phải có mặt trong gói');
  assert.equal(detail.f, 1, `phải đi lấy hồ sơ chứ không báo "không có hồ sơ" (f=${detail.f})`);
  assert.equal(detail.n, 'Công ty Cổ phần M69');
  assert.ok(company.calls.includes('M69'));
});

test('đóng trang chi tiết thì gói thôi mang hồ sơ mã ấy', async () => {
  // Gói đẩy đi là gói chung cả phòng. Giữ lại hồ sơ của một mã không ai còn nhìn là bắt mọi người
  // tải nó mỗi ba giây, suốt cả phiên.
  const { pushes } = await withBot(
    [update({ text: '@bocobot' }), tapped({ open: 'VIC' }, 2), tapped({ shut: 'VIC' }, 3)],
    { expect: 0, settle: 500 },
  );

  assert.ok(pushes.some(({ state }) => state.d?.VIC), 'đã có lúc mang theo');
  assert.ok(!pushes.at(-1).state.d, 'gói cuối thì thôi');
});

test('sàn đóng cửa vẫn phải có số trên bảng, nhưng không đẩy mãi suốt đêm', async () => {
  // Gói đầu tiên đi **trước** `showSession`, tức trước khi trang kịp tồn tại trên máy ai. Ngoài giờ
  // khớp lệnh bot đẩy một lần rồi nghỉ, nên nếu không có gói thứ hai thì người mở bảng lúc bảy giờ
  // tối ngồi nhìn "Đang mở…" tới sáng — bảng trống, bấm vào đâu cũng không ra gì.
  const { pushes } = await withBot(
    [update({ text: '@bocobot' })],
    { expect: 0, settle: 500, at: () => new Date('2026-09-07T09:00:00Z') },   // 16:00: đã đóng cửa
  );

  assert.ok(pushes.length >= 2, `trang mở ra phải nhận được một gói; mới đẩy ${pushes.length} lần`);
  // Mà cũng đừng đẩy mỗi nhịp: `settle` 500ms với nhịp 40ms là hơn mười nhịp.
  assert.ok(pushes.length <= 4, `ngoài giờ thì thôi đẩy; đã đẩy ${pushes.length} lần`);
  assert.match(pushes.at(-1).state.note, /đóng cửa/);
});

test('không mở được phiên thì vẫn trả hướng dẫn như cũ', async () => {
  // Máy cũ, lỗi mạng, gói widget chưa lên — đường cũ phải còn đó, chứ im lặng là hỏng.
  const { sent, sessions } = await withBot([update({ text: '@bocobot' })], { refuseSessions: true });
  assert.deepEqual(sessions, []);
  assert.ok(sent[0].text.startsWith(HELP));
});

test('gói bảng nhiệt mang cả bảng, và bố cục có vân tay riêng để trang khỏi dựng lại mỗi nhịp', () => {
  // `ZZZ` không có trong bảng ngành lấy từ mạng lẫn bảng viết tay dự phòng — nó phải rơi vào "Khác".
  const quotes = ['VIC', 'HPG', 'ZZZ'].map((sym) => normalize({ ...VIC, sym }));
  const sectors = new Map([['VIC', 'Bất động sản'], ['HPG', 'Tài nguyên']]);
  const state = boardState(quotes, { sectors, at: new Date('2026-09-07T03:00:00Z') });

  assert.equal(state.c.length, 3);
  assert.deepEqual(state.c[0].length, 9);          // [mã, x, y, w, h, "+4,74%", loại, nhóm, tiền]
  assert.match(state.c[0][5], /^[+-]/);
  assert.ok(state.g.some(([name]) => name === 'Bất động sản'));
  assert.ok(state.g.some(([name]) => name === 'Khác'));   // mã không có ngành vẫn có chỗ

  // Mỗi ô nhớ nó thuộc nhóm nào và đáng bao nhiêu tiền: đó là tất cả những gì trang cần để tự chia
  // lại một nhóm khi người xem bấm vào tên ngành. Chỉ số nhóm sai một bậc là bấm "Ngân hàng" ra
  // "Thép", nên kiểm đúng cái tên chứ không kiểm mỗi kiểu dữ liệu.
  for (const [symbol, , , , , , , group, value] of state.c) {
    assert.equal(state.g[group][0], sectors.get(symbol) ?? 'Khác');
    assert.ok(value > 0);
  }

  // Vân tay đổi khi bố cục đổi, **không** đổi khi chỉ có giá đổi: trang dựng lại DOM theo nó, và
  // dựng lại mỗi nhịp là chữ nhấp nháy với mất chỗ người ta đang nhìn.
  const again = boardState(quotes.map((quote) => ({ ...quote, percent: quote.percent + 1 })), { sectors, at: new Date('2026-09-07T03:00:00Z') });
  assert.equal(again.v, state.v);
  const fewer = boardState(quotes.slice(0, 2), { sectors, at: new Date('2026-09-07T03:00:00Z') });
  assert.notEqual(fewer.v, state.v);
});

test('hướng dẫn nói ra bot đã khai báo được bao nhiêu lệnh', async () => {
  // Khai báo lệnh là việc vô hình: nó xong hay hỏng lúc khởi động, còn người dùng chỉ thấy `/vgc`
  // im lặng. Ai đang hỏi giá trong một phòng chat thì không có log của pod trong tay, nên đây là
  // chỗ duy nhất nhìn được vì sao một lệnh không tới nơi.
  const { sent } = await withBot([update({ text: '@bocobot help' })]);
  assert.match(sent[0].text, /\(Gọi thẳng được \d+ mã bằng \/mã\.?\)|\(Chưa /);
});

test('máy chủ giữ thiếu lệnh thì hướng dẫn nói ra, kèm lệnh đầu tiên bị mất', async () => {
  // Nhận đủ mà giữ thiếu là hai chuyện khác nhau, và chúng cần hai người khác nhau đi sửa. Bot đọc
  // lại danh sách từ `getMe` thay vì tin câu trả lời của chính lệnh ghi, nên nói được đúng chuyện
  // thứ hai — thứ mà `/vgc` im lặng trong khi `/vcg` chạy đang ám chỉ.
  const { sent } = await withBot([update({ text: '@bocobot help' })], { keepCommands: 3, settle: 400 });
  assert.match(sent[0].text, /máy chủ chỉ giữ 3 — mất \d+, từ "/);
});

test('chú thích bị từ chối thì hướng dẫn nói ra mã lỗi', async () => {
  const { sent } = await withBot(
    [
      update({ text: '/gia vic', command: 'gia', commandArgs: 'vic' }, 1),
      update({ text: '@bocobot help' }, 2),
    ],
    { refuseViews: true, expect: 2 },
  );
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Chú thích thuật ngữ chưa bật được: bot_has_no_widget/);
});

// ---- kết quả kinh doanh theo mảng -------------------------------------------------------------

const SEGMENTS = {
  symbol: 'VIC',
  period: { year: 2025, quarter: 2 },
  unit: 'tỷ đồng',
  measure: 'doanh thu',
  source: 'Vietcap IQ',
  segments: [
    { name: 'Bất động sản', value: 25300, previous: 22600 },
    { name: 'Công nghiệp', value: 18400, previous: 15000 },
    { name: 'Thương mại, dịch vụ', value: 9000, previous: null },
  ],
  totals: [
    { label: 'DT thuần', value: 52700, previous: 47000, margin: false },
    { label: 'LNG', value: 13000, previous: null, margin: true },
    { label: 'LNST', value: 6500, previous: null, margin: true },
  ],
};

const vcRow = (year, quarter, values) => ({ yearReport: year, lengthReport: quarter, publicDate: '2026-08-29T00:00:00', ...values });

test('!kq đọc mã và kỳ báo cáo', () => {
  assert.deepEqual(askedResultsFor(message({ text: '!kq vic' })), { addressed: true, symbol: 'VIC', period: { year: null, quarter: null, annual: false } });
  assert.deepEqual(askedResultsFor(message({ text: '!kq vic q2' })).period, { year: null, quarter: 2, annual: false });
  assert.deepEqual(askedResultsFor(message({ text: '!kq hpg q3 2025 -v' })).period, { year: 2025, quarter: 3, annual: false });
  assert.deepEqual(parseResultsPeriod(['2024']), { year: 2024, quarter: null, annual: true });
  assert.deepEqual(parseResultsPeriod(['năm']), { year: null, quarter: null, annual: true });
  assert.equal(parseResultsPeriod(['q5']), null);
  assert.match(askedResultsFor(message({ text: '!kq' })).error, /!kq vic/);
  assert.match(askedResultsFor(message({ text: '!kq vic q9' })).error, /kỳ báo cáo/);
  assert.equal(askedResultsFor(message({ text: '!ptkt vic' })), null);
});

test('kết quả: dòng lớn trước, % đóng góp, so cùng kỳ, dòng tổng có biên lợi nhuận', () => {
  const lines = resultsMessage(SEGMENTS).split('\n');
  assert.equal(lines[0], 'KQKD VIC · Q2/2025 · cơ cấu doanh thu (tỷ đồng)');
  assert.equal(lines[1], '1. Bất động sản — 25.300 (48%) · +11,9% cùng kỳ');
  assert.equal(lines[3], '3. Thương mại, dịch vụ — 9.000 (17,1%)');
  assert.equal(lines[4], 'DT thuần 52.700 (+12,1% cùng kỳ) · LNG 13.000, biên 24,7% · LNST 6.500, biên 12,3%');
  assert.equal(lines[5], 'Nguồn: Vietcap IQ');
  assert.ok(termEntities(lines.join('\n')).some((entity) => entity.data === GLOSSARY.LNST));

  const many = { ...SEGMENTS, segments: Array.from({ length: 14 }, (_, i) => ({ name: `Dòng ${i + 1}`, value: 100 - i, previous: null })) };
  const manyLines = resultsMessage(many).split('\n');
  assert.equal(manyLines.filter((line) => /^\d+\. /.test(line)).length, MOST_SEGMENTS + 1);
  assert.match(manyLines[MOST_SEGMENTS + 1], /^11\. Khác \(4 dòng\)/);

  const totalsOnly = resultsMessage({ ...SEGMENTS, segments: [] });
  assert.match(totalsOnly, /Kỳ này chưa có thuyết minh cơ cấu doanh thu/);
  assert.match(resultsMessage({ symbol: 'ABC', period: { year: 2025, quarter: 1 } }), /chưa có số liệu báo cáo tài chính cho Q1\/2025/);
});

test('!kq vẽ hình: ô số tổng, thanh ngang lớn trước, cùng kỳ mờ phía sau; chữ đi kèm chỉ còn dòng tổng', () => {
  const svg = resultsSvg(SEGMENTS);
  assert.match(svg, /<svg [^>]*width="2000" height="\d+" viewBox="0 0 1000 \d+"/);
  assert.match(svg, /KQKD VIC · Q2\/2025/);
  assert.ok(svg.indexOf('Bất động sản') < svg.indexOf('Công nghiệp'));
  assert.match(svg, /Cùng kỳ năm trước/);
  assert.match(svg, /DT thuần/);
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/);

  const reply = resultsRich(SEGMENTS);
  assert.equal(reply.image.fileName, 'kq-vic-q2-2025.svg');
  assert.doesNotMatch(reply.text, /Bất động sản/);
  assert.match(reply.text, /^KQKD VIC · Q2\/2025[^\n]*\nDT thuần 52\.700/);

  assert.equal(resultsSvg({ symbol: 'ABC', period: { year: 2025, quarter: 1 } }), null);
  assert.match(resultsRich({ symbol: 'ABC', period: { year: 2025, quarter: 1 } }), /chưa có số liệu/);
});

test('Vietcap: nhận ra loại công ty và chọn đúng kỳ, kèm cùng kỳ năm trước', () => {
  assert.equal(profileOf({ INCOME_STATEMENT: [{ field: 'isa1' }, { field: 'isa5' }] }), 'normal');
  assert.equal(profileOf({ INCOME_STATEMENT: [{ field: 'isb27' }] }), 'bank');
  assert.equal(profileOf({ INCOME_STATEMENT: [{ field: 'isa1' }, { field: 'iss42' }] }), 'securities');
  assert.equal(profileOf({ INCOME_STATEMENT: [{ field: 'isi103' }, { field: 'isb36' }] }), 'insurance');

  const data = {
    quarters: [vcRow(2026, 2, { v: 1 }), vcRow(2026, 1, { v: 2 }), vcRow(2025, 2, { v: 3 }), vcRow(2025, 4, { v: 4 })],
    years: [{ ...vcRow(2025, 5, { v: 5 }) }, { ...vcRow(2024, 5, { v: 6 }) }],
  };
  assert.equal(pickReportPeriod(data, {}).row.v, 1);
  assert.equal(pickReportPeriod(data, {}).previous.v, 3);
  assert.equal(pickReportPeriod(data, { quarter: 4 }).row.v, 4);
  assert.equal(pickReportPeriod(data, { annual: true }).row.v, 5);
  assert.equal(pickReportPeriod(data, { annual: true }).previous.v, 6);
  assert.equal(pickReportPeriod(data, { quarter: 3 }), null);
});

test('Vietcap: doanh nghiệp tách doanh thu theo thuyết minh, ngân hàng theo nguồn thu nhập', () => {
  const normal = vietcapReport('vic', { year: null, quarter: null, annual: false }, {
    metrics: {
      INCOME_STATEMENT: [{ field: 'isa1' }, { field: 'isa3' }, { field: 'isa5' }, { field: 'isa20' }],
      NOTE: [
        { field: 'noc102', level: 1, parent: null, titleVi: 'Doanh thu' },
        { field: 'noc103', level: 2, parent: 'NOC102', titleVi: 'Doanh thu bán hàng' },
        { field: 'noc104', level: 2, parent: 'NOC102', titleVi: 'Doanh thu cung cấp dịch vụ' },
        { field: 'noc105', level: 2, parent: 'NOC102', titleVi: 'Doanh thu hợp đồng xây dựng' },
      ],
    },
    income: { quarters: [
      vcRow(2026, 2, { isa3: 117568392e6, isa5: 29496057e6, isa20: 15294192e6 }),
      vcRow(2025, 2, { isa3: 100000000e6, isa5: 20000000e6, isa20: 5000000e6 }),
    ], years: [] },
    note: { quarters: [
      vcRow(2026, 2, { noc103: 100201601e6, noc104: 17395635e6, noc105: 0 }),
      vcRow(2025, 2, { noc103: 80000000e6, noc104: 20000000e6 }),
    ], years: [] },
  });
  assert.equal(normal.kind, 'normal');
  assert.deepEqual(normal.period, { year: 2026, quarter: 2 });
  assert.deepEqual(normal.segments.map((segment) => segment.name), ['Doanh thu bán hàng', 'Doanh thu cung cấp dịch vụ']);
  const text = resultsMessage(normal);
  assert.match(text, /^KQKD VIC · Q2\/2026 · cơ cấu doanh thu \(tỷ đồng\)/);
  assert.match(text, /1\. Doanh thu bán hàng — 100\.202 \(85,2%\) · \+25,3% cùng kỳ/);
  assert.match(text, /DT thuần 117\.568 \(\+17,6% cùng kỳ\) · LNG 29\.496, biên 25,1% · LNST 15\.294, biên 13%/);
  assert.match(text, /Nguồn: Vietcap IQ · BCTC công bố 29\/08\/2026/);

  const bank = vietcapReport('vcb', {}, {
    metrics: { INCOME_STATEMENT: [
      { field: 'isb27', titleVi: 'Thu nhập lãi thuần' }, { field: 'isb30', titleVi: 'Lãi/Lỗ thuần từ hoạt động dịch vụ' },
      { field: 'isb36', titleVi: 'Lãi/(lỗ) thuần từ hoạt động khác' }, { field: 'isb38', titleVi: 'Tổng thu nhập hoạt động' },
    ] },
    income: { quarters: [vcRow(2026, 2, { isb27: 19142e9, isb30: 860e9, isb36: 4059e9, isb38: 26372e9, isa16: 17420e9, isa20: 14551e9 })], years: [] },
    note: null,
  });
  assert.equal(bank.kind, 'bank');
  const bankText = resultsMessage(bank);
  assert.match(bankText, /cơ cấu thu nhập hoạt động/);
  assert.match(bankText, /1\. Thu nhập lãi thuần — 19\.142/);
  assert.match(bankText, /Tổng thu nhập HĐ 26\.372 · LNTT 17\.420, biên 66,1% · LNST 14\.551, biên 55,2%/);
});

test('Vietcap: mã không có thì không có dữ liệu, nguồn chết thì ném', async () => {
  const missing = vietcapResults({ fetchImpl: async () => new Response('{}', { status: 404 }) });
  assert.equal(await missing.segments('ZZZZ', {}), null);
  const down = vietcapResults({ fetchImpl: async () => new Response('lỗi', { status: 502 }) });
  await assert.rejects(down.segments('VIC', {}));
});

test('!kq vic hỏi đúng nguồn và trả lời; nguồn chết thì nói ra', async () => {
  const calls = [];
  const results = { async segments(symbol, period) { calls.push([symbol, period]); return SEGMENTS; } };
  const { sent } = await withBot(
    [update({ text: '!kq vic q2', command: 'kq', commandArgs: 'vic q2', commandPrefix: '!', private: true })],
    { results, expect: 1 },
  );
  assert.deepEqual(calls, [['VIC', { year: null, quarter: 2, annual: false }]]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].image.fileName, 'kq-vic-q2-2025.svg');
  assert.match(sent[0].text, /^KQKD VIC · Q2\/2025/);
  assert.equal(sent[0].onlyForUserId, 'u1');

  const broken = { async segments() { throw new Error('nguồn chết'); } };
  const failed = await withBot([update({ text: '!kq vic' })], { results: broken });
  assert.match(failed.sent[0].text, /Nguồn báo cáo tài chính đang không trả lời/);
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

test('giữa phiên, nến 5 phút của hôm nay thành cây nến cuối để phân tích theo giá hiện tại', () => {
  const lastDay = RISING.at(-1);
  const today = lastDay.time + 86400;
  const minutes = [
    { time: today, open: 50, high: 51, low: 49.5, close: 50.5, volume: 1000 },
    { time: today + 300, open: 50.5, high: 52, low: 50, close: 51.8, volume: 2000 },
  ];
  const rows = withSession(RISING, [lastDay, ...minutes]);
  assert.equal(rows.length, RISING.length + 1);
  assert.deepEqual(rows.at(-1), { time: today, open: 50, high: 52, low: 49.5, close: 51.8, volume: 3000 });

  // Nguồn nến ngày đã có ngày ấy thì nến ngày thắng.
  assert.equal(withSession(RISING, [lastDay]), RISING);
  assert.equal(withSession(RISING, []), RISING);
});

test('bài phân tích lấy phiên đang chạy từ nến 5 phút khi nến ngày chưa có hôm nay', async () => {
  const today = RISING.at(-1).time + 86400;
  const technical = technicalAnalysis({
    now: () => (today + 3600) * 1000,
    async fetchImpl(url) {
      if (/resolution=5/.test(url)) {
        return Response.json(asRaw([{ time: today, open: 60, high: 61, low: 59, close: 60.5, volume: 5000 }]));
      }
      return Response.json(asRaw(/symbol=VNINDEX/.test(url) ? INDEX_ROWS : RISING));
    },
  });
  const reply = await technical.report('abc');
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(today * 1000));
  assert.match(reply.text, new RegExp(`^PTKT ABC · phiên ${day.replace(/\//g, '\\/')}`));
  assert.match(reply.text, /· 60,5 \(/);
});

test('nguồn nến chết hẳn thì ném, để bot nói nguồn đang không trả lời', async () => {
  const technical = technicalAnalysis({ fetchImpl: async () => new Response('lỗi', { status: 503 }) });
  await assert.rejects(technical.report('VIC'));
});

test('nguồn tin chết thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!tin vic' })], { news: stubNews({ broken: true }) });
  assert.equal(sent[0].text, SORRY.news);
});

test('gõ tên bot không để lại tin nhắn trong phòng, và cờ ấy chỉ xin khi chưa có', async () => {
  // Với bot này, gõ tên nó là để **mở** bảng chứ không phải nói gì với ai — mỗi lần gõ để lại một
  // dòng giữa phòng là rác, và trong nhóm đông thì là rác đẩy trôi thứ người ta đang nói.
  const { settings } = await withBot([], { expect: 0 });
  assert.deepEqual(settings, [{ quietMention: true }]);

  // Cờ là thuộc tính của bot, không phải của lần chạy: đã bật rồi thì khởi động lại đừng ghi đè.
  const { settings: lai } = await withBot([], { expect: 0, quiet: true });
  assert.deepEqual(lai, []);
});

test('khởi động là khai báo lệnh chính kèm các mã thanh khoản cao', async () => {
  // Mã đã khai báo thì `!vic` thành lệnh riêng và biến khỏi nhóm. Nên gửi đúng một từ: tên bot.
  const { registered, declares } = await withBot([], { expect: 0 });
  assert.deepEqual(registered.map((one) => one.command), ['view', 'ptkt', 'sugg', 'liqu', 'thanhkhoan', 'vang', 'sjc', 'bac', 'tg', 'tin', 'kq', 'manh', 'hoiphuc', 'dongtien', 'strategy', 'chienluoc', 'board', 'bangdien', 'vboa', 'bang', 'bocobot', 'vic', 'hpg']);
  assert.ok(registered.every((one) => one.description.length <= 256));

  // Đúng **một** lần khai báo, và lần ấy đã có mã.
  //
  // `setCommands` thay nguyên si danh sách cũ, nên khai lệnh chính trước rồi mới đi xếp hạng là tự
  // tay xoá sạch mã khỏi bảng lệnh: mỗi lần khởi động là một quãng `/vgc` im lặng, và một lần xếp
  // hạng hỏng là im cho tới lần sau. Danh sách của lần chạy trước vẫn phục vụ được trong lúc đợi.
  assert.equal(declares.length, 1);
  assert.ok(declares[0].includes('vic'), 'lần khai báo duy nhất phải có mã, không phải danh sách trống');
});

// ---- !sugg ---------------------------------------------------------------------------------------

test('!sugg đọc được, kể cả có chữ thừa phía sau; chữ khác thì không', () => {
  assert.deepEqual(askedSuggestFor(message({ text: '!sugg' })), { addressed: true });
  assert.deepEqual(askedSuggestFor(message({ text: '!SUGG hôm nay' })), { addressed: true });
  assert.equal(askedSuggestFor(message({ text: '!suggest' })), null);
  assert.equal(askedSuggestFor(message({ text: 'sugg' })), null);
});

test('/sugg trả lời một tin, đi qua đúng nguồn giá và nguồn hồ sơ của bot', async () => {
  const suggest = stubSuggest();
  const { sent } = await withBot([update({ text: '/sugg', command: 'sugg', commandArgs: null, commandPrefix: '/' })], { suggest });
  assert.equal(suggest.calls.length, 1);
  assert.ok(suggest.calls[0].company?.profile);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^MÃ ĐÁNG MUA · .+ · quét 0 mã\nChưa có mã/);
});

test('nguồn nến chết khi !sugg thì nói ra', async () => {
  const { sent } = await withBot([update({ text: '!sugg' })], { suggest: stubSuggest({ broken: true }) });
  assert.equal(sent[0].text, SORRY.source);
});

/// Tăng, và phiên cuối vừa chỉnh về sát vùng mua — mua được ngay chứ không phải mua đuổi.
const BUYABLE = candles(260, (i) => 20 * 1.004 ** i * (1 + 0.02 * Math.sin((i + 1) / 3)));

function suggestWorld({ caps = {}, ceiling = [], deadCompany = false } = {}) {
  const series = { VNINDEX: INDEX_ROWS, AAA: BUYABLE, BBB: BUYABLE, CCC: BUYABLE, DDD: FALLING, EEE: RISING };
  const asked = [];
  const market = {
    async universe() { return [...Object.keys(series), 'E1VFVN30']; },
    async quotes(symbols) {
      return symbols.filter((symbol) => series[symbol]).map((symbol) => {
        const close = series[symbol].at(-1).close;
        return normalize({
          sym: symbol, r: close, c: ceiling.includes(symbol) ? close : close * 1.07, f: close * 0.93,
          lastPrice: close, lot: 1000,
        });
      });
    },
  };
  const company = {
    async profile(symbol) {
      if (deadCompany) throw new Error('Vietcap trả lời 503');
      return { symbol, marketCap: caps[symbol] ?? null };
    },
  };
  const daily = async (symbol) => {
    asked.push(symbol);
    return series[symbol] ?? [];
  };
  return { market, company, asked, suggest: suggestions({ daily, now: () => SATURDAY.getTime() }) };
}

test('!sugg chỉ đưa mã tích cực, vốn hoá từ 1.000 tỷ, không đứng giá trần — chứng chỉ quỹ thì không quét', async () => {
  const world = suggestWorld({
    caps: { AAA: 5000e9, BBB: MIN_MARKET_CAP - 1, CCC: 2000e9, DDD: 9000e9, EEE: 9000e9 },
    ceiling: ['CCC'],
  });
  const result = await world.suggest.top(world.market, world.company);
  const { picks, scanned } = result;
  // BBB nhỏ, CCC đứng trần, DDD giảm, EEE tăng nhưng đã chạy xa vùng mua.
  assert.deepEqual(picks.map((pick) => pick.symbol), ['AAA']);
  assert.equal(scanned, 5);
  assert.ok(!world.asked.includes('E1VFVN30'));

  const text = suggestMessage({ at: SATURDAY, scanned, picks });
  assert.match(text, /^TOP 1 MÃ ĐÁNG MUA · /);
  // Mỗi mã một dòng chữ; lý do, điểm và R:R nằm trên hình.
  assert.match(text, /\n1\. AAA \S+ \S+ · mua .+ · chốt .+ · cắt lỗ \S+\n/);
  assert.match(text, /không phải khuyến nghị đầu tư/);

  // Hình đặt mã được chọn cạnh phân bố điểm của mọi mã đã chấm.
  assert.equal(result.scores.length, 5);
  const rich = suggestRich(result);
  assert.equal(rich.text, text);
  assert.match(rich.image.fileName, /^sugg-\d{4}-\d{2}-\d{2}\.svg$/);
  assert.match(rich.image.svg, /^<svg /);
  assert.match(rich.image.svg, /thuộc nhóm [\d,]+% điểm cao nhất/);
  assert.match(rich.image.svg, new RegExp(`điểm \\+${picks[0].score}:</tspan> AAA`));
  assert.match(rich.image.svg, />R:R /);
});

test('!sugg không có mã nào thì chỉ gửi chữ, không vẽ một hình rỗng', () => {
  const reply = suggestRich({ at: SATURDAY, scanned: 800, scores: [0, 1, -2], picks: [] });
  assert.equal(typeof reply, 'string');
  assert.match(reply, /Chưa có mã/);
});

test('!sugg mã không rõ vốn hoá thì bỏ, nguồn hồ sơ chết hẳn thì báo lỗi chứ không trả danh sách rỗng', async () => {
  const unknown = suggestWorld();
  assert.deepEqual((await unknown.suggest.top(unknown.market, unknown.company)).picks, []);

  const dead = suggestWorld({ deadCompany: true });
  await assert.rejects(dead.suggest.top(dead.market, dead.company), /vốn hoá/);
});

test('!sugg hỏi lại trong hai phút thì dùng lại lần quét trước, không quét lại cả sàn', async () => {
  const world = suggestWorld({ caps: { AAA: 5000e9 } });
  await Promise.all([world.suggest.top(world.market, world.company), world.suggest.top(world.market, world.company)]);
  await world.suggest.top(world.market, world.company);
  assert.equal(world.asked.filter((symbol) => symbol === 'AAA').length, 1);
});

test('!sugg trong phiên nối cây nến hôm nay từ bảng giá; ngoài phiên thì không đụng', () => {
  const rows = candles(40, () => 10);
  const quote = normalize({ sym: 'AAA', r: 10, c: 10.7, f: 9.3, lastPrice: 10.5, lot: 100, openPrice: '10', highPrice: '10.6', lowPrice: '9.9' });
  const monday = new Date('2026-09-14T03:00:00Z');
  const joined = withQuote(rows, quote, monday);
  assert.equal(joined.length, 41);
  assert.deepEqual([joined.at(-1).open, joined.at(-1).high, joined.at(-1).low, joined.at(-1).close], [10, 10.6, 9.9, 10.5]);
  assert.equal(withQuote(rows, quote, SATURDAY), rows);
});

// ---- !liqu ---------------------------------------------------------------------------------------

test('!liqu và !thanhkhoan cùng là một lệnh; chữ khác thì không', () => {
  assert.deepEqual(askedLiquidityFor(message({ text: '!liqu' })), { addressed: true });
  assert.deepEqual(askedLiquidityFor(message({ text: '!ThanhKhoan' })), { addressed: true });
  assert.equal(askedLiquidityFor(message({ text: '!liquid' })), null);
  assert.equal(askedLiquidityFor(message({ text: 'thanhkhoan' })), null);
});

test('/thanhkhoan gửi chart kèm chữ trong một tin; nguồn chết thì nói ra', async () => {
  const liquidity = stubLiquidity();
  const { sent } = await withBot([update({ text: '/thanhkhoan', command: 'thanhkhoan', commandArgs: null, commandPrefix: '/' })], { liquidity });
  assert.equal(liquidity.calls, 1);
  assert.equal(sent[0].image.fileName, 'thanhkhoan-2026-10-21.svg');

  const failed = await withBot([update({ text: '!liqu' })], { liquidity: stubLiquidity({ broken: true }) });
  assert.match(failed.sent[0].text, /Nguồn thanh khoản đang không trả lời/);
});

test('thanh khoản so hôm nay với **cùng giờ** phiên trước, không phải với cả phiên', () => {
  // 20/10 và 21/10, nến phút lúc 9:15, 10:00, 14:12, 14:45 giờ Việt Nam; giá trị bằng triệu đồng.
  const at = (day, hour, minute) => String(Date.UTC(2026, 9, day, hour - 7, minute) / 1000);
  const data = {
    t: [at(20, 9, 15), at(20, 10, 0), at(20, 14, 12), at(20, 14, 45), at(21, 9, 15), at(21, 10, 0), at(21, 14, 12)],
    accumulatedValue: [100e3, 3000e3, 10000e3, 13000e3, 200e3, 5000e3, 16500e3],
  };
  const sessions = sessionsFrom(data);
  assert.deepEqual(sessions.map((one) => one.day), ['2026-10-20', '2026-10-21']);

  const shown = compare(sessions);
  assert.equal(shown.value, 16500e9);
  assert.equal(shown.then, 10000e9);
  assert.equal(shown.beforeTotal, 13000e9);
  assert.equal(Math.round(shown.percent), 65);

  const rich = liquidityRich(shown);
  assert.match(rich.text, /^Thanh khoản VN-Index phiên 21\/10\/2026 tới 14:12: 16\.500 tỷ đồng, tăng 65,00% so với cùng giờ phiên 20\/10\/2026 \(10\.000 tỷ\)/);
  assert.match(rich.text, /\nCả phiên 20\/10\/2026: 13\.000 tỷ$/);
  assert.equal(rich.image.fileName, 'thanhkhoan-2026-10-21.svg');
  assert.match(rich.image.svg, /^<svg /);
  assert.match(rich.image.svg, /tăng \+65,00% so với hôm qua/);

  assert.equal(compare(sessions.slice(-1)), null);
});

// ---- vàng: !vang và !tg -------------------------------------------------------------------------

test('!vang và !sjc cùng là một lệnh; chữ khác thì không', () => {
  assert.deepEqual(askedGoldFor(message({ text: '!vang' })), { addressed: true, kind: 'gold' });
  assert.deepEqual(askedGoldFor(message({ text: '!SJC' })), { addressed: true, kind: 'gold' });
  assert.equal(askedGoldFor(message({ text: '!vanga' })), null);
  assert.equal(askedGoldFor(message({ text: 'vang' })), null);
});

test('!bac đi cùng đường vào nhưng trả về kim loại khác, vì khác nguồn', () => {
  assert.deepEqual(askedGoldFor(message({ text: '!bac' })), { addressed: true, kind: 'silver' });
  assert.deepEqual(askedGoldFor(message({ text: '!Bac' })), { addressed: true, kind: 'silver' });
  assert.deepEqual(askedGoldFor(message({ text: '!vang' })), { addressed: true, kind: 'gold' });
  assert.equal(askedGoldFor(message({ text: '!bacci' })), null);
  assert.equal(askedGoldFor(message({ text: 'bac' })), null);
});

test('!tg là prefix của thị trường ngoài: trơn là cả hai, có chữ là một', () => {
  assert.equal(WORLD_COMMAND, 'tg');
  assert.deepEqual(askedWorldFor(message({ text: '!tg' })), { addressed: true, symbols: ['XAU', 'DXY'] });
  assert.deepEqual(askedWorldFor(message({ text: '!tg xau' })), { addressed: true, symbols: ['XAU'] });
  assert.deepEqual(askedWorldFor(message({ text: '!tg dxy' })), { addressed: true, symbols: ['DXY'] });
  // Một mã không có trong bảng tên thì nhắc cú pháp, không im và không đoán bừa.
  assert.match(askedWorldFor(message({ text: '!tg vang' })).error, /!tg/);
  // Không phải prefix này thì không phải việc của nó.
  assert.equal(askedWorldFor(message({ text: '!tgi' })), null);
  assert.equal(askedWorldFor(message({ text: '!vang' })), null);
});

test('XAU và DXY trả lời bằng mã người ta gõ, không phải mã của Yahoo', async () => {
  const world = stubWorld();
  const { sent } = await withBot([update({ text: '!tg' })], { world });
  assert.deepEqual(world.calls, [['XAU', 'DXY']]);
  assert.match(sent[0].text, /^XAU 4\.030,7 USD ▼ -0,19%/);
  assert.match(sent[0].text, /\nDXY 102,04 USD ▲ \+0,08%/);
  // Không có `GC=F` hay `DX-Y.NYB` nào lọt ra tin nhắn.
  assert.doesNotMatch(sent[0].text, /GC=F|DX-Y\.NYB/);
});

test('!tg xau chỉ hỏi một mã', async () => {
  const world = stubWorld();
  const { sent } = await withBot([update({ text: '!tg xau' })], { world });
  assert.deepEqual(world.calls, [['XAU']]);
  assert.match(sent[0].text, /^XAU /);
  assert.doesNotMatch(sent[0].text, /DXY/);
});

test('nguồn vàng thế giới chết thì nói ra, không im', async () => {
  const { sent } = await withBot([update({ text: '!tg' })], { world: stubWorld({ broken: true }) });
  assert.match(sent[0].text, /vàng thế giới đang không trả lời/);
});

test('!vang in cả một lượng lẫn một chỉ, và nhân mười từ đơn vị một chỉ của nguồn', async () => {
  const gold = stubGold();
  const { sent } = await withBot([update({ text: '!vang' })], { gold });
  assert.equal(gold.calls, 1);
  assert.match(sent[0].text, /^Vàng miếng SJC 1 lượng: 140\.500\.000 – 142\.000\.000 đồng$/m);
  assert.match(sent[0].text, /^Vàng miếng SJC 1 chỉ: 14\.050\.000 – 14\.200\.000 đồng$/m);
  assert.match(sent[0].text, /^Nhẫn tròn trơn 999\.9 1 lượng: 140\.500\.000 – 142\.000\.000 đồng$/m);
  assert.match(sent[0].text, /Giá mua vào – bán ra · 27\/10 09:30$/);
});

test('một chỉ phải bằng đúng một phần mười một lượng — phép nhân mười ghim lại', () => {
  const [sjc] = vnGold([{ code: 'SJC', buyingPrice: 14050000, sellingPrice: 14200000, dateTime: '27/10/2026 09:30' }]);
  assert.equal(sjc.buyPerChi, 14050000);
  assert.equal(sjc.buyPerLuong, 140500000);
  assert.equal(sjc.sellPerLuong, 142000000);
  assert.equal(sjc.buyPerLuong, sjc.buyPerChi * 10);
});

test('loại vàng chỉ thu vào thì không in giá bán bằng 0', () => {
  const rows = vnGold([{ code: 'SJC', buyingPrice: 14050000, sellingPrice: 0, dateTime: '27/10/2026 09:30' }]);
  assert.equal(rows[0].sellPerLuong, null);
  assert.equal(rows[0].buyPerLuong, 140500000);
  assert.match(vnGoldText(rows), /1 lượng: 140\.500\.000 đồng/);
  assert.doesNotMatch(vnGoldText(rows), /– 0 đồng/);
});

test('nguồn vàng trong nước chết thì nói ra, không im', async () => {
  const { sent } = await withBot([update({ text: '!vang' })], { gold: stubGold({ broken: true }) });
  assert.match(sent[0].text, /Nguồn giá vàng đang không trả lời/);
});

test('nguồn không có loại vàng nào quen thì nói ra, không gửi khung rỗng', async () => {
  const { sent } = await withBot([update({ text: '!vang' })], { gold: stubGold({ rows: [] }) });
  assert.match(sent[0].text, /Nguồn giá vàng đang không trả lời/);
});

test('tham chiếu của XAU là cây nến đã đóng gần nhất, không phải chartPreviousClose', () => {
  // `chartPreviousClose` của Yahoo là giá đóng cửa **trước cả khung**, không phải phiên liền trước.
  // Một bài test ghim lại: lấy nhầm nó thì mức tăng giảm là của cả tuần.
  const data = {
    chart: {
      result: [{
        meta: { currency: 'USD', regularMarketTime: 1793075678, chartPreviousClose: 4060.4 },
        indicators: { quote: [{ close: [4060.4, 4007.9, 4038.4, 4030.7] }] },
      }],
    },
  };
  const one = worldQuote('XAU', data);
  assert.equal(one.reference, 4038.4);
  assert.equal(one.price, 4030.7);
  assert.equal(one.change, -7.7);
  assert.equal(one.percent, -0.19);
  assert.equal(one.currency, 'USD');
});

test('chỉ số thế giới có ngày nghỉ: chỗ close null bị bỏ, không thành giá 0', () => {
  const data = {
    chart: {
      result: [{
        meta: { currency: 'USD' },
        indicators: { quote: [{ close: [101.61, null, 101.96, 102.037] }] },
      }],
    },
  };
  const one = worldQuote('DXY', data);
  assert.equal(one.reference, 101.96);
  assert.equal(one.price, 102.037);
  assert.ok(one.percent > 0);
});

test('phản hồi thiếu nến thì không có giá, không phải giá 0', () => {
  assert.equal(worldQuote('XAU', { chart: { result: [{ meta: {}, indicators: { quote: [{ close: [4030.7] }] } }] } }), null);
  assert.equal(worldQuote('XAU', { chart: { result: null } }), null);
  assert.equal(worldQuote('XAU', {}), null);
});

test('nguồn vàng gọi đúng đường dẫn, và đòi User-Agent vì Yahoo đóng cửa với request trần', async () => {
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push({ url, headers: options?.headers ?? {} });
    return {
      ok: true,
      json: async () => (url.includes('mihong')
        ? [{ code: 'SJC', buyingPrice: 14050000, sellingPrice: 14200000, dateTime: '27/10/2026 09:30' }]
        : { chart: { result: [{ meta: {}, indicators: { quote: [{ close: [4038.4, 4030.7] }] } }] } }),
    };
  };

  await mihongGold({ fetchImpl }).price();
  await yahooQuotes({ fetchImpl }).quotes(['XAU']);

  assert.match(asked[0].url, /market=domestic/);
  assert.ok(asked[0].headers['User-Agent']);
  // Mã trên Yahoo phải là `GC=F`, không phải `XAU` — `=` có thể được mã hoá trong đường dẫn.
  assert.match(decodeURIComponent(asked[1].url), /\/GC=F\?/);
  assert.doesNotMatch(decodeURIComponent(asked[1].url), /\/XAU\?/);
  assert.ok(asked[1].headers['User-Agent']);
});

test('giá vàng trong nước và thế giới không lẫn vào bộ đọc mã cổ phiếu', async () => {
  // `VANG`, `SJC`, `XAU`, `DXY` đều đúng hình một mã, nên nếu lệnh vàng không chạy trước `askedFor`
  // thì chúng thành những lượt hỏi giá cổ phiếu — và câu trả lời là "không có dữ liệu".
  //
  // Không khẳng định nguồn chứng khoán **không được gọi**: lúc khởi động nó vẫn được gọi để xếp
  // hạng mã cho bảng lệnh. Điều cần ghim là không chữ vàng nào lọt vào lượt hỏi ấy.
  const asked = [];
  const market = {
    async universe() { return ['VIC', 'HPG']; },
    async quotes(symbols) { asked.push(...symbols); return []; },
  };

  const gold = stubGold();
  const world = stubWorld();
  const { sent } = await withBot(
    [update({ text: '!vang' }), update({ text: '!sjc' }, 2), update({ text: '!tg' }, 3)],
    { gold, market, world, expect: 3 },
  );

  assert.equal(gold.calls, 2);
  assert.deepEqual(world.calls, [['XAU', 'DXY']]);
  for (const word of ['VANG', 'SJC', 'XAU', 'DXY', 'TG']) {
    assert.ok(!asked.includes(word), `${word} lọt vào nguồn giá cổ phiếu`);
  }
  assert.match(sent[0].text, /Vàng miếng SJC/);
  assert.match(sent[2].text, /^XAU /);
});

// ---- bạc: !bac và !tg xag ------------------------------------------------------------------------

test('!bac lấy đúng dòng 1 LƯỢNG, không lấy 1 KG hay 5 LƯỢNG', () => {
  // Nguồn có cả ba quy cách. Chọn nhầm "5 LƯỢNG" thì giá vọt lên năm lần mà trông vẫn hợp lý.
  const rows = vnSilver([
    btmcSilverRow('BẠC THỎI BẠC RỒNG THĂNG LONG Ag 999 1 KG (BẠC RỒNG THĂNG LONG Ag 999)', 45892186, 48025466),
    btmcSilverRow('BẠC MIẾNG BẠC RỒNG THĂNG LONG Ag 999 5 LƯỢNG (BẠC RỒNG THĂNG LONG Ag 999)', 8605000, 9005000),
    btmcSilverRow('BẠC MIẾNG BẠC RỒNG THĂNG LONG Ag 999 1 LƯỢNG (BẠC RỒNG THĂNG LONG Ag 999)', 1721000, 1801000),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brand, 'Rồng Thăng Long');
  assert.equal(rows[0].buyPerLuong, 1721000);
  assert.equal(rows[0].sellPerLuong, 1801000);
});

test('một lượng bạc bằng đúng một phần năm dòng 5 LƯỢNG — đơn vị ghim lại', () => {
  // Đối chiếu nội tại của nguồn: 5 LƯỢNG = 9.005.000 thì 1 LƯỢNG phải là 1.801.000. Đây là chỗ
  // chứng minh "lượng" ở bảng bạc cũng là 37,5 g, không phải một quy cách khác — cùng phép kiểm đã
  // dùng cho vàng ở Mi Hồng, chỉ khác là ở đây đơn vị nằm sẵn trong tên sản phẩm.
  const rows = vnSilver([
    btmcSilverRow('BẠC MIẾNG BẠC RỒNG THĂNG LONG Ag 999 5 LƯỢNG (BẠC RỒNG THĂNG LONG Ag 999)', 8605000, 9005000),
    btmcSilverRow('BẠC MIẾNG BẠC RỒNG THĂNG LONG Ag 999 1 LƯỢNG (BẠC RỒNG THĂNG LONG Ag 999)', 1721000, 1801000),
  ]);
  assert.equal(rows.length, 1);   // dòng 5 LƯỢNG không lọt vào
  assert.equal(rows[0].sellPerLuong, 1801000);
  assert.equal(rows[0].sellPerLuong * 5, 9005000);   // = giá thỏi 5 lượng của chính nguồn
  assert.equal(rows[0].buyPerLuong * 5, 8605000);
});

test('!bac in cả hai thương hiệu, không gộp — chênh nhau gần 2%', async () => {
  const silver = stubSilver();
  const { sent } = await withBot([update({ text: '!bac' })], { silver });
  assert.equal(silver.calls, 1);
  assert.match(sent[0].text, /^Bạc miếng Phú Quý Ag 999 1 lượng: 1\.715\.000 – 1\.768\.000 đồng$/m);
  assert.match(sent[0].text, /^Bạc miếng Rồng Thăng Long Ag 999 1 lượng: 1\.721\.000 – 1\.801\.000 đồng$/m);
  assert.match(sent[0].text, /Giá mua vào – bán ra · 27\/10 11:40$/);
});

test('!bac không hỏi nguồn vàng, và !vang không hỏi nguồn bạc', async () => {
  const gold = stubGold();
  const silver = stubSilver();

  await withBot([update({ text: '!bac' })], { gold, silver, expect: 1 });
  assert.equal(silver.calls, 1);
  assert.equal(gold.calls, 0);

  const gold2 = stubGold();
  const silver2 = stubSilver();
  await withBot([update({ text: '!vang' })], { gold: gold2, silver: silver2, expect: 1 });
  assert.equal(gold2.calls, 1);
  assert.equal(silver2.calls, 0);
});

test('nguồn bạc chết thì nói ra là bạc, không nói là vàng', async () => {
  const { sent } = await withBot([update({ text: '!bac' })], { silver: stubSilver({ broken: true }) });
  assert.match(sent[0].text, /Nguồn giá bạc đang không trả lời/);
});

test('nguồn bạc không có dòng nào quen thì nói ra, không gửi khung rỗng', async () => {
  const { sent } = await withBot([update({ text: '!bac' })], { silver: stubSilver({ rows: [] }) });
  assert.match(sent[0].text, /Nguồn giá bạc đang không trả lời/);
});

test('!tg mặc định không kèm bạc; !tg xag mới có', async () => {
  const world = stubWorld();
  const { sent } = await withBot([update({ text: '!tg' })], { world });
  assert.deepEqual(world.calls, [['XAU', 'DXY']]);
  assert.doesNotMatch(sent[0].text, /XAG/);

  const asked = stubWorld();
  const only = await withBot([update({ text: '!tg xag' })], { world: asked });
  assert.deepEqual(asked.calls, [['XAG']]);
  assert.match(only.sent[0].text, /^XAG /);
});

test('!tg xau xag gõ được cùng lúc, xếp XAU trước XAG rồi DXY', () => {
  const world = stubWorld();
  const one = (symbol, price, reference) => worldQuote(symbol, {
    chart: { result: [{ meta: { currency: 'USD' }, indicators: { quote: [{ close: [reference, price] }] } }] },
  });
  const text = worldText([
    one('DXY', 102.037, 101.96), one('XAG', 53.31, 54.108), one('XAU', 4030.7, 4038.4),
  ]);
  assert.match(text, /^XAU /m);
  assert.ok(text.indexOf('XAU') < text.indexOf('XAG'));
  assert.ok(text.indexOf('XAG') < text.indexOf('DXY'));
});

test('XAG dùng mã `SI=F` của Yahoo, không phải `XAG`', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return {
      ok: true,
      json: async () => ({ chart: { result: [{ meta: {}, indicators: { quote: [{ close: [54.1, 53.3] }] } }] } }),
    };
  };
  await yahooQuotes({ fetchImpl }).quotes(['XAG']);
  assert.match(decodeURIComponent(asked[0]), /\/SI=F\?/);
});

test('tên trường của BTMC đọc theo tiền tố, không theo số cố định', () => {
  // Dòng 460 mang `@n_460`, không phải `@n_1`. Đọc cứng số thì mọi dòng ra `undefined`, và cái sai
  // ấy im lặng: bảng giá rỗng chứ không phải một lỗi.
  const rows = vnSilver([
    { '@n_460': 'BẠC MIẾNG PHÚ QUÝ Ag 999 1 LƯỢNG (PHÚ QUÝ)', '@pb_460': '1715000', '@ps_460': '1768000', '@d_460': '27/10/2026 11:40' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].buyPerLuong, 1715000);
  assert.equal(rows[0].sellPerLuong, 1768000);
});

test('nguồn bạc gọi đúng đường dẫn có tham số key bắt buộc, và đọc đúng túi phẳng của BTMC', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return {
      ok: true,
      json: async () => ({
        DataList: {
          Data: [
            { '@n_95': 'BẠC MIẾNG PHÚ QUÝ Ag 999 1 LƯỢNG (PHÚ QUÝ)', '@pb_95': '1715000', '@ps_95': '1768000', '@d_95': '27/10/2026 11:40' },
          ],
        },
      }),
    };
  };

  const rows = await btmcSilver({ fetchImpl }).price();
  // Thiếu `key` là `404`, nên nó phải có mặt — dù giá trị chỉ là hình thức.
  assert.match(asked[0], /[?&]key=/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brand, 'Phú Quý');
  assert.equal(vnSilverText(rows), [
    'Bạc miếng Phú Quý Ag 999 1 lượng: 1.715.000 – 1.768.000 đồng',
    'Giá mua vào – bán ra · 27/10 11:40',
  ].join('\n'));
});

test('túi phẳng của BTMC hỏng hình thì ra rỗng, không ném', async () => {
  for (const body of [{}, { DataList: {} }, { DataList: { Data: null } }, { Error: 'nope' }]) {
    const fetchImpl = async () => ({ ok: true, json: async () => body });
    assert.deepEqual(await btmcSilver({ fetchImpl }).price(), []);
  }
});
