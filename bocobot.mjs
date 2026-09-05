// Một con bot trả lời giá cổ phiếu trong nhóm chat.
//
//   ZEPLAO_BOT_TOKEN=... node bocobot.mjs
//
// Thêm nó vào nhóm rồi gõ `/vic`, `/hpg`, hoặc `/gia vic hpg fpt`. Nó trả về một dòng một mã:
// giá khớp gần nhất, tăng giảm bao nhiêu phần trăm, khối lượng đã khớp.
//
// Cả con bot là một vòng lặp chờ và một câu trả lời. Không framework, không phụ thuộc, không
// bước build — giống `mathbot` trong repo Cúc Cu, và cố ý giữ như vậy: thứ khó ở đây không nằm
// ở mã, nó nằm ở hai câu hỏi bên dưới.
//
// **Một: cái gì là mã chứng khoán?** Trong một phòng có ba con bot, mọi tin nhắn bắt đầu bằng
// `/` đều tới cả ba. `/tienlen` của người khác cũng rơi vào đây. Nên luật là không chắc thì im,
// và cái sàng làm việc đó ở `market/symbols.mjs`.
//
// **Hai: giá lấy ở đâu?** Một dây nguồn, không phải một nguồn. Feed công khai đứng trước vì nó
// nhanh và có trần sàn; DNSE đứng sau cho chỉ số, phái sinh, và cho những ngày feed kia không
// dậy. Bot không biết nguồn nào đang trả lời — nó nhận một cái hình có `quotes` và `universe`,
// và đó là lý do đổi nguồn không phải sửa một dòng nào trong file này.
//
// **Ba: con số này của lúc nào?** Feed không gửi kèm dấu thời gian. Một cái giá của phiên hôm
// kia trông y hệt một cái giá của mười giây trước, và không có gì trong dữ liệu nói cho biết.
// Nên câu trả lời mang theo một dòng nói sàn đang mở hay đã đóng, suy từ đồng hồ — xem
// `sessionNote` ở `market/quote.mjs`, kể cả chỗ nó không biết.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

import { MAX_SYMBOLS, reply } from './market/quote.mjs';
import { publicFeed, withCache } from './market/vps.mjs';
import { dnse } from './market/dnse.mjs';
import { chain } from './market/chain.mjs';
import { makeGuard, tokensIn } from './market/symbols.mjs';

/// Nơi nền tảng bot ở. Tên riêng, không phải `kuku.vn` — bot là mã của bên thứ ba, và giữ nó
/// khỏi cái tên người ta đang dùng là thứ cho phép chặn, đo và dời nó mà không ai phải sửa gì.
export const API = process.env.ZEPLAO_BOT_API ?? 'https://api-bot.kuku.vn';

/// Chỗ nhớ đã đọc tới đâu. Nhỏ, nhưng là thứ ngăn một lần khởi động lại phát lại cả trăm câu
/// hỏi cũ vào phòng — xem `offset` ở dưới.
export const STATE = process.env.BOCO_STATE
  ?? fileURLToPath(new URL('./data/state.json', import.meta.url));

/// Lệnh của riêng bot này: luôn trả lời, kể cả không ai gọi tên.
const OWN = new Set(['gia', 'giá', 'boco', 'bocobot', 'bangdien']);

/// Lệnh dùng chung cả xóm: chỉ trả lời khi được gọi đích danh, vì `/help` trong một phòng ba
/// con bot mà cả ba cùng nói là ba lần rác.
const GENERIC = new Set(['help', 'start', 'huongdan']);

export function greeting(handle) {
  return `Chào cả nhà. Tôi tra giá chứng khoán — gõ /vic hoặc /hpg để xem một mã, `
    + `/gia vic hpg fpt để xem nhiều mã một lúc, hoặc @${handle} vic.`;
}

export function help(handle) {
  return [
    'Tôi tra giá cổ phiếu ba sàn HOSE, HNX và UPCOM.',
    '',
    '/vic — một mã',
    '/gia vic hpg fpt — nhiều mã, tối đa ' + MAX_SYMBOLS,
    `@${handle} vic hpg — hỏi bằng cách gọi tên`,
    '',
    'Giá tính theo nghìn đồng, khối lượng theo cổ phiếu. Mã nào tôi không nhận ra thì tôi im,',
    'để khỏi chen vào lệnh của bot khác trong phòng.',
  ].join('\n');
}

