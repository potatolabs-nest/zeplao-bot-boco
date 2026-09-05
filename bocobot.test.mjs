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

import { askedFor, run, SORRY } from './bocobot.mjs';
import { normalize } from './market/quote.mjs';

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
  assert.equal(asked.addressed, true);
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

/**
 * Cho bot chạy tới khi nó đã làm xong việc, rồi bảo nó dừng.
 *
 * `settle` là một khoảng lặng có chủ ý: để chứng minh bot **không** gửi gì thì phải cho nó đủ
 * thời gian để gửi. Một bài test khẳng định sự im lặng mà không đợi thì chỉ đang đo tốc độ máy.
 */
async function withBot(updates, { market = stubMarket(), expect = 1, settle = 200 } = {}) {
  const platform = await stubApi(updates);
  const stopping = new AbortController();
  const statePath = join(tmpdir(), `boco-${randomUUID()}.json`);

  const loop = run('token', {
    signal: stopping.signal,
    api: platform.api,
    market,
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

test('gọi tên mà không có mã nào thì được chỉ cách hỏi', async () => {
  const { sent } = await withBot([update({ text: '@bocobot ơi' })]);
  assert.equal(sent[0].text, SORRY.nothing);
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

test('khởi động là xoá sạch danh sách lệnh cũ', async () => {
  // Không đăng ký gì cả, và nói ra điều đó: `setCommands` thay nguyên si, nên một danh sách
  // rỗng là cách duy nhất dọn những gì đã đăng ký ở lần chạy trước.
  const { registered } = await withBot([], { expect: 0 });
  assert.deepEqual(registered, []);
});
