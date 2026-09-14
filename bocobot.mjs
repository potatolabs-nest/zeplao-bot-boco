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
// **Một: làm sao `/vic` tới được đây?** Nền tảng giao một lệnh trơ trọi cho bot **chỉ khi bot đã
// đăng ký đúng chữ ấy** — `/vic` không đăng ký thì không con bot nào nghe thấy. Mà `setCommands`
// chỉ nhận 100 lệnh, còn ba sàn có 1.522 mã. Nên `commandsFor` dưới đây đăng ký 98 mã **thanh
// khoản cao nhất**, xếp hạng từ chính dữ liệu phiên gần nhất chứ không viết tay, và mọi mã còn
// lại vào bằng ba đường khác: `/gia xyz`, `@bot xyz`, hoặc `/xyz@bot` — gọi đích danh thì nền
// tảng giao, biết chữ ấy hay không.
//
// **Hai: cái gì là mã chứng khoán?** Những lệnh đã đăng ký không phải thứ duy nhất tới đây:
// `/tienlen@bocobot` cũng tới, và trong một phòng tắt chế độ riêng tư thì mọi câu đều tới. Nên luật là không chắc
// thì im, và cái sàng làm việc đó ở `market/symbols.mjs`.
//
// **Ba: giá lấy ở đâu?** Một dây nguồn, không phải một nguồn. Feed công khai đứng trước vì nó
// nhanh và có trần sàn; DNSE đứng sau cho chỉ số, phái sinh, và cho những ngày feed kia không
// dậy. Bot không biết nguồn nào đang trả lời — nó nhận một cái hình có `quotes` và `universe`,
// và đó là lý do đổi nguồn không phải sửa một dòng nào trong file này.
//
// **Bốn: con số này của lúc nào?** Feed không gửi kèm dấu thời gian. Một cái giá của phiên hôm
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
import { looksLikeCode, makeGuard, tokensIn } from './market/symbols.mjs';
import { googleNews, newsMessage } from './market/news.mjs';
import { intradayChart, parseChartPeriod, withRich } from './market/chart.mjs';
import { askedHeatmapFor, marketHeatmap } from './market/heatmap.mjs';
import { technicalAnalysis } from './market/technical.mjs';

/// Nơi nền tảng bot ở. Tên riêng, không phải `kuku.vn` — bot là mã của bên thứ ba, và giữ nó
/// khỏi cái tên người ta đang dùng là thứ cho phép chặn, đo và dời nó mà không ai phải sửa gì.
export const API = process.env.ZEPLAO_BOT_API ?? 'https://api-bot.kuku.vn';

/// Chỗ nhớ đã đọc tới đâu. Nhỏ, nhưng là thứ ngăn một lần khởi động lại phát lại cả trăm câu
/// hỏi cũ vào phòng — xem `offset` ở dưới.
export const STATE = process.env.BOCO_STATE
  ?? fileURLToPath(new URL('./data/state.json', import.meta.url));

/// Dấu gọi bot.
///
/// Không phải gạch chéo, và đó là cả cách con bot này thoát khỏi hai cái trần cùng lúc. Nền
/// tảng chỉ giao `/xyz` cho bot đã đăng ký đúng chữ ấy, mà chỗ đăng ký có 100 ô cho 1.522 mã —
/// nên đường gạch chéo không bao giờ phủ hết được. Còn `!vic` chỉ là một câu chữ thường: bot
/// nghe được nó vì chủ bot đã tắt chế độ riêng tư, và nó chạy với **mọi mã**, không trừ mã nào.
///
/// Một dấu người ta phải cố ý gõ cũng là thứ giữ cho bot im. Nghe cả phòng rồi trả lời mỗi khi
/// ai đó nhắc tên một mã thì hỏng: đo thử, 16 từ tiếng Việt thông dụng viết không dấu trùng mã
/// niêm yết — "hom nay", "tin nay", "thu xem". Không ai gõ nhầm một dấu chấm than.
export const CALL = '!';
export const PRIVATE_FLAG = '-v';

