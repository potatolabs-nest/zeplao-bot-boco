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

import { MAX_SYMBOLS, reply, sessionNote } from './market/quote.mjs';
import { publicFeed, withCache } from './market/vps.mjs';
import { dnse } from './market/dnse.mjs';
import { chain } from './market/chain.mjs';
import { looksLikeCode, makeGuard, tokensIn } from './market/symbols.mjs';
import { googleNews, newsMessage } from './market/news.mjs';
import { dailyHistory, intradayChart, parseChartPeriod, withRich } from './market/chart.mjs';
import { askedHeatmapFor, boardState, marketHeatmap } from './market/heatmap.mjs';
import { vndirectSectors } from './market/sectors.mjs';
import { technicalAnalysis } from './market/technical.mjs';
import { parseResultsPeriod, resultsRich } from './market/results.mjs';
import { vietcapResults } from './market/vietcap.mjs';
import {
  boardDetail, companyCard, companyCards, companyName, vietcapCompany, withCompany,
} from './market/company.mjs';
import { refusalCode, refusedForViews, withoutViews, withTerms } from './market/glossary.mjs';
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
/// Không phải gạch chéo, và đó là cả cách con bot này với tới mọi mã. Nền tảng chỉ giao `/xyz`
/// cho bot đã đăng ký đúng chữ ấy; chỗ đăng ký từng có 100 ô cho 1.522 mã nên đường gạch chéo
/// không bao giờ phủ hết được. Còn `!vic` thì chạy với **mọi mã** kể cả mã chưa đăng ký: chữ
/// chưa khai báo vẫn là một câu chữ thường mà bot nghe được, vì chủ bot đã tắt chế độ riêng tư.
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
 * khai báo trước. Lúc trần còn 100 ô cho 1.522 mã thì giá phải đi sau một chữ riêng — `!view vic`
 * thay cho `!vic` — và chữ riêng ấy giữ nguyên vì người ta đã quen gõ. Khai báo rồi thì `!lệnh` là
 * hỏi riêng — chỉ người gõ thấy câu trả lời — còn `/lệnh` là hỏi trước cả nhóm; máy chủ lo phần đó.
 *
 * Chữ cuối là tên của chính bot (`topbot`, `bocobot`…), không viết cứng: `!topbot` mở hướng dẫn.
 */
/// Trần khai báo lệnh của nền tảng, nâng lên 2.000 ngày 16/09/2026 để `/vic` phủ hết bảng chứ
/// không chỉ 95 mã đầu. Khai thừa cũng không hỏng: máy chủ chưa nâng thì giữ 100 lệnh đầu và kể
/// phần bỏ lại trong `details.ignored` — đúng những gì bot vẫn chạy được từ trước.
export const MOST_COMMANDS = 2000;

/// Khai báo lại sau chừng này: danh sách mã thanh khoản đổi theo thị trường, và một trần mới ở máy
/// chủ được dùng tới mà không phải đợi lần khởi động sau.
const COMMANDS_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Nhịp đẩy bảng nhiệt sống.
 *
 * Không phải một giây, và cái chặn không phải mắt người. Hai cái trần: cửa trước của nền tảng cho
 * 30 request mỗi giây tính chung mọi phương thức — mà một phiên là một phòng, nên bốn mươi phòng ở
 * nhịp một giây là bốn mươi request mỗi giây — và feed giá miễn phí phải trả lời 1.523 mã mỗi lần
 * hỏi. Ba giây cộng với bộ nhớ đệm năm giây của feed cho ra bảng mới chừng mỗi năm giây, đủ sống
 * với một bản đồ nhiệt và còn xa hai cái trần kia.
 */
const BOARD_TICK_MS = 3000;
/// Bao nhiêu nhịp liền không còn ai nhận gói thì đóng bảng. Hai mươi nhịp là chừng một phút — đủ
/// rộng cho người ta đóng rồi mở lại, đủ ngắn để không nuôi một bảng chẳng ai xem suốt phiên.
const BOARD_IDLE_TICKS = 20;
/// Một bảng vừa dựng còn dùng lại được trong chừng này. Cú bấm vào một ô mã cũng đi qua đường đẩy,
/// và bắt nó hỏi lại giá cả sàn để gửi đi một gói mà phần đổi chỉ là hồ sơ một công ty là gần một
/// giây chờ, hai lần cho mỗi cú bấm. Ngắn hơn hẳn một nhịp, nên bảng sống vẫn dựng mới mỗi nhịp.
const BOARD_FRESH_MS = 1200;
/// Hâm sẵn hồ sơ cho bao nhiêu ô to nhất, và cách nhau bao lâu — xem `warmProfiles`.
const WARM_MOST = 60;
const WARM_GAP_MS = 150;
const BOARD_TITLE = 'Bản đồ nhiệt VN';
/// Một dòng dưới chân bảng: người mở bảng lần đầu cần biết gõ gì tiếp, mà bảng thì không có chỗ
/// cho cả phần hướng dẫn.
const BOARD_HELP = 'Gõ /vic xem giá · !ptkt vic phân tích · !vboa bản đồ dạng ảnh';

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
  // Mỗi mã một lệnh, mã giao dịch nhiều tiền nhất trước, cho tới khi hết chỗ: `/vic` gửi cho cả
  // nhóm, `!vic` chỉ người gõ thấy. Mã ngoài danh sách vẫn đi bằng `/view` và `!view`.
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
 * Cả bảng niêm yết, mã giao dịch nhiều tiền nhất đứng trước.
 *
 * Thứ tự theo giá × khối lượng như bản đồ nhiệt, không viết tay: nó phải đổi theo thị trường chứ
 * không theo trí nhớ của ai. Nhưng **không loại mã nào**.
 *
 * Hồi bảng lệnh chỉ có 100 ô thì xếp hạng cũng chính là chọn lọc, và một mã không khớp lệnh hôm ấy
 * là một mã bị bỏ lại. Cái lọc ấy sống sót qua lần nâng trần và thành ra vô lý: 1.523 mã niêm yết
 * mà chỉ 876 mã gọi được bằng `/`, phần rơi ra gần hết là UPCoM ít giao dịch — đúng những mã mà
 * người ta cần bot tra hộ nhất, vì không ai nhớ giá của chúng. Trần giờ là 2.000, thừa chỗ cho cả
 * bảng, nên mã không có khối lượng xuống cuối hàng thay vì biến mất.
 */