export const SORRY = {
  nothing: 'Không nhận ra mã nào. Thử /vic, hoặc /gia vic hpg.',
  source: 'Nguồn giá đang không trả lời. Thử lại sau một lát.',
};

/**
 * Câu hỏi này hỏi cái gì, nếu nó có hỏi gì.
 *
 * Trả về `null` khi tin nhắn không dành cho bot này — và đó là kết quả hay gặp nhất, vì nền
 * tảng đưa **mọi** dòng bắt đầu bằng `/` cho **mọi** bot trong phòng.
 *
 * Ba trường trả về, và cái thứ ba là cái đáng đọc kỹ:
 *
 * - `symbols` — những chữ có thể là mã, theo đúng thứ tự đã hỏi.
 * - `addressed` — có ai gọi thẳng bot này không. Quyết định việc *có nói gì không* khi không tra
 *   được gì: được gọi thẳng thì im lặng là hỏng, không được gọi thì nói là chen ngang.
 * - `strict` — câu hỏi có phải một lệnh không. `/gia vic zzz` là lệnh: `zzz` được nêu tên là
 *   không có dữ liệu, vì người ta gõ đúng chữ ấy có chủ ý. `@bot giá vic thế nào` thì không:
 *   trong đó có vài chữ ba ký tự trông như mã mà không phải, và kê chúng ra là biến một câu trả
 *   lời thành một danh sách lỗi.
 */
export function askedFor(message, me) {
  if (!message) return null;

  const handles = [me?.username, me?.displayName].filter(Boolean);
  const text = message.text ?? '';
  const named = handles.some((handle) => text.toLowerCase().includes(`@${handle}`.toLowerCase()));
  const alone = message.conversationType === 'direct';
  const command = (message.command ?? '').toLowerCase();

  if (command) {
    if (GENERIC.has(command)) {
      return named || alone ? { symbols: [], addressed: true, strict: true, help: true } : null;
    }
    if (OWN.has(command)) {
      const symbols = tokensIn(message.commandArgs);
      return { symbols, addressed: true, strict: true, help: symbols.length === 0 };
    }
    // Một lệnh không phải của ai cả: rất có thể là một mã, cũng rất có thể là bot bên cạnh.
    // Cái sàng ở `symbols.mjs` phân xử; ở đây chỉ ghi nhận là chưa ai gọi tên bot này.
    return {
      symbols: tokensIn(`${command} ${message.commandArgs ?? ''}`),
      addressed: named,
      strict: true,
      help: false,
    };
  }

  // Không phải lệnh. Chỉ ba đường còn lại đưa được tin nhắn tới đây, và cả ba đều là gọi thẳng.
  if (!named && !alone && !message.replyToMessageId) return null;

  // Bỏ mọi cách gọi tên ra khỏi câu trước khi đọc mã: `@bocobot` mà để nguyên thì `BOCOBOT` là
  // một chữ ba ký tự trở lên, đúng hình một mã, và sẽ được đem đi dò.
  let asked = text;
  for (const handle of handles) {
    asked = asked.replace(new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), ' ');
  }
  asked = asked.replace(/@\S+/g, ' ');

  const symbols = tokensIn(asked);
  return { symbols, addressed: true, strict: false, help: false };
}

// ---- vòng lặp -------------------------------------------------------------------------------

/**
 * Con bot, đang chạy.
 *
 * `market` và `api` là tham số chứ không chỉ là biến môi trường, vì bộ test cần dựng một nguồn
 * giá giả và một nền tảng giả rồi cho cả hai chạy thật — không có cách nào khác để kiểm cái
 * luật im lặng, vốn là thứ dễ hỏng nhất ở đây và là thứ không bao giờ nhìn thấy khi hỏng.
 *
 * `signal` là chỗ cho Ctrl-C và cho SIGTERM đáp xuống: một cuộc gọi dài ba mươi giây bị cắt
 * ngang không phải là lỗi đáng ghi hai dòng vào log.
 */
