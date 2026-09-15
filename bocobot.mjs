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
import { parseResultsPeriod, resultsMessage } from './market/results.mjs';
import { vietcapResults } from './market/vietcap.mjs';
import { refusalCode, refusedForViews, withTerms } from './market/glossary.mjs';
import { publishWidget } from './widget.mjs';

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

/**
 * Lệnh khai báo với máy chủ.
 *
 * Từ 15/09/2026 máy chủ chỉ giao `!từ` và `/từ` trơn cho bot đã khai báo `từ`, nên mọi lệnh phải
 * khai báo trước. Không khai báo được 1.522 mã (tối đa 100 lệnh), nên giá đi sau một chữ riêng:
 * `!view vic` thay cho `!vic`, `!view gex 3m` thay cho `!gex 3m`. Khai báo rồi thì `!lệnh` là hỏi riêng
 * — chỉ người gõ thấy câu trả lời — còn `/lệnh` là hỏi trước cả nhóm; máy chủ lo phần đó.
 *
 * Chữ cuối là tên của chính bot (`topbot`, `bocobot`…), không viết cứng: `!topbot` mở hướng dẫn.
 */
export const MOST_COMMANDS = 100;

export function commandsFor(me, symbols = []) {
  const name = String(me?.username ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'bocobot';
  const base = [
    { command: PRICE_COMMAND, description: 'Giá mọi mã: /view vic cho cả nhóm, !view vic chỉ bạn thấy' },
    { command: 'ptkt', description: 'Phân tích kỹ thuật một mã: !ptkt vic' },
    { command: 'tin', description: '5 tin mới nhất về một mã: !tin vic' },
    { command: 'kq', description: 'Cơ cấu doanh thu, lợi nhuận từ BCTC: !kq vic, !kq vic q2, !kq vic 2025' },
    { command: 'vboa', description: 'Bản đồ nhiệt: !vboa · theo ngành: !vboa bank, bds, oil, retail, cn' },
    { command: name, description: 'Hướng dẫn dùng bot' },
  ];
  const commands = [];
  const words = new Set();
  for (const one of base) {
    if (words.has(one.command)) continue;
    words.add(one.command);
    commands.push(one);
  }
  // Mã thanh khoản cao nhất, mỗi mã một lệnh, cho tới khi hết 100 ô: `/vic` gửi cho cả nhóm, `!vic`
  // chỉ người gõ thấy. Mã ngoài danh sách vẫn đi bằng `/view` và `!view`.
  for (const symbol of symbols) {
    if (commands.length >= MOST_COMMANDS) break;
    const word = String(symbol ?? '').toLowerCase();
    if (!/^[a-z0-9_]{1,32}$/.test(word) || words.has(word)) continue;
    words.add(word);
    commands.push({ command: word, description: `Giá ${word.toUpperCase()}: /${word} cho cả nhóm, !${word} chỉ bạn thấy` });
  }
  return commands;
}

/**
 * Những mã giao dịch nhiều tiền nhất phiên gần nhất, nhiều nhất trước.
 *
 * Xếp theo giá × khối lượng như bản đồ nhiệt, không viết tay: danh sách được khai báo làm lệnh nên
 * nó phải đổi theo thị trường, không theo trí nhớ của ai.
 */
export async function liquidSymbols(market, count = MOST_COMMANDS) {
  const universe = await market.universe();
  const quotes = await market.quotes(universe);
  return quotes
    .filter((quote) => quote && quote.price > 0 && quote.volume > 0 && looksLikeCode(quote.symbol))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, count)
    .map((quote) => quote.symbol);
}

export const SORRY = {
  nothing: 'Không nhận ra mã nào.',
  source: 'Nguồn giá đang không trả lời. Thử lại sau một lát.',
  news: 'Nguồn tin đang không trả lời. Thử lại sau một lát.',
};