/// Lệnh gạch chéo của riêng bot này. Không đăng ký nữa, nên chỉ tới nơi khi gọi đích danh —
/// `/gia@bocobot vic` — vì lệnh nêu tên thì nền tảng giao thẳng, biết chữ ấy hay không.
const OWN = new Set(['gia', 'giá', 'boco', 'bocobot', 'bangdien']);

export const SORRY = {
  nothing: 'Không nhận ra mã nào.',
  source: 'Nguồn giá đang không trả lời. Thử lại sau một lát.',
  news: 'Nguồn tin đang không trả lời. Thử lại sau một lát.',
};

export const HELP = [
  'Cú pháp xem bảng giá:',
  '!vic — giá VIC kèm chart trong phiên gần nhất',
  '!vic hpg fpt — xem nhiều mã, không kèm chart',
  '!tin vic — 5 tin gần nhất về VIC',
  '!ptkt vic — phân tích kỹ thuật VIC: xu hướng, điểm mua bán, độ tin cậy',
  '',
  'Chart theo thời gian:',
  '!gex 1d — chart trong phiên gần nhất',
  '!gex 2d — chart 2 ngày',
  '!gex 3m — chart 3 tháng',
  '!gex 4y hoặc !gex 4n — chart 4 năm',
  '',
  'Bản đồ nhiệt:',
  '!vboa — toàn thị trường',
  '!vboa bds — bất động sản',
  '!vboa bank — bank chứng',
  '!vboa oil — dầu khí',
  '!vboa retail — bán lẻ',
  '!vboa cn — công nghiệp',
  '',
  'Thêm -v ở cuối lệnh để chỉ gửi cho riêng bạn, ví dụ: !gex 3m -v hoặc !vboa bank -v',
].join('\n');

export function askedHelpFor(message, me) {
  if (!message) return null;

  const handles = [me?.username, me?.displayName].filter(Boolean);
  const text = withoutPrivateFlag(message.text ?? '');
  const named = handles.some((handle) => text.toLowerCase().includes(`@${handle}`.toLowerCase()));
  if (!named) return null;

  let asked = text;
  for (const handle of handles) {
    asked = asked.replace(new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), ' ');
  }
  asked = asked.replace(/@\S+/g, ' ').trim();
  return !asked || /^help$/i.test(asked) ? { addressed: true } : null;
}

export function privateRecipientFor(message) {
  const text = String(message?.text ?? '').trim();
  if (!new RegExp(`(^|\\s)${PRIVATE_FLAG.replace('-', '\\-')}$`, 'i').test(text)) return null;
  return message?.from?.userId
    ?? message?.from?.id
    ?? message?.userId
    ?? message?.senderId
    ?? message?.authorId
    ?? null;
}