export async function run(token, {
  signal,
  api = API,
  market = withCache(chain(publicFeed(), dnse())),
  statePath = STATE,
  at = () => new Date(),
} = {}) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function call(method, body) {
    const response = await fetch(`${api}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: auth,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!response.ok) {
      throw new Error(`${method} trả lời ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  const me = await call('getMe');
  console.log(`@${me.username} đang trực bảng giá`);

  await call('setCommands', {
    commands: [
      { command: 'gia', description: 'Tra giá, ví dụ /gia vic hpg' },
      { command: 'bocobot', description: 'Tôi làm được gì' },
    ],
  });

  const guard = makeGuard({ market });
  // Tải danh sách niêm yết ngay, nhưng không đợi nó: câu hỏi đầu tiên có thể tới trước khi ba
  // sàn trả lời xong, và lúc ấy cái sàng vẫn làm việc được — chỉ là bằng cách dò thay vì tra.
  guard.universe().then(() => console.log(`biết ${guard.size} mã niêm yết`)).catch(() => {});

  const state = loadState(statePath);
  let offset = Number(state.offset) || 0;
  if (offset) console.log(`đọc tiếp từ cập nhật ${offset}`);

  for (;;) {
    if (signal?.aborted) break;

    let updates;
    try {
      updates = await call(`getUpdates?offset=${offset}&timeout=30`);
    } catch (problem) {
      if (signal?.aborted) break;
      console.error(String(problem));
      await wait(2000);
      continue;
    }

    for (const update of updates) {
      // Ghi nhận **trước** khi làm, không phải sau. Một cập nhật làm bot ném lỗi mà chưa ghi
      // nhận thì sẽ quay lại ở lượt hỏi sau, và lượt sau nữa, mãi mãi.
      offset = update.id;
      state.offset = offset;
      saveState(statePath, state);

      try {
        if (update.kind === 'bot_added') await onAdded(update.membership);
        else if (update.kind === 'bot_removed') onRemoved(update.membership);
        else if (update.kind === 'message') await onMessage(update.message);
      } catch (problem) {
        console.error(String(problem));
      }
    }
  }

  /**
   * Chào, đúng một lần cho mỗi phòng.
   *
   * Ghi xuống đĩa, và đó là cả lý do của cái file trạng thái. `bot_added` nằm trong vòng cập
   * nhật nền tảng giữ lại; bất cứ thứ gì phát lại vòng ấy sẽ chào lại — nghĩa là chào lại mỗi
   * lần khởi động, trong mọi phòng. Được một chương trình chào lần thứ tư vì có người vừa sửa
   * một dòng mã thì tệ hơn là không được chào.
   */
  async function onAdded(membership) {
    const room = membership.conversationId;
    if (state.greeted[room]) return;
    state.greeted[room] = true;
    saveState(statePath, state);
    await say(room, greeting(me.username));
  }

  function onRemoved(membership) {
    // Bị đưa ra khỏi phòng. Được thêm lại là một lần đến mới, và đến mới thì được chào.
    delete state.greeted[membership.conversationId];
    saveState(statePath, state);
  }

  async function onMessage(message) {
    const asked = askedFor(message, me);
    if (!asked) return;

    if (asked.help) {
      await say(message.conversationId, help(me.username), message.messageId);
      return;
    }

    const wanted = asked.symbols.slice(0, MAX_SYMBOLS);
    const candidates = await guard.candidates(wanted);

    if (!candidates.length) {
      // Không có gì trông giống một mã. Nếu có người gọi thẳng thì phải nói, còn không thì đây
      // là lệnh của con bot bên cạnh và việc đúng đắn duy nhất là không nói gì.
      if (asked.addressed) await say(message.conversationId, SORRY.nothing, message.messageId);
      return;
    }

    let quotes;
    try {
      quotes = await market.quotes(candidates);
    } catch (problem) {
      console.error(String(problem));
      if (asked.addressed) await say(message.conversationId, SORRY.source, message.messageId);
      return;
    }

    const found = new Set(quotes.map((quote) => quote.symbol));
    for (const symbol of candidates) guard.remember(symbol, found.has(symbol));

    // Mã không tra được chỉ được nêu tên khi **có người gọi thẳng bot này bằng một lệnh**.
    //
    // Hai điều kiện, và thiếu điều nào cũng hỏng. Thiếu `strict`: `@bot giá vic thế nào` biến
    // thành một danh sách lỗi kê ra mọi chữ ba ký tự trong câu. Thiếu `addressed`: `/tienlen`
    // của con bot bên cạnh được đáp lại bằng "TIENLEN — không có dữ liệu", trong phòng, mỗi
    // lần có người gọi nó. Bộ test giữ đúng chỗ này, vì nó đã hỏng đúng theo cách thứ hai.
    const listing = asked.strict && asked.addressed
      ? candidates
      : candidates.filter((symbol) => found.has(symbol));

    if (!listing.length) {
      if (asked.addressed) await say(message.conversationId, SORRY.nothing, message.messageId);
      return;
    }

    const text = reply(quotes, listing, at());
    console.log(`${listing.join(' ')} -> ${found.size} mã`);
    await say(message.conversationId, text, message.messageId);
  }

  /**
   * Nói một câu, đợi tới lượt nếu đang nói nhanh quá.
   *
   * Một phòng nhận một tin mỗi giây. Ba người cùng hỏi một lúc là chạm ngay, và cách xử lý đúng
   * với một `429` là đợi rồi nói — bỏ đi thì người hỏi không nhận được gì, mà từ phía họ thì
   * một con bot không trả lời với một con bot chết là một.
   *
   * Ba lần rồi thôi. Một con bot tự xếp hàng cho mình mãi mãi là một con bot trả lời những câu
   * không ai còn nhớ đã hỏi.
   */
  async function say(conversationId, text, replyToMessageId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await call('sendMessage', { conversationId, text, replyToMessageId });
      } catch (problem) {
        if (!String(problem).includes('429') || attempt === 2) {
          console.error(String(problem));
          return null;
        }
        await wait(1100 * (attempt + 1));
      }
    }
    return null;
  }
}