export async function boardSymbols(market, count = MOST_COMMANDS) {
  const universe = (await market.universe())
    .map((symbol) => String(symbol ?? '').toUpperCase())
    .filter((symbol) => looksLikeCode(symbol));
  const quotes = await market.quotes(universe);

  const ranked = quotes
    .filter((quote) => quote && quote.price > 0 && quote.volume > 0 && looksLikeCode(quote.symbol))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .map((quote) => String(quote.symbol).toUpperCase());

  const seen = new Set(ranked);
  const quiet = universe.filter((symbol) => !seen.has(symbol)).sort();
  return [...ranked, ...quiet].slice(0, count);
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
  const heard = leading[0] === '/' && !message.command;
  if (!/^[!！]/.test(leading) && !heard) return text === message.text ? message : { ...message, text };

  // Dấu gạch chéo **nghe được** — một `/từ` không ai khai báo, tới đây vì bot đã tắt chế độ riêng
  // tư — cũng được đọc như dấu gọi. Máy chủ chỉ giao `/từ` cho bot đã khai đúng chữ ấy, và bảng
  // lệnh có giới hạn, nên có những mã không bao giờ tới được bằng đường lệnh. Nghe được thì trả
  // lời: người gõ `/vgc` đang hỏi giá VGC, không có cách đọc nào khác.
  //
  // Đổi lại phải im khi không tra được gì (`heard`): `/xyz` trong phòng có thể là lệnh của con bot
  // bên cạnh, và một câu "không có dữ liệu" chen vào đó là bot này nói leo. Một dòng máy chủ **có**
  // phân tích thành lệnh thì không phải nghe lỏm, và giữ nguyên đường cũ.
  let body = leading.slice(1).normalize('NFKC');
  const named = /^([A-Za-z0-9_]{1,32})@([A-Za-z0-9._-]+)(.*)$/s.exec(body);
  if (named) {
    if (named[2].toLowerCase() !== String(me?.username ?? '').toLowerCase()) return null;
    body = `${named[1]}${named[3]}`;
  }
  return priced({ ...message, text: `${CALL}${body}`, ...(heard ? { heard: true } : {}) });
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
      // Nghe lỏm được thì trả lời cái tra được và im phần còn lại — xem `canonicalMessage`.
      quiet: Boolean(message.heard),
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
  sectors = vndirectSectors(),
  heatmap = marketHeatmap({ at, sectors }),
  board = { tickMs: BOARD_TICK_MS },
  technical = technicalAnalysis(),
  results = vietcapResults(),
  company = vietcapCompany(),
  history = dailyHistory(),
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

  // Khai báo đúng `commandsFor(me)`, thay nguyên si danh sách cũ. Lần đầu chỉ các lệnh chính, để
  // bot nghe được ngay; các mã vào ngay sau khi xếp hạng xong, và lại vào mỗi vài tiếng sau đó.
  // Khai báo lệnh là việc vô hình: nó xảy ra lúc khởi động, và người dùng chỉ thấy hậu quả — `/vgc`
  // im lặng — chứ không thấy nguyên nhân. Nên kết quả lần khai gần nhất được giữ lại và hiện ở cuối
  // hướng dẫn, đúng như mã lỗi widget: không đọc được log của pod thì đó là chỗ duy nhất nhìn thấy.
  let commandsNote = 'Chưa khai báo xong danh sách mã';
  const declare = async (symbols) => {
    const commands = commandsFor(me, symbols);
    try {
      const answer = await call('setCommands', { commands });
      const kept = answer?.commands?.length ?? commands.length;
      const ignored = answer?.details?.ignored?.length ?? 0;
      const symbols = Math.max(0, kept - commandsFor(me, []).length);
      commandsNote = `Gọi thẳng được ${symbols} mã bằng /mã${ignored ? `, máy chủ bỏ ${ignored} lệnh` : ''}`;

      // Rồi đọc lại danh sách từ máy chủ, chứ không tin câu trả lời của chính lệnh ghi.
      //
      // Hai thứ ấy khác nhau, và chỗ khác nhau là chỗ đang hỏng: máy chủ nhận đủ 882 lệnh, báo
      // không bỏ lệnh nào, mà `/vgc` vẫn không tới bot trong khi `/vcg` — cách đó 33 lệnh trong
      // cùng một lần khai — thì tới. Đọc lại là cách duy nhất phân biệt "máy chủ không lưu" với
      // "máy chủ lưu rồi nhưng không giao", và hai cái đó cần hai người khác nhau đi sửa.
      const stored = await call('getMe')
        .then((mine) => (Array.isArray(mine?.commands) ? mine.commands.map((one) => one.command) : null))
        .catch(() => null);
      if (stored) {
        const held = new Set(stored);
        const lost = commands.map((one) => one.command).filter((name) => !held.has(name));
        console.log(`máy chủ giữ ${stored.length} lệnh, thiếu ${lost.length}`);
        if (lost.length) {
          commandsNote = `Khai ${commands.length} lệnh, máy chủ chỉ giữ ${stored.length} — mất ${lost.length}, từ "${lost[0]}"`;
        }
      }
      console.log(`khai báo ${commands.length} lệnh, máy chủ giữ ${kept}${ignored ? `, bỏ ${ignored}` : ''}`);
    } catch (problem) {
      commandsNote = `Chưa khai báo được lệnh: ${String(problem).slice(0, 160)}`;
      console.error(String(problem));
    }
  };
  // **Không** khai báo lệnh chính ngay ở đây, dù rất muốn.
  //
  // `setCommands` thay nguyên si danh sách cũ. Khai trước một danh sách chưa có mã nào là tự tay
  // xoá sạch mã khỏi bảng lệnh, rồi vài giây sau mới khai lại — mỗi lần khởi động là một quãng
  // `/vgc` im lặng, và một lần xếp hạng hỏng là im tới lần sau. Danh sách lần trước vẫn nằm trên
  // máy chủ và vẫn phục vụ đúng trong lúc bot đi lấy giá cả sàn để xếp hạng, nên để yên nó.

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
  const rank = () => boardSymbols(market)
    .then((symbols) => declare(symbols))
    .catch((problem) => {
      commandsNote = `Chưa xếp hạng được mã: ${String(problem).slice(0, 160)}`;
      console.error(`không xếp hạng được mã để khai báo lệnh: ${problem}`);
    });
  rank();

  // Và xếp lại mỗi vài tiếng, không phải chỉ lúc khởi động: một tiến trình chạy hàng tháng mà chỉ
  // khai báo một lần là một danh sách mã của tháng trước.
  const again = setInterval(rank, COMMANDS_REFRESH_MS);
  again.unref?.();
  signal?.addEventListener?.('abort', () => clearInterval(again));

  // ---- bảng nhiệt sống ------------------------------------------------------------------------
  //
  // `@topbot` mở một **phiên**: trang HTML trong gói widget, bot đẩy số vào bằng `pushState`. Một
  // lần đẩy tới hết mọi người đang mở bảng của phòng ấy, nên trăm người xem vẫn là một lần bot
  // tính và một request. Trang widget không tự lấy được gì — nền tảng chặn bằng header
  // `connect-src 'none'`, sandbox không cho cùng nguồn — nên đẩy là đường duy nhất.
  //
  // Mỗi lần đẩy là **cả bảng**, không phải phần vừa đổi: máy chủ chỉ nhớ gói cuối cùng, ghi đè chứ
  // không gộp, và người mở muộn được đưa đúng gói ấy. Đẩy phần vừa đổi thì họ nhận một nhúm ô rời
  // và không có bảng nào cả — lỗi này không lộ ra khi tự thử, vì máy mình luôn có gói đầu tiên.
  const boards = new Map();   // phòng -> { sessionId, sent }
  let pushing = null;
  let settled = false;
  let boardTrouble = null;
  /// Mã -> thẻ hồ sơ đã lấy được (hoặc `null` khi nguồn nói không có). Chung cho mọi phòng: hồ sơ
  /// công ty là thứ ai xem cũng như nhau, và hỏi lại nguồn cho từng phòng là nện vào một feed miễn phí.
  const profiles = new Map();
  /// Mã đang trên đường hỏi nguồn — khác hẳn mã đã hỏi xong và nguồn bảo không có.
  const asking = new Set();
  /// Mã -> mười phiên gần nhất. Nguồn tự nhớ mười phút; chỗ này nhớ để gói đẩy khỏi phải `await`.
  const days = new Map();
  /// Mã -> bài phân tích kỹ thuật dạng dữ liệu, và mã đang trên đường phân tích.
  const studies = new Map();
  const studying = new Set();
  /// Bài phân tích cũ đi theo phiên, không theo phút. Hỏi lại sau chừng này thì đủ mới.
  const STUDY_TTL_MS = 10 * 60 * 1000;
  /// Nhiều nhất bao nhiêu mã được mang theo trong gói của một phòng.
  const MOST_DETAILS = 6;
  /// Và nhớ chỗ ngồi của nhiều nhất bao nhiêu người xem mỗi phòng.
  const MOST_SEATS = 12;

  // Phiên của lần chạy trước là phiên mồ côi: pod khởi động lại thì bảng vẫn nằm trên màn hình
  // người ta và đứng im mãi, vì không còn ai đẩy nữa. Dọn trước khi mở cái mới.
  await call('endSessions', {}).catch((problem) => console.error(`không dọn được phiên cũ: ${problem}`));

  async function openBoard(conversationId, userId) {
    let live = boards.get(conversationId);
    if (!live) {
      // `userIds` rỗng: ở đây ai cũng là người xem. Được kể tên là thành "người chơi", và client sẽ
      // hỏi "đóng bảng là bỏ cuộc?" — vô nghĩa với một bảng giá — lại chỉ nhận tối đa tám người.
      const made = await call('createSession', { conversationId, title: BOARD_TITLE, userIds: [] });
      const sessionId = made?.sessionId ?? made?.id ?? made?.session?.id;
      if (!sessionId) throw new Error(`createSession không trả sessionId: ${JSON.stringify(made).slice(0, 160)}`);
      live = { sessionId, sent: null };
      boards.set(conversationId, live);
      settled = false;
      await pushBoards();   // có số sẵn trước khi người ta kịp nhìn vào
    }
    await call('showSession', { sessionId: live.sessionId, ...(userId ? { to: userId } : {}) });
    // Và đánh dấu phòng này cần một gói nữa: gói vừa đẩy ở trên đi trước lúc trang tồn tại. Tiếng
    // chào của trang cũng làm việc này, nhưng tiếng chào có thể rơi, còn nhịp đẩy thì luôn tới.
    live.pushed = null;
    startPushing();
  }

  /// Cửa sổ dùng lại thật sự: không bao giờ chạm tới một nhịp đẩy, dù nhịp có ngắn đến đâu — bài
  /// test chạy nhịp 40ms, và ở đó dùng lại là bảng không bao giờ đổi.
  const freshMs = Math.min(BOARD_FRESH_MS, Math.max(0, board.tickMs - 500));

  /**
   * Một lượt đẩy tại một thời điểm, và nhiều nhất một lượt đang xếp hàng.
   *
   * Không có khoá này thì nhịp ba giây cứ đến giờ là nổ, kể cả khi lượt trước còn đang hỏi giá cả
   * 1.523 mã. Mạng chậm một chút là các lượt chất đống: cùng hỏi feed, cùng gọi `pushState`, và gói
   * mang thứ người ta vừa bấm phải xếp hàng sau một đống gói chẳng ai đợi. Nhìn từ ngoài thì đó
   * đúng là "bấm cái gì cũng lâu", mà nhìn vào từng mảnh thì mảnh nào cũng nhanh.
   */
  let sending = null;
  let sendAgain = false;

  async function pushBoards(options = {}) {
    if (sending) {
      sendAgain = true;
      return sending;
    }
    sending = (async () => {
      try {
        // Gộp những lời gọi tới trong lúc đang đẩy thành đúng một lượt nữa, và không hơn hai lượt:
        // lượt thứ hai đã mang theo mọi thứ vừa tới, còn vòng thứ ba chỉ là tự nói chuyện với mình.
        for (let pass = 0; pass < 2; pass += 1) {
          sendAgain = false;
          await sendBoards(options);
          if (!sendAgain) return;
        }
      } finally {
        sending = null;
        sendAgain = false;
      }
    })();
    return sending;
  }

  async function sendBoards({ stale = false } = {}) {
    if (!boards.size) {
      clearInterval(pushing);
      pushing = null;
      return;
    }

    // Ngoài giờ khớp lệnh thì đẩy đúng một lần rồi thôi: bảng giữ số của phiên gần nhất, và không
    // ai phải hỏi feed 1.523 mã mỗi ba giây suốt đêm để nhận lại y nguyên con số cũ.
    //
    // Trừ khi có phòng đang chờ gói mới — ai đó vừa mở trang chi tiết một mã. Người bấm lúc 9 giờ
    // tối vẫn phải thấy trang ấy mở ra, dù bảng phía sau đứng im từ ba giờ chiều.
    const note = sessionNote(at());
    const waiting = [...boards.values()].some((live) => live.pushed === null);
    if (note && settled && !waiting) return;

    const built = await buildBoard(stale);
    if (!built) return;
    const { base, onBoard, bySymbol, named } = built;
    const names = namesOn(base);

    for (const [conversationId, live] of boards) {
      // Bảng mà phòng này đang thấy — cái sàng cho những gì trang gửi về sau đó.
      live.board = onBoard;
      const details = detailsFor(live, onBoard, bySymbol, named);
      const state = {
        ...base,
        ...(details ? { d: details } : {}),
        // Ai đang xem gì. Trang tìm đúng dòng của mình trong này lúc nạp, rồi dựng lại chỗ cũ.
        ...(live.seats?.size ? { seats: Object.fromEntries(live.seats) } : {}),
        ...(live.got ? { got: live.got } : {}),
        // Tên công ty của những mã đã hâm sẵn, gửi kèm luôn. Thẻ bật ra khi bấm mã gạch chân trong
        // tin nhắn hiện tức thì vì số liệu **đi sẵn trong tin**; bắt trang widget đi một vòng hỏi
        // đáp chỉ để lấy một cái tên đã nằm trong bộ nhớ bot là tự làm mình chậm hơn.
        ...(names ? { n: names } : {}),
      };
      const json = JSON.stringify(state);
      if (live.pushed === json) continue;
      try {
        // Câu trả lời kể số người thật sự nhận được gói này. Không có tin báo "đã đóng bảng" nào
        // cho bot, nên đây là cách duy nhất biết phòng ấy còn ai xem — và một bảng không còn ai
        // xem mà vẫn đẩy là hỏi feed và tiêu request cho một màn hình đã tắt.
        const answer = await call('pushState', { sessionId: live.sessionId, state });
        live.pushed = json;
        live.idle = Number(answer?.sent) > 0 ? 0 : (live.idle ?? 0) + 1;
        if (live.idle >= BOARD_IDLE_TICKS) {
          boards.delete(conversationId);
          await call('endSession', { sessionId: live.sessionId }).catch(() => {});
          console.log(`đóng bảng: không còn ai xem (${conversationId})`);
        }
      } catch (problem) {
        console.error(`không đẩy được bảng: ${problem}`);
        if (String(problem).includes('session_not_found')) boards.delete(conversationId);
      }
    }
    settled = Boolean(note);

    // Hâm hồ sơ ở nền, không đợi: bảng đã đi rồi, phần này chỉ để cú bấm sắp tới khỏi phải chờ mạng.
    warmProfiles(base).catch((problem) => console.error(`không hâm được hồ sơ: ${problem}`));
  }

  /**
   * Bảng vừa dựng gần nhất, và dựng lại khi nó đã quá một nhịp.
   *
   * Một cú bấm vào ô mã cũng đi qua đây để đẩy lại — mà dựng bảng là hỏi giá cả 1.523 mã rồi chia
   * ô cho hai trăm sáu mươi cái: gần một giây, cho một gói mà phần đổi chỉ là hồ sơ một công ty.
   * Giá cũ nhiều nhất bằng đúng một nhịp đẩy, tức bằng thứ người xem vẫn đang nhìn.
   */
  let drawn = null;   // { base, onBoard, bySymbol, named, at }

  async function buildBoard(stale = false) {
    // `stale`: gói đi vì có người vừa bấm, không phải vì tới nhịp. Người ấy đang nhìn đúng cái bảng
    // này trên màn hình, nên gửi lại chính nó kèm phần chi tiết là đủ — bắt họ đợi một lượt hỏi giá
    // cả 1.523 mã để nhận về đúng những con số đang hiện ra là nửa giây chờ không đổi lấy gì.
    if (stale && drawn) return drawn;
    // Cửa sổ dùng lại ngắn hơn hẳn một nhịp đẩy, và tính từ lúc **bắt đầu** dựng: nếu nó dài bằng
    // nhịp thì mỗi nhịp lại rơi đúng vào lúc gói trước còn "mới", và bảng đứng hình.
    if (drawn && Date.now() - drawn.at < freshMs) return drawn;

    const startedAt = Date.now();
    const universe = await market.universe();
    const [quotes, named] = await Promise.all([market.quotes(universe), sectors.map()]);
    const base = boardState(quotes, { sectors: named, at: at(), help: BOARD_HELP });
    if (!base) return null;

    drawn = {
      base,
      // Mã nào đang có mặt trên bảng — thứ duy nhất trang được phép xin trang chi tiết. Trang là
      // file ai cũng sửa được, nên `open` gửi về là chữ người lạ gõ vào: nó chỉ mở được thứ đang bày.
      onBoard: new Set(base.c.map(([symbol]) => symbol)),
      bySymbol: new Map(quotes.filter(Boolean).map((quote) => [quote.symbol, quote])),
      named,
      at: startedAt,
    };
    return drawn;
  }

  /**
   * Phần chi tiết gắn thêm cho riêng một phòng: mã nào người trong phòng ấy đang mở.
   *
   * Gắn theo phòng chứ không gắn chung: gói đẩy đi là gói mọi người trong phòng cùng nhận, nên một
   * phòng không có lý do gì phải tải hồ sơ của mã mà phòng bên kia đang xem. `null` khi không ai mở
   * gì — lúc ấy gói giữ nguyên hình dạng cũ và cái so sánh "gói này y hệt gói vừa đẩy" vẫn đúng.
   */
  function detailsFor(live, onBoard, bySymbol, named) {
    const wanted = [...(live.wanted ?? [])].filter((symbol) => onBoard.has(symbol));
    if (!wanted.length) return null;

    return Object.fromEntries(wanted.map((symbol) => [symbol, boardDetail({
      symbol,
      card: profiles.get(symbol) ?? null,
      pending: asking.has(symbol),
      quote: bySymbol.get(symbol) ?? null,
      sector: named.get(symbol) ?? '',
      history: days.get(symbol) ?? [],
      study: studies.get(symbol)?.card ?? null,
      studying: studying.has(symbol),
    })]));
  }

  /// Tên công ty của các mã trên bảng đã có hồ sơ trong bộ nhớ. `null` khi chưa có mã nào — để gói
  /// giữ nguyên hình dạng cũ và phép so "gói này y hệt gói vừa đẩy" vẫn đúng.
  function namesOn(base) {
    const found = {};
    for (const [symbol] of base.c) {
      const name = companyName(profiles.get(symbol), symbol);
      if (name) found[symbol] = name;
    }
    return Object.keys(found).length ? found : null;
  }

  /**
   * Hâm sẵn hồ sơ cho những mã to nhất trên bảng — từng mã một, thong thả.
   *
   * Đo ra thì Vietcap trả lời một mã trong chừng 50ms khi hỏi lần lượt, nhưng **sáu mã hỏi cùng
   * lúc mất 3,7 giây**: nguồn này thắt cổ chai đúng vào lúc bị gọi song song. Nên hâm tuần tự, cách
   * nhau một quãng — và khi người ta bấm vào một ô thì cái tên công ty đã nằm sẵn trong bộ nhớ,
   * không phải đợi một lượt mạng nào nữa.
   *
   * Chỉ những ô to: ô bé thì vừa khó bấm trúng vừa hiếm ai buồn mở, và mỗi mã hâm thừa là một
   * request vào một feed miễn phí để đổi lấy không gì cả.
   */
  let warming = false;

  async function warmProfiles(base) {
    if (warming) return;
    warming = true;
    try {
      const biggest = [...base.c].sort((a, b) => (b[8] ?? 0) - (a[8] ?? 0)).slice(0, WARM_MOST);
      for (const [symbol] of biggest) {
        if (signal?.aborted) return;
        if (profiles.has(symbol) || asking.has(symbol)) continue;
        asking.add(symbol);
        try {
          profiles.set(symbol, companyCard(await company.profile(symbol)));
        } catch (problem) {
          console.error(`không hâm được hồ sơ ${symbol}: ${problem}`);
        } finally {
          asking.delete(symbol);
        }
        // Nghỉ giữa hai mã, và chỉ nghỉ khi vừa thật sự gọi mạng: một vòng toàn mã đã nhớ thì chạy
        // hết trong một nhịp mắt.
        await wait(WARM_GAP_MS);
      }
    } finally {
      warming = false;
    }
  }

  /// Cái sàng cho mọi mã trang gửi về: đúng hình dạng một mã, và đang có mặt trên bảng của phòng ấy.
  /// Trang là file ai cũng sửa được, nên không lớp nào ở đây tin vào nó.
  function onBoardSymbol(live, symbol) {
    if (!/^[A-Z0-9]{3,10}$/.test(symbol)) return false;
    // Hoặc đang được phòng này mở sẵn: một mã tụt khỏi hai trăm sáu mươi ô to nhất trong lúc người
    // ta đang đọc trang của nó thì mọi cú bấm tiếp theo sẽ rơi vào im lặng — và im lặng là thứ
    // không ai gỡ ra được, vì trang cứ đợi mãi mà chẳng có gì báo là nó đang đợi vô ích.
    return !live.board || live.board.has(symbol) || Boolean(live.wanted?.has(symbol));
  }

  /**
   * Tính bài phân tích kỹ thuật cho một mã, một lần, rồi nhớ mười phút.
   *
   * Không đợi: hàm trả về ngay, và khi bài xong thì nó tự đẩy một gói nữa. Người gọi chỉ việc đẩy
   * cái gói của mình đi trước.
   */
  function studyFor(live, symbol) {
    const held = studies.get(symbol);
    if ((held && Date.now() - held.at <= STUDY_TTL_MS) || studying.has(symbol)) return;

    studying.add(symbol);
    const began = Date.now();
    technical.card(symbol)
      // Bao lâu thì xong — con số này hiện trên chính tab ấy. Nếu nó ghi 250ms mà người xem đợi năm
      // giây thì chỗ chậm nằm trên đường đi, không nằm trong phép tính, và hai chỗ ấy sửa ở hai nơi
      // hoàn toàn khác nhau.
      .then((card) => studies.set(symbol, { card: { ...card, ms: Date.now() - began }, at: Date.now() }))
      .catch((problem) => console.error(`không phân tích được ${symbol}: ${problem}`))
      .then(() => {
        studying.delete(symbol);
        live.pushed = null;
        return pushBoards({ stale: true });
      })
      .catch((problem) => console.error(`không đẩy được bảng: ${problem}`));
  }

  /// Ghi mã vào danh sách phòng ấy đang mở. Mở lại một mã đang mở thì đưa nó xuống cuối hàng, để
  /// cái bị đẩy ra khi quá chỗ luôn là cái cũ nhất.
  function want(live, symbol) {
    live.wanted = live.wanted ?? new Set();
    live.wanted.delete(symbol);
    live.wanted.add(symbol);
    while (live.wanted.size > MOST_DETAILS) live.wanted.delete(live.wanted.values().next().value);
  }

  /**
   * Có người bấm vào một ô trong bảng: mở trang chi tiết của mã ấy.
   *
   * Doc nói thẳng ra rằng trang widget là file ai cũng sửa được, nên `action` gửi về phải kiểm như
   * kiểm chữ người lạ gõ vào. Ở đây là ba lớp: đúng hình dạng một mã, đang có mặt trên bảng của
   * chính phòng ấy, và nhiều nhất sáu mã một phòng — không lớp nào tin vào trang cả.
   */
  async function onBoardAction(action) {
    const live = boards.get(action?.conversationId);
    if (!live) return;
    // Đếm mọi thứ trang gửi tới, và đếm ngay đầu cửa. Con số này đi kèm gói và hiện ở góc bảng:
    // nó trả lời được câu hỏi mà từ máy tôi không cách nào nhìn thấy — cú bấm có tới bot không, hay
    // rơi đâu đó giữa đường. Bấm mà số không nhúc nhích là chuyện của nền tảng, không phải của bot.
    live.got = (live.got ?? 0) + 1;

    // Trang báo người này đang xem gì: cả bảng, một ngành, hay trang chi tiết một mã kèm tab nào.
    //
    // Nhớ hộ, vì **trang không tự nhớ được**: widget chạy trong iframe `sandbox="allow-scripts"`
    // không có `allow-same-origin`, tức origin mờ, và ở đó chạm vào `localStorage` là ném lỗi. Nên
    // chuyển sang phòng chat khác rồi quay lại là trang nạp mới tinh và về bảng mặc định — trừ khi
    // có ai đó nhớ hộ, và chỉ bot mới nhớ được.
    const seat = action?.action?.seat;
    if (Array.isArray(seat)) {
      const who = action?.from?.userId;
      if (!who) return;
      const [zoomed, opened, tab] = seat;
      const mine = [
        typeof zoomed === 'string' ? zoomed.slice(0, 40) : null,
        typeof opened === 'string' && onBoardSymbol(live, opened.toUpperCase()) ? opened.toUpperCase() : null,
        tab === 'ptkt' ? 'ptkt' : 'all',
      ];
      live.seats = live.seats ?? new Map();
      live.seats.delete(who);
      live.seats.set(who, mine);
      while (live.seats.size > MOST_SEATS) live.seats.delete(live.seats.keys().next().value);
      // Mã đang mở thì giữ luôn hồ sơ của nó trong gói: lúc người ta quay lại, trang dựng lại chỗ
      // cũ mà số liệu đã nằm sẵn trong gói đầu tiên, không phải đợi thêm một vòng hỏi đáp nữa.
      if (mine[1]) want(live, mine[1]);
      return;
    }

    // Trang vừa mở ra và chào một tiếng. Đẩy lại ngay cho nó.
    //
    // Đây không phải chuyện lịch sự mà là đường sống của bảng: ngoài giờ khớp lệnh bot đẩy đúng một
    // lần rồi nghỉ, mà lần ấy xảy ra **trước** `showSession` — tức trước khi trang kịp tồn tại. Không
    // có tiếng chào này thì người mở bảng lúc bảy giờ tối ngồi nhìn "Đang mở…" tới sáng.
    if (action?.action?.hello) {
      live.pushed = null;
      await pushBoards({ stale: true });
      return;
    }

    // Đóng trang chi tiết: bỏ mã khỏi gói của phòng. Không cần đẩy ngay — trang đã về bản đồ rồi,
    // và gói tới sẽ nhẹ đi một hồ sơ.
    const closing = String(action?.action?.shut ?? '').toUpperCase();
    if (closing) { live.wanted?.delete(closing); return; }

    // Mở tab phân tích kỹ thuật. Thường thì bài đã nằm sẵn trong bộ nhớ — nó được tính ngay từ lúc
    // trang chi tiết mở ra, xem dưới — nên cú bấm này chỉ còn là một lần đẩy.
    const studied = String(action?.action?.ptkt ?? '').toUpperCase();
    if (studied) {
      if (!onBoardSymbol(live, studied)) return;
      want(live, studied);
      studyFor(live, studied);
      // Đẩy ngay một gói nữa để trang biết là "đang phân tích", chứ không đứng im nhìn chữ cũ.
      live.pushed = null;
      await pushBoards({ stale: true });
      return;
    }

    const symbol = String(action?.action?.open ?? '').toUpperCase();
    if (!onBoardSymbol(live, symbol)) return;
    want(live, symbol);

    // Phân tích kỹ thuật ngay từ lúc mở trang, không đợi tới lúc bấm sang tab ấy.
    //
    // Bốn lượt gọi nguồn nến, chừng một phần tư giây — trả trước cái giá ấy thì lúc người ta bấm
    // sang tab, bài đã nằm sẵn trong gói và tab mở ra tức thì. Đợi cú bấm rồi mới tính là bắt họ
    // chịu cả một vòng hỏi đáp qua nền tảng **cộng** với quãng tính, cho một thứ mà chín trên mười
    // người mở trang chi tiết sẽ muốn xem.
    studyFor(live, symbol);

    // Hồ sơ hỏi một lần rồi nhớ. `null` cũng là một câu trả lời — "nguồn không có mã này" — và nó
    // được nhớ y như một hồ sơ thật, nếu không thì mỗi lần ai bấm vào mã ấy lại là một lần gọi mạng.
    //
    // "Đang hỏi" phải là một trạng thái riêng, không phải một chỗ trống: trang biết phân biệt "chờ
    // chút" với "mã này không có hồ sơ", và hai câu ấy nói hai chuyện khác hẳn nhau.
    // Hồ sơ và mười phiên là hai nguồn khác nhau, và mỗi cái về tới đâu thì đẩy tới đó — chờ cả
    // hai rồi mới đẩy là bắt cái tên công ty đợi một bảng lịch sử mà nó chẳng liên quan gì.
    if (!profiles.has(symbol) && !asking.has(symbol)) {
      asking.add(symbol);
      company.profile(symbol)
        .then((profile) => profiles.set(symbol, companyCard(profile)))
        .catch((problem) => console.error(`không lấy được hồ sơ ${symbol}: ${problem}`))
        .then(() => {
          asking.delete(symbol);
          live.pushed = null;
          return pushBoards({ stale: true });
        })
        .catch((problem) => console.error(`không đẩy được bảng: ${problem}`));
    }

    if (!days.has(symbol)) {
      history.rows(symbol)
        .then((rows) => days.set(symbol, rows))
        .catch((problem) => console.error(`không lấy được mười phiên ${symbol}: ${problem}`))
        .then(() => {
          live.pushed = null;
          return pushBoards({ stale: true });
        })
        .catch((problem) => console.error(`không đẩy được bảng: ${problem}`));
    }

    // Đẩy ngay chứ không đợi nhịp sau: trang đã vẽ khung trang chi tiết bằng thứ nó có sẵn, và phần
    // còn trống chỉ đầy lên khi gói tới. Ba giây nhìn một trang nửa vời là ba giây quá dài.
    live.pushed = null;
    await pushBoards({ stale: true });
  }

  function startPushing() {
    if (pushing || !boards.size) return;
    pushing = setInterval(
      () => pushBoards().catch((problem) => console.error(`không đẩy được bảng: ${problem}`)),
      board.tickMs,
    );
    pushing.unref?.();
    signal?.addEventListener?.('abort', () => clearInterval(pushing));
  }

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
        // Bấm vào một ô trong bảng nhiệt sống. Loại update lạ thì bỏ qua — doc dặn thế, vì sẽ có
        // thêm loại mới, và một bot ném lỗi vì gặp loại nó chưa biết là một bot dừng ở đó.
        else if (update.kind === 'widget_action') await onBoardAction(update.widgetAction);
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
      // Gọi tên trống là mở bảng nhiệt sống; hỏi thẳng chữ `help` thì vẫn nhận phần hướng dẫn.
      //
      // Hai câu hỏi khác nhau: "cho tôi xem thị trường" và "bot này gõ được gì". Bảng có một dòng
      // hướng dẫn dưới chân, nhưng ai gõ `help` là đang muốn đọc cả danh sách lệnh, và mở ra một
      // bảng màu thay cho câu trả lời ấy là không trả lời.
      //
      // Phiên không mở được — máy cũ, lỗi mạng, gói widget chưa lên — thì rơi xuống hướng dẫn: đường
      // cũ vẫn ở đó, và người hỏi vẫn nhận được câu trả lời thay vì im lặng.
      // Chữ `help` có thể đứng sau dấu gọi — `!help`, `!help@bot` — nên nhận cả dấu ở trước.
      const wantsList = /(^|[\s!/@])help(\s|$)/i.test(String(message.text ?? ''));
      if (!wantsList) {
        try {
          await openBoard(message.conversationId, senderOf(message));
          return;
        } catch (problem) {
          // Mã lỗi đi kèm hướng dẫn, không chỉ nằm trong log: người gõ `@topbot` mà không thấy
          // bảng đang nhìn vào một câu trả lời không giải thích gì, còn log thì ở trong pod.
          boardTrouble = refusalCode(problem) ?? String(problem).slice(0, 80);
          console.error(`không mở được bảng: ${problem}`);
        }
      }
    }
    if (helpAsked) {
      const help = [
        HELP,
        widgetTrouble ? `(Chú thích thuật ngữ chưa bật được: ${widgetTrouble})` : null,
        boardTrouble ? `(Chưa mở được bảng nhiệt: ${boardTrouble})` : null,
        `(${commandsNote})`,
      ].filter(Boolean).join('\n\n');
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
        const shown = resultsRich(report ?? { symbol: resultsAsked.symbol, period: resultsAsked.period });
        const cards = await companyCards(company, [resultsAsked.symbol]);
        await say(
          message.conversationId,
          withCompany(typeof shown === 'string' ? { text: shown } : shown, cards),
          replyTo,
          onlyForUserId,
        );
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
        const cards = await companyCards(company, [technicalAsked.symbol]);
        await say(
          message.conversationId,
          withCompany(typeof reply === 'string' ? { text: reply } : reply, cards),
          replyTo,
          onlyForUserId,
        );
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
      if (asked.addressed && !asked.quiet) await say(message.conversationId, SORRY.source, replyTo, onlyForUserId);
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
    const listing = asked.strict && asked.addressed && !asked.quiet
      ? candidates
      : candidates.filter((symbol) => found.has(symbol));

    if (!listing.length) {
      if (asked.addressed && !asked.quiet) await say(message.conversationId, SORRY.nothing, replyTo, onlyForUserId);
      return;
    }

    const text = reply(quotes, listing, at());
    console.log(`${listing.join(' ')} -> ${found.size} mã`);

    // Bấm vào mã là mở hồ sơ doanh nghiệp — tên đầy đủ, sàn, ngành, vốn hoá. Chỉ những mã tra được
    // giá: dòng của một mã không có dữ liệu là một lời xin lỗi, không phải chỗ để mở hồ sơ ra.
    const cards = await companyCards(company, listing.filter((symbol) => found.has(symbol)));
    const said = withCompany({ text }, cards);

    if (asked.strict && asked.addressed && listing.length === 1 && found.has(listing[0])) {
      try {
        const chartAsked = askedChartFor(message);
        const period = chartAsked?.symbol === listing[0] ? chartAsked.period : undefined;
        const rich = await chart.rich(listing[0], quotes.find((quote) => quote.symbol === listing[0]), period);
        await say(message.conversationId, withRich(said, rich), replyTo, onlyForUserId);
        return;
      } catch (problem) {
        console.error(String(problem));
      }
    }

    await say(message.conversationId, said, replyTo, onlyForUserId);
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

    // Chữ đi kèm hình phải đi dưới dạng rich, không phải `entities` gắn thẳng trên tin.
    //
    // Client vẽ tin có ảnh bằng markup của nó; `entities` để ngoài markup thì không tới được bộ
    // đọc, và chú thích được lưu mà không ai bấm được. `!ptkt` bấm được suốt vì nó vốn gửi rich,
    // còn dòng giá thì không — đó là cả khác biệt, và là lỗi ở đây chứ không phải ở nền tảng.
    const shaped = content.rich ? content : asRich(content);

    // Hình và chữ đi cùng một tin, chú thích gắn ngay trên chữ ấy.
    //
    // Từ 16/09/2026 cả web lẫn ứng dụng vẽ chữ của tin có ảnh bằng đúng bộ đọc của tin chữ, nên
    // bấm được ngay trên đó. Trước ngày ấy chữ trong khung ảnh là chữ chết, và bot phải xé câu trả
    // lời thành hai tin — một tin ảnh, một tin chữ — chỉ để người đọc còn bấm được vào KL hay MA200.
    //
    // Ai đọc bằng ứng dụng bản cũ hơn thì dòng giá của họ là chữ thường, không bấm được. Không
    // tránh được: một tin nhắn được vẽ bằng phiên bản của người mở nó, và lúc gửi thì chưa có
    // người đọc nào để mà hỏi.
    const whole = await sayWithTerms(conversationId, shaped, replyToMessageId, onlyForUserId);
    if (whole.sent) return whole.sent;

    // Máy chủ không nhận hình thì chữ vẫn đi, kèm một dòng nói ra điều đó.
    const { image, ...words } = shaped;
    return (await sayWithTerms(conversationId, withoutPicture(words), replyToMessageId, onlyForUserId)).sent;
  }

  /// Chữ trơn thành một khối rich, mang theo chú thích đã gắn sẵn. Tin không có ảnh thì không cần:
  /// ở đó `entities` đi thẳng vào bộ đọc như thường.
  function asRich(content) {
    const { entities, ...rest } = content;
    return {
      ...rest,
      rich: {
        blocks: [{ type: 'paragraph', text: content.text, ...(entities?.length ? { entities } : {}) }],
      },
    };
  }

  /**
   * Gửi kèm chú thích thuật ngữ; máy chủ từ chối vì chú thích thì gửi lại không kèm.
   *
   * Chú thích là phần thêm. Widget chưa tải lên xong, một view bị đổi tên, kho widget chớp tắt —
   * không cái nào đáng để người hỏi không nhận được câu trả lời.
   */
  async function sayWithTerms(conversationId, content, replyToMessageId, onlyForUserId) {
    const marked = withTerms(content);
    const bare = withoutViews(content);
    const first = await send(conversationId, marked, replyToMessageId, onlyForUserId);
    if (first.sent || (marked === content && bare === content) || !refusedForViews(first.problem)) return first;
    widgetTrouble = refusalCode(first.problem) ?? 'view_refused';
    return send(conversationId, bare, replyToMessageId, onlyForUserId);
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