export const HELP = [
  'Cú pháp xem bảng giá:',
  '/vic — giá VIC kèm chart, gửi cho cả nhóm',
  '!vic — như trên, nhưng chỉ bạn thấy',
  '/vic hpg fpt — xem nhiều mã, không kèm chart',
  '/view xyz hoặc !view xyz — dùng được cho mọi mã, kể cả mã không có sẵn lệnh riêng',
  '!tin vic — 5 tin gần nhất về VIC',
  '!ptkt vic — phân tích kỹ thuật VIC: xu hướng, điểm mua bán, độ tin cậy',
  '!kq vic — cơ cấu doanh thu, lợi nhuận quý gần nhất; !kq vic q2, !kq vic 2025',
  '',
  'Chart theo thời gian:',
  '/gex 1d — chart trong phiên gần nhất',
  '/gex 2d — chart 2 ngày',
  '/gex 3m — chart 3 tháng',
  '/gex 4y hoặc /gex 4n — chart 4 năm',
  '',
  'Bản đồ nhiệt:',
  '!vboa — toàn thị trường',
  '!vboa bds — bất động sản',
  '!vboa bank — bank chứng',
  '!vboa oil — dầu khí',
  '!vboa retail — bán lẻ',
  '!vboa cn — công nghiệp',
  '',
  'Gõ / thì cả nhóm cùng xem, gõ ! thì chỉ bạn thấy — ví dụ /vboa bank hoặc !ptkt vic',
].join('\n');

export function askedHelpFor(message, me) {
  if (!message) return null;

  const handles = [me?.username, me?.displayName].filter(Boolean);
  const text = withoutPrivateFlag(message.text ?? '');
  if (text.trimStart().startsWith(CALL)) {
    const word = text.trimStart().slice(CALL.length).trim().toLowerCase();
    const own = word === String(me?.username ?? '').toLowerCase();
    return own || (HELP_WORDS.has(word) && (word !== 'help' || message.delivered)) ? { addressed: true } : null;
  }
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
  return senderOf(message);
}