function withoutPrivateFlag(text) {
  return String(text ?? '').replace(new RegExp(`\\s+${PRIVATE_FLAG.replace('-', '\\-')}\\s*$`, 'i'), '').trimEnd();
}

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
export function askedFor(message, me, mine = new Set()) {
  if (!message) return null;

  const handles = [me?.username, me?.displayName].filter(Boolean);
  const text = withoutPrivateFlag(message.text ?? '');
  const named = handles.some((handle) => text.toLowerCase().includes(`@${handle}`.toLowerCase()));
  // Dấu gọi, trước tiên. Đây là đường vào chính và là đường duy nhất phủ hết 1.522 mã.
  if (text.trimStart().startsWith(CALL)) {
    return {
      symbols: tokensIn(text.trimStart().slice(CALL.length)),
      addressed: true,
      strict: true,
    };
  }

  const command = (message.command ?? '').toLowerCase();

  if (command) {
    if (OWN.has(command)) {
      return { symbols: tokensIn(message.commandArgs), addressed: true, strict: true };
    }
    // Một lệnh không phải của ai cả: rất có thể là một mã, cũng rất có thể là bot bên cạnh.
    // Cái sàng ở `symbols.mjs` phân xử; ở đây chỉ ghi nhận là chưa ai gọi tên bot này.
    return {
      symbols: tokensIn(`${command} ${message.commandArgs ?? ''}`),
      addressed: named,
      strict: true,
    };
  }

  // Trả lời **tin của chính bot**, chứ không phải trả lời bất kỳ ai.
  //
  // Chỗ này từng là `message.replyToMessageId` trơ trọi, và nó là một con bot chen vào mọi cuộc
  // trò chuyện: trong một phòng đã tắt chế độ riêng tư, mọi tin đều tới bot, nên **mọi lần ai
  // đó trả lời ai đó** đều được đọc như một câu hỏi. "vip zzzz" ra bảng giá VIP, "giá pom đẹp
  // thế" ra POM, và câu báo lỗi "bug bot cứ tin reply" ra cả BOT lẫn TIN. Ba từ trong đó là mã
  // có thật, và đó là toàn bộ vấn đề.
  //
  // Nền tảng có biết ai là người viết tin được trả lời — `Sees()` dùng nó — nhưng không gửi
  // kèm cho bot. Nên bot tự nhớ lấy id những tin mình đã gửi. Nhớ trong bộ nhớ, nên khởi động
  // lại là quên: trả lời một tin bot gửi trước lúc restart sẽ không được nghe. Đổi lại là một
  // dòng, không phải một cái sổ.
  //
  // Nhắn riêng **không** được miễn. Chỗ này từng cho hộp thư 1:1 đi thẳng qua, với lý do ở đấy
  // mọi câu đều nói với bot — và thế là `vic` gõ trần trụi cũng ra bảng giá, quote một tin nào
  // đó cũng ra bảng giá, chỉ vì trong câu có một chữ ba ký tự hình mã. Người ta vẫn nói chuyện
  // trong hộp thư riêng. Nên 1:1 theo đúng luật của nhóm: dấu gọi, lệnh, gọi tên, hoặc trả lời
  // tin của bot.
  const replyingToBot = Boolean(message.replyToMessageId && mine.has(message.replyToMessageId));
  if (!named && !replyingToBot) return null;

  // Bỏ mọi cách gọi tên ra khỏi câu trước khi đọc mã: `@bocobot` mà để nguyên thì `BOCOBOT` là
  // một chữ ba ký tự trở lên, đúng hình một mã, và sẽ được đem đi dò.
  let asked = text;
  for (const handle of handles) {
    asked = asked.replace(new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), ' ');
  }
  asked = asked.replace(/@\S+/g, ' ');

  // `addressed: false` cho ba đường này, và đó không phải chuyện chữ nghĩa: nó quyết định bot
  // có nói gì không khi **không tra được mã nào**. Gõ hẳn `!xyz` thì im lặng là hỏng — người ta
  // vừa cố ý gõ một dấu. Còn trả lời một tin của bot bằng "mua dc k" thì một dòng "Không nhận
  // ra mã nào" là bot cãi lại một câu không hỏi nó. Chỉ dấu gọi mới đáng được đáp khi hỏng.
  return { symbols: tokensIn(asked), addressed: named, strict: false };
}

/**
 * `!tin vic` là lệnh tin tức, còn `!tin` một mình vẫn là hỏi giá mã TIN.
 *
 * Chỗ này chạy trước `askedFor`, vì nếu để bộ đọc giá nhìn thấy cả câu thì nó sẽ hiểu thành hai
 * mã `TIN` và `VIC`. Chỉ có dạng `!tin <một mã>` đi vào đây; một câu dài hơn được giữ lại để
 * nhắc người hỏi chọn đúng một mã thay vì âm thầm đem đi tra giá.
 */
export function askedNewsFor(message) {
  const text = withoutPrivateFlag(message?.text ?? '').trimStart();
  if (!text.startsWith(CALL)) return null;

  const asked = text.slice(CALL.length).trim();
  if (!/^tin(\s|$)/i.test(asked)) return null;
  if (/^tin$/i.test(asked)) return null;

  const symbols = tokensIn(asked.replace(/^tin\b/i, ''));
  if (symbols.length !== 1) {
    return { addressed: true, error: 'Mỗi lần chỉ xem tin cho một mã, ví dụ: !tin vic.' };
  }
  if (!looksLikeCode(symbols[0])) {
    return { addressed: true, error: 'Không nhận ra mã cần xem tin.' };
  }
  return { addressed: true, symbol: symbols[0] };
}