// ---- trạng thái -----------------------------------------------------------------------------
//
// Hai thứ, và không hơn: đã đọc tới cập nhật nào, và đã chào phòng nào. Không có giá nào được
// lưu ở đây — một cái giá cũ là một cái giá sai, và thứ duy nhất tệ hơn một con bot không trả
// lời là một con bot trả lời bằng số của hôm qua.

function loadState(path) {
  try {
    const read = JSON.parse(readFileSync(path, 'utf8'));
    return { offset: Number(read.offset) || 0, greeted: read.greeted ?? {} };
  } catch {
    return { offset: 0, greeted: {} };
  }
}

/**
 * Ghi trạng thái, và đừng bao giờ chết vì việc ghi.
 *
 * Ghi vào file tạm rồi đổi tên: một tiến trình bị giết giữa lúc ghi để lại file cũ nguyên vẹn
 * thay vì một nửa file JSON không đọc được, mà một file trạng thái hỏng nghĩa là lần khởi động
 * sau phát lại cả vòng cập nhật vào phòng.
 *
 * Hỏng thì kêu một tiếng rồi chạy tiếp. Không ghi được xuống đĩa là chuyện phải sửa; không trả
 * lời được ai vì không ghi được xuống đĩa thì không.
 */
function saveState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(state));
    renameSync(`${path}.tmp`, path);
  } catch (problem) {
    console.error(`không ghi được trạng thái: ${problem}`);
  }
}

// Chỉ khi chính file này được chạy. Được import — bởi bộ test, hay bởi ai đó viết tiếp lên nó —
// thì đây là mấy hàm ở trên và không có gì khác.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.ZEPLAO_BOT_TOKEN;
  if (!token) {
    console.error('Chưa có ZEPLAO_BOT_TOKEN. Tạo bot ở https://kuku.vn/bot rồi đặt biến này.');
    process.exit(2);
  }

  const stopping = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stopping.abort());
  }

  await run(token, { signal: stopping.signal });
}