/// Người gửi tin, dù nền tảng đặt id ở trường nào.
export function senderOf(message) {
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

/// Ký tự vô hình mà máy chủ bỏ qua khi đọc lệnh: khoảng trắng độ rộng 0, nối chữ, BOM.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

/// Lệnh giá: `!view vic` là giá VIC.
export const PRICE_COMMAND = 'view';

/**
 * `!view vic` viết lại thành `!vic` — đúng dạng mọi bộ đọc giá bên dưới vẫn hiểu — và đánh dấu
 * `priceOnly`, để `!view tin` là giá mã TIN chứ không bị lệnh tin tức nhận nhầm.
 */
function priced(message) {
  const matched = /^!view(?:\s+|$)([\s\S]*)$/i.exec(message.text);
  return matched ? { ...message, text: `${CALL}${matched[1]}`, priceOnly: true } : message;
}

/// Những lệnh gọi ra hướng dẫn. `help` trơn chỉ tính khi máy chủ đã giao nó cho bot này — một
/// `!help` nói giữa phòng rất có thể là của bot bên cạnh.
const HELP_WORDS = new Set(['help', 'boco', 'bocobot']);

/**
 * Tin nhắn, viết lại về đúng một dạng mà mọi bộ đọc bên dưới hiểu: `!lệnh tham số`.
 *
 * Từ 15/09/2026 máy chủ tự đọc lệnh `!` như đọc `/` (kuku.vn/bot/doc, "Lệnh riêng với !"):
 * `!lệnh@tênbot`, dấu `！` toàn độ rộng, ký tự vô hình đứng trước — tất cả đã được tách sẵn thành
 * `command`, `commandArgs`, `commandPrefix`. Tin nào mang `commandPrefix` là tin máy chủ đã giao
 * **cho chính bot này**, nên dùng đúng những gì nó tách, không cắt lại chuỗi `text` — trong đó
 * còn nguyên `@bocobot`, và `!ptkt@bocobot vic` cắt tay thì thành ba mã PTKT, BOCOBOT, VIC.
 *
 * Tin không mang `commandPrefix` là chữ của phòng mà bot nghe được vì đã tắt chế độ riêng tư: một
 * `!từ` không bot nào khai báo. Chỗ đó tự nới lỏng giống máy chủ. Trả về `null` khi câu ấy gọi
 * đích danh ai khác — `!ptkt@ai_do vic` lọt vào phòng khi `ai_do` không phải bot trong phòng, và
 * nó không nói với bot này.
 */
export function canonicalMessage(message, me) {
  if (!message) return null;

  if (message.commandPrefix && message.command) {
    const args = message.commandArgs ? ` ${message.commandArgs}` : '';
    return priced({ ...message, text: `${CALL}${message.command}${args}`, command: null, commandArgs: null, delivered: true });
  }

  const text = String(message.text ?? '').replace(INVISIBLE, '');
  const leading = text.trimStart();
  if (!/^[!！]/.test(leading)) return text === message.text ? message : { ...message, text };

  let body = leading.slice(1).normalize('NFKC');
  const named = /^([A-Za-z0-9_]{1,32})@([A-Za-z0-9._-]+)(.*)$/s.exec(body);
  if (named) {
    if (named[2].toLowerCase() !== String(me?.username ?? '').toLowerCase()) return null;
    body = `${named[1]}${named[3]}`;
  }
  return priced({ ...message, text: `${CALL}${body}` });
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
    // `!gia vic hpg` — và `/gia vic hpg` sau khi `canonicalMessage` viết lại — thì GIA là tên lệnh,
    // không phải một mã.
    const words = tokensIn(text.trimStart().slice(CALL.length));
    return {
      symbols: OWN.has(words[0]?.toLowerCase()) ? words.slice(1) : words,
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
  if (/^tin$/i.test(asked)) return { addressed: true, error: 'Gõ !tin kèm một mã, ví dụ: !tin vic.' };

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
export function askedResultsFor(message) {
  const text = withoutPrivateFlag(message?.text ?? '').trimStart();
  if (!text.startsWith(CALL)) return null;

  const words = text.slice(CALL.length).trim().split(/\s+/).filter(Boolean);
  if (words[0]?.toLowerCase() !== 'kq') return null;

  const symbol = words[1]?.toUpperCase();
  if (!symbol || !looksLikeCode(symbol)) {
    return { addressed: true, error: 'Gõ !kq kèm một mã, ví dụ: !kq vic, !kq vic q2, !kq vic 2025.' };
  }
  const period = parseResultsPeriod(words.slice(2));
  if (!period) return { addressed: true, error: 'Không đọc được kỳ báo cáo. Ví dụ: !kq vic q2, !kq vic q2 2025, !kq vic 2025.' };
  return { addressed: true, symbol, period };
}

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
  results = vietcapResults(),
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

  // Khai báo đúng `commandsFor(me)`, thay nguyên si danh sách cũ — xem ghi chú ở đó vì sao không
  // khai báo mã nào nữa.
  const declare = (symbols) => call('setCommands', { commands: commandsFor(me, symbols) })
    .catch((problem) => console.error(String(problem)));
  await declare([]);

  // Widget của bot — thẻ giải thích thuật ngữ — tải lên lúc khởi động, không đợi. Gói không đổi thì
  // máy chủ trả `unchanged` và không tốn lượt. Tin gửi trước lúc nó xong mà có chú thích sẽ bị từ
  // chối vì view, và `say` gửi lại không kèm chú thích.
  //
  // Một widget cũ có view mà gói này bỏ đi thì bị từ chối `views_removed`: bot giờ chỉ gửi view
  // `term`, nên bỏ các view kia là đúng ý, và tải lại với `allowViewRemoval`.
  //
  // Hỏng thì mã lỗi được nhớ lại và hiện ở cuối hướng dẫn: không đọc được log của pod thì đó là
  // chỗ duy nhất người dùng nhìn thấy vì sao thuật ngữ không bấm được.
  let widgetTrouble = null;
  publishWidget({ api, token })
    .catch((problem) => (refusalCode(problem) === 'views_removed'
      ? publishWidget({ api, token, allowViewRemoval: true })
      : Promise.reject(problem)))
    .then((widget) => {
      widgetTrouble = null;
      console.log(`widget phiên bản ${widget.version}${widget.unchanged ? ' (không đổi)' : ''}`);
    })
    .catch((problem) => {
      widgetTrouble = refusalCode(problem) ?? 'widget_upload_failed';
      console.error(`không tải được widget: ${problem}`);
    });
  // Rồi thêm các mã thanh khoản cao nhất, không đợi: xếp hạng cần giá cả sàn, và các lệnh chính
  // không nên phải chờ việc đó.
  liquidSymbols(market)
    .then((symbols) => declare(symbols))
    .catch((problem) => console.error(`không xếp hạng được mã để khai báo lệnh: ${problem}`));

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

  async function onMessage(received) {
    const message = canonicalMessage(received, me);
    if (!message) return;
    // Lệnh `!` tới bot như tin riêng thì trả lời bằng **tin cho một người** — `onlyForUserId` là
    // người gõ, đúng cách `-v` vẫn làm — không kèm reply. Tin thường thì reply như trước, và `-v`
    // vẫn là chỉ người hỏi thấy.
    const onlyForUserId = message.private ? senderOf(message) : privateRecipientFor(message);
    const replyTo = message.private ? undefined : message.messageId;

    const helpAsked = !message.priceOnly && askedHelpFor(message, me);
    if (helpAsked) {
      const help = widgetTrouble ? `${HELP}\n\n(Chú thích thuật ngữ chưa bật được: ${widgetTrouble})` : HELP;
      await say(message.conversationId, help, replyTo, onlyForUserId);
      return;
    }

    const heatmapAsked = !message.priceOnly && askedHeatmapFor(message);
    if (heatmapAsked) {
      if (heatmapAsked.error) {
        await say(message.conversationId, heatmapAsked.error, replyTo, onlyForUserId);
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
        await say(message.conversationId, SORRY.source, replyTo, onlyForUserId);
      }
      return;
    }

    const newsAsked = !message.priceOnly && askedNewsFor(message);
    if (newsAsked) {
      if (newsAsked.error) {
        await say(message.conversationId, newsAsked.error, replyTo, onlyForUserId);
        return;
      }

      try {
        const articles = await news.latest(newsAsked.symbol);
        await say(message.conversationId, newsMessage(newsAsked.symbol, articles), replyTo, onlyForUserId);
      } catch (problem) {
        console.error(String(problem));
        await say(message.conversationId, SORRY.news, replyTo, onlyForUserId);
      }
      return;
    }

    const resultsAsked = !message.priceOnly && askedResultsFor(message);
    if (resultsAsked) {
      if (resultsAsked.error || !results) {
        await say(message.conversationId, resultsAsked.error ?? 'Chưa có nguồn số liệu báo cáo tài chính. Thử lại sau.', replyTo, onlyForUserId);
        return;
      }
      try {
        const report = await results.segments(resultsAsked.symbol, resultsAsked.period);
        await say(message.conversationId, resultsMessage(report ?? { symbol: resultsAsked.symbol, period: resultsAsked.period }), replyTo, onlyForUserId);
      } catch (problem) {
        console.error(String(problem));
        await say(message.conversationId, 'Nguồn báo cáo tài chính đang không trả lời. Thử lại sau một lát.', replyTo, onlyForUserId);
      }
      return;
    }

    const technicalAsked = !message.priceOnly && askedTechnicalFor(message);
    if (technicalAsked) {
      if (technicalAsked.error) {
        await say(message.conversationId, technicalAsked.error, replyTo, onlyForUserId);
        return;
      }

      try {
        // Một tin nhắn có hình, hoặc một dòng chữ khi mã không có dữ liệu để phân tích.
        const reply = await technical.report(technicalAsked.symbol);
        await say(message.conversationId, reply, replyTo, onlyForUserId);
      } catch (problem) {
        console.error(String(problem));
        await say(message.conversationId, SORRY.source, replyTo, onlyForUserId);
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
      if (asked.addressed) await say(message.conversationId, SORRY.nothing, replyTo, onlyForUserId);
      return;
    }

    let quotes;
    try {
      quotes = await market.quotes(candidates);
    } catch (problem) {
      console.error(String(problem));
      if (asked.addressed) await say(message.conversationId, SORRY.source, replyTo, onlyForUserId);
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
      if (asked.addressed) await say(message.conversationId, SORRY.nothing, replyTo, onlyForUserId);
      return;
    }

    const text = reply(quotes, listing, at());
    console.log(`${listing.join(' ')} -> ${found.size} mã`);

    if (asked.strict && asked.addressed && listing.length === 1 && found.has(listing[0])) {
      try {
        const chartAsked = askedChartFor(message);
        const period = chartAsked?.symbol === listing[0] ? chartAsked.period : undefined;
        const rich = await chart.rich(listing[0], quotes.find((quote) => quote.symbol === listing[0]), period);
        await say(message.conversationId, withRich(text, rich), replyTo, onlyForUserId);
        return;
      } catch (problem) {
        console.error(String(problem));
      }
    }

    await say(message.conversationId, text, replyTo, onlyForUserId);
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
    const content = typeof text === 'string' ? { text } : text;
    if (!content.image) return (await sayWithTerms(conversationId, content, replyToMessageId, onlyForUserId)).sent;

    const { image, ...words } = content;
    if (withTerms(words) === words) {
      // Không có thuật ngữ nào để bấm: hình và chữ vẫn là một tin, như trước.
      const whole = await send(conversationId, content, replyToMessageId, onlyForUserId);
      if (whole.sent) return whole.sent;
      return (await sayWithTerms(conversationId, withoutPicture(words), replyToMessageId, onlyForUserId)).sent;
    }

    // Có thuật ngữ: hình đi một tin riêng, không chữ, rồi chữ đi ngay sau thành tin chữ, thuật ngữ
    // bấm được. Web vẽ tin có hình bằng khung ảnh, và khung ấy không cho bấm vào chữ — chú thích
    // gắn trên đó được lưu mà không ai mở được. Hình không gửi được thì chữ vẫn đi, kèm một dòng
    // nói ra, và câu trả lời reply vào câu hỏi thay cho hình.
    const picture = await send(conversationId, { text: captionFor(image), image }, replyToMessageId, onlyForUserId);
    const rest = picture.sent ? words : withoutPicture(words);
    return (await sayWithTerms(conversationId, rest, picture.sent ? undefined : replyToMessageId, onlyForUserId)).sent;
  }

  /**
   * Gửi kèm chú thích thuật ngữ; máy chủ từ chối vì chú thích thì gửi lại không kèm.
   *
   * Chú thích là phần thêm. Widget chưa tải lên xong, một view bị đổi tên, kho widget chớp tắt —
   * không cái nào đáng để người hỏi không nhận được câu trả lời.
   */
  async function sayWithTerms(conversationId, content, replyToMessageId, onlyForUserId) {
    const marked = withTerms(content);
    const first = await send(conversationId, marked, replyToMessageId, onlyForUserId);
    if (first.sent || marked === content || !refusedForViews(first.problem)) return first;
    widgetTrouble = refusalCode(first.problem) ?? 'view_refused';
    return send(conversationId, content, replyToMessageId, onlyForUserId);
  }

  /**
   * Một dòng ngắn đi cùng hình, lấy từ tên file: `bsr-2026-09-15.svg` → `📈 BSR`,
   * `ptkt-vic-2026-09-14.svg` → `📈 PTKT VIC`, `gex-1n-2026-09-08.svg` → `📈 GEX 1n`.
   *
   * Tin hình không có chữ thì máy chủ vẫn lưu, nhưng web không vẽ được nó. Chú thích ngắn chứ
   * không phải dòng giá, vì chữ đầy đủ đi ngay tin sau.
   */
  function captionFor(image) {
    const words = String(image?.fileName ?? '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/-\d{4}-\d{2}-\d{2}$/, '')
      .split('-')
      .filter(Boolean)
      .map((word) => (/^[a-z]+$/i.test(word) ? word.toUpperCase() : word));
    return `📈 ${words.join(' ') || 'Biểu đồ'}`;
  }

  /**
   * Chữ của một câu trả lời mà hình không gửi được, kèm một dòng nói ra điều đó.
   *
   * Hình không gửi được thì vẫn gửi chữ: từ 15/09/2026 có lúc máy chủ trả `503` cho tin bot kèm
   * hình trong khi tin chữ vẫn đi, và một câu trả lời thiếu hình vẫn hơn im lặng.
   */
  function withoutPicture(words) {
    const note = '(Chưa gửi được hình lúc này.)';
    const text = `${words.text}\n${note}`;
    return Array.isArray(words.rich?.blocks)
      ? { ...words, text, rich: { ...words.rich, blocks: [...words.rich.blocks, { type: 'paragraph', text: note }] } }
      : { ...words, text };
  }

  async function send(conversationId, content, replyToMessageId, onlyForUserId) {
    let problem = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
        return { sent: posted, problem: null };
      } catch (caught) {
        problem = caught;
        if (!String(caught).includes('429') || attempt === 2) {
          console.error(String(caught));
          return { sent: null, problem };
        }
        await wait(1100 * (attempt + 1));
      }
    }
    return { sent: null, problem };
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