/**
 * `!ptkt vic` là lệnh phân tích kỹ thuật, mỗi lần đúng một mã.
 *
 * Chạy trước `askedFor` vì cùng lý do với `!tin`: để bộ đọc giá thấy cả câu thì nó tra `PTKT` và
 * `VIC`. `PTKT` không phải mã nào, nên `!ptkt` đứng một mình được nhắc cú pháp chứ không rơi
 * xuống tra giá.
 */
export function askedTechnicalFor(message) {
  const text = withoutPrivateFlag(message?.text ?? '').trimStart();
  if (!text.startsWith(CALL)) return null;

  const asked = text.slice(CALL.length).trim();
  if (!/^ptkt(\s|$)/i.test(asked)) return null;

  const symbols = tokensIn(asked.replace(/^ptkt\b/i, ''));
  if (symbols.length !== 1) {
    return { addressed: true, error: 'Mỗi lần chỉ phân tích kỹ thuật một mã, ví dụ: !ptkt vic.' };
  }
  if (!looksLikeCode(symbols[0])) {
    return { addressed: true, error: 'Không nhận ra mã cần phân tích, ví dụ: !ptkt vic.' };
  }
  return { addressed: true, symbol: symbols[0] };
}

/**
 * `!gex 1n` vẫn là hỏi giá GEX, nhưng chart đi kèm dùng khung 1 năm.
 *
 * Chỉ nhận đúng dạng `!<mã> <kỳ hạn>` để một câu hỏi nhiều mã không bị hiểu nhầm là chart riêng.
 * Kỳ hạn là số cộng `d`, `m`, `y`; `n` được giữ như alias tiếng Việt của `y`.
 */
export function askedChartFor(message) {
  const text = withoutPrivateFlag(message?.text ?? '').trimStart();
  if (!text.startsWith(CALL)) return null;

  const parts = text.slice(CALL.length).trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;

  const symbol = parts[0].toUpperCase();
  const period = parseChartPeriod(parts[1]);
  if (!looksLikeCode(symbol) || !period) return null;
  return { symbol, period: period.key };
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
  news = googleNews(),
  chart = intradayChart(),
  statePath = STATE,
  at = () => new Date(),
  heatmap = marketHeatmap({ at }),
  technical = technicalAnalysis(),
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

  const guard = makeGuard({ market });

  // **Không đăng ký lệnh nào**, và nói ra điều đó để máy chủ xoá danh sách cũ.
  //
  // Nền tảng chỉ giao `/xyz` cho bot đã khai là có `/xyz`, mà chỗ khai có đúng 100 ô cho 1.522
  // mã — nên đường gạch chéo không bao giờ phủ hết được. Đường đi là chữ thường: tắt chế độ
  // riêng tư thì bot nghe cả phòng, và `vic` gõ trần trụi chạy với mọi mã, không trừ mã nào.
  //
  // Danh sách rỗng gửi lên có việc của nó: `setCommands` thay nguyên si, nên đây là cách duy
  // nhất dọn những gì đã đăng ký trước đó.
  await call('setCommands', { commands: [] }).catch((problem) => console.error(String(problem)));

  // Danh sách niêm yết tải ngay nhưng không đợi: câu hỏi đầu tiên có thể tới trước khi ba sàn
  // trả lời xong, và lúc ấy cái sàng vẫn làm việc được — bằng cách dò thay vì tra.
  guard.universe().then(() => console.log(`biết ${guard.size} mã niêm yết`)).catch(() => {});

  /**
   * Id những tin nhắn bot đã gửi.
   *
   * Để biết một lần trả lời là trả lời bot hay trả lời người khác — thứ nền tảng biết nhưng
   * không nói cho bot. Cắt bớt khi đầy: một phòng nói cả ngày thì cái tập này lớn mãi, mà chẳng
   * ai trả lời một tin của tuần trước.
   */
  const mine = new Set();
  const REMEMBERED = 500;

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
        if (update.kind === 'message') await onMessage(update.message);
      } catch (problem) {
        console.error(String(problem));
      }
    }
  }

  async function onMessage(message) {
    const onlyForUserId = privateRecipientFor(message);

    const helpAsked = askedHelpFor(message, me);
    if (helpAsked) {
      await say(message.conversationId, HELP, message.messageId, onlyForUserId);
      return;
    }

    const heatmapAsked = askedHeatmapFor(message);
    if (heatmapAsked) {
      if (heatmapAsked.error) {
        await say(message.conversationId, heatmapAsked.error, message.messageId, onlyForUserId);
        return;
      }

      try {
        const rich = await heatmap.rich(market, heatmapAsked);
        await say(
          message.conversationId,
          rich ?? 'Chưa dựng được bản đồ nhiệt. Thử lại sau một lát.',
          message.messageId,
          onlyForUserId,
        );
      } catch (problem) {
        console.error(String(problem));
        await say(message.conversationId, SORRY.source, message.messageId, onlyForUserId);
      }
      return;
    }

    const newsAsked = askedNewsFor(message);
    if (newsAsked) {
      if (newsAsked.error) {
        await say(message.conversationId, newsAsked.error, message.messageId, onlyForUserId);
        return;
      }

      try {
        const articles = await news.latest(newsAsked.symbol);
        await say(message.conversationId, newsMessage(newsAsked.symbol, articles), message.messageId, onlyForUserId);
      } catch (problem) {
        console.error(String(problem));
        await say(message.conversationId, SORRY.news, message.messageId, onlyForUserId);
      }
      return;
    }

    const technicalAsked = askedTechnicalFor(message);
    if (technicalAsked) {
      if (technicalAsked.error) {
        await say(message.conversationId, technicalAsked.error, message.messageId, onlyForUserId);
        return;
      }

      try {
        const text = await technical.report(technicalAsked.symbol);
        await say(message.conversationId, text, message.messageId, onlyForUserId);
      } catch (problem) {
        console.error(String(problem));
        await say(message.conversationId, SORRY.source, message.messageId, onlyForUserId);
      }
      return;
    }

    const asked = askedFor(message, me, mine);
    if (!asked) return;

    const wanted = asked.symbols.slice(0, MAX_SYMBOLS);
    const candidates = await guard.candidates(wanted);

    if (!candidates.length) {
      // Không có gì trông giống một mã. Nếu có người gọi thẳng thì phải nói, còn không thì đây
      // là lệnh của con bot bên cạnh và việc đúng đắn duy nhất là không nói gì.
      if (asked.addressed) await say(message.conversationId, SORRY.nothing, message.messageId, onlyForUserId);
      return;
    }

    let quotes;
    try {
      quotes = await market.quotes(candidates);
    } catch (problem) {
      console.error(String(problem));
      if (asked.addressed) await say(message.conversationId, SORRY.source, message.messageId, onlyForUserId);
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
      if (asked.addressed) await say(message.conversationId, SORRY.nothing, message.messageId, onlyForUserId);
      return;
    }

    const text = reply(quotes, listing, at());
    console.log(`${listing.join(' ')} -> ${found.size} mã`);

    if (asked.strict && asked.addressed && listing.length === 1 && found.has(listing[0])) {
      try {
        const chartAsked = askedChartFor(message);
        const period = chartAsked?.symbol === listing[0] ? chartAsked.period : undefined;
        const rich = await chart.rich(listing[0], quotes.find((quote) => quote.symbol === listing[0]), period);
        await say(message.conversationId, withRich(text, rich), message.messageId, onlyForUserId);
        return;
      } catch (problem) {
        console.error(String(problem));
      }
    }

    await say(message.conversationId, text, message.messageId, onlyForUserId);
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
  async function say(conversationId, text, replyToMessageId, onlyForUserId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const content = typeof text === 'string' ? { text } : text;
        const posted = await call('sendMessage', {
          conversationId,
          ...content,
          replyToMessageId,
          ...(onlyForUserId ? { onlyForUserId } : {}),
        });
        const id = posted?.id ?? posted?.messageId;
        if (id) {
          mine.add(id);
          if (mine.size > REMEMBERED) mine.delete(mine.values().next().value);
        }
        return posted;
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
    return { offset: Number(read.offset) || 0 };
  } catch {
    return { offset: 0 };
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
