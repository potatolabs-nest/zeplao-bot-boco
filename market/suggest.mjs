// Mười mã đáng mua nhất lúc này, theo đúng bài phân tích của `!ptkt`, cho lệnh `!sugg`.
//
// Không có bảng chấm điểm thứ hai. Mỗi mã đi qua `analyze()` y như khi ai đó gõ `!ptkt` cho nó, nên
// một mã đứng trong danh sách này thì `!ptkt` mã ấy ra đúng đánh giá ấy — hai lệnh mà cãi nhau về
// cùng một mã là hai lệnh không ai tin được lệnh nào.
//
// Quét mọi cổ phiếu có khớp lệnh trong phiên, không phải một danh sách viết tay: chừng 800 mã, mười
// mấy luồng song song, vài giây. Mã cả phiên không ai mua bán thì không có gì để khuyến nghị mua.
import { analyze, dailyCandles } from './technical.mjs';
import { formatDay, tradingDay } from './chart.mjs';
import { count, money, vietnamNow } from './quote.mjs';

/// Bao nhiêu mã trong câu trả lời.
export const SUGGEST_COUNT = 10;

/// Số luồng hỏi nến cùng lúc. Đo thật: 252 mã mất 1,3 giây ở 12 luồng, không lỗi nào.
const CONCURRENCY = 12;

/// Kết quả một lần quét dùng lại trong chừng này. Năm người gõ `!sugg` trong một phút là năm lần
/// hỏi 800 mã nếu không nhớ — mà nến ngày thì không đổi gì đáng kể trong hai phút.
const FRESH_MS = 2 * 60 * 1000;

/// Dưới mức giá trị giao dịch bình quân này mỗi phiên, không khuyến nghị: vài lệnh là đủ vẽ lại cả
/// chart, và mua được rồi chưa chắc bán ra được.
const LIQUID_VALUE = 3e9;

/// Giá đã chạy quá vùng mua hơn chừng này thì không đưa vào: mua ngay là mua đuổi, và cắt lỗ đặt
/// dưới hỗ trợ thì đã xa tới mức một lần sai ăn mất mấy lần lãi.
const STRETCH = 0.05;

/// Vốn hoá tối thiểu, bằng đồng. Dưới mức này là mã nhỏ: chart dễ bị vài tay to vẽ lại.
export const MIN_MARKET_CAP = 1000e9;

const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 };
const CONFIDENCE = { high: 'CAO', medium: 'TB', low: 'THẤP' };

const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export function suggestions({ daily = dailyCandles(), now = () => Date.now(), concurrency = CONCURRENCY } = {}) {
  let last = null;
  let running = null;

  async function scan(market, company) {
    const at = new Date(now());
    const universe = (await market.universe()).filter(isStock);
    const quotes = await market.quotes(universe);
    // Mã có khớp trong phiên. Trước giờ mở cửa thì chưa mã nào khớp, nên quét cả bảng.
    const traded = quotes.filter((quote) => quote.volume > 0 && isStock(quote.symbol));
    const scanned = traded.length ? traded : quotes.filter((quote) => isStock(quote.symbol));

    const index = await daily('VNINDEX').catch(() => null);
    const picks = [];
    let analyzed = 0;
    await pool(scanned, concurrency, async (quote) => {
      let rows;
      try {
        rows = await daily(quote.symbol);
      } catch {
        return;
      }
      const analysis = analyze(quote.symbol, withQuote(rows, quote, at), index, { at });
      if (!analysis) return;
      analyzed += 1;
      if (recommendable(analysis, quote)) picks.push(analysis);
    });

    picks.sort(byStrength);
    return { at, scanned: analyzed, picks: await bigEnough(picks, company) };
  }

  return {
    /// Mười mã, hoặc ít hơn khi thị trường không có đủ mười mã tích cực — không lấp chỗ trống bằng
    /// mã bình thường.
    async top(market, company) {
      if (last && now() - last.done < FRESH_MS) return last.result;
      running ??= scan(market, company)
        .then((result) => {
          last = { result, done: now() };
          return result;
        })
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
}

/**
 * Mười mã đầu có vốn hoá từ 1.000 tỷ, theo đúng thứ tự đã xếp.
 *
 * Hỏi vốn hoá sau khi đã lọc PTKT chứ không trước: vài chục mã tích cực thay vì 800 lời gọi, và hồ
 * sơ được nhớ nửa ngày. Mã không biết vốn hoá thì không đưa vào — điều kiện là "ít nhất 1.000 tỷ",
 * không phải "có lẽ". Nguồn hồ sơ chết hẳn thì nói ra, đừng trả về một danh sách rỗng trông như
 * thị trường không có mã nào.
 */
async function bigEnough(picks, company) {
  const caps = await Promise.all(picks.map((analysis) => company.profile(analysis.symbol)
    .then((profile) => profile?.marketCap ?? null)
    .catch(() => undefined)));
  if (picks.length && caps.every((cap) => cap === undefined)) throw new Error('không hỏi được vốn hoá');
  return picks
    .map((analysis, i) => ({ ...analysis, marketCap: caps[i] }))
    .filter((analysis) => analysis.marketCap >= MIN_MARKET_CAP)
    .slice(0, SUGGEST_COUNT);
}

/// Chỉ cổ phiếu: ba chữ cái. Chứng chỉ quỹ, chứng quyền, chỉ số đều dài hơn.
function isStock(symbol) {
  return /^[A-Z]{3}$/.test(String(symbol ?? ''));
}

/**
 * Nến ngày, thêm phiên đang chạy dựng từ bảng giá khi nguồn nến chưa có nó.
 *
 * `!ptkt` dựng phiên đang chạy từ nến 5 phút; ở đây thì đã có sẵn giá mở, cao, thấp, khớp và khối
 * lượng của cả sàn trong một lượt hỏi bảng giá, nên khỏi hỏi thêm 800 lượt nến phút.
 */
export function withQuote(rows, quote, at) {
  if (!rows?.length || !quote?.traded) return rows;
  const { weekday, minutes } = vietnamNow(at);
  if (weekday === 'Sat' || weekday === 'Sun' || minutes < 9 * 60) return rows;
  const day = tradingDay(at.getTime() / 1000);
  if (tradingDay(rows.at(-1).time) >= day) return rows;

  const close = quote.price;
  return [...rows, {
    time: Math.floor(at.getTime() / 1000),
    open: quote.open > 0 ? quote.open : close,
    high: Math.max(quote.high || close, close),
    low: Math.min(quote.low > 0 ? quote.low : close, close),
    close,
    volume: quote.volume,
  }];
}

function recommendable(analysis, quote) {
  if (analysis.verdict !== 'positive' || analysis.confidence === 'low') return false;
  // Đứng giá trần thì không mua được: bên bán trắng.
  if (quote.ceiling > 0 && quote.price >= quote.ceiling) return false;
  if (analysis.close > analysis.plan.buy[1] * (1 + STRETCH)) return false;
  if (!(rewardNow(analysis) >= 1)) return false;
  const recent = analysis.series.rows.slice(-20);
  const value = recent.reduce((sum, row) => sum + row.volume * row.close * 1000, 0) / recent.length;
  return value >= LIQUID_VALUE;
}

/// Lời/lỗ nếu mua **ở giá hiện tại**, không phải ở giữa vùng mua như `!ptkt` tính: lệnh này trả lời
/// câu "mua bây giờ được không".
export function rewardNow({ close, plan }) {
  const risk = close - plan.stop;
  return risk > 0 ? (plan.targets[0] - close) / risk : 0;
}

/// Điểm cao trước; cùng điểm thì tin cậy cao trước; rồi tới mã có lời/lỗ đẹp hơn.
function byStrength(a, b) {
  return b.score - a.score
    || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
    || rewardNow(b) - rewardNow(a);
}

async function pool(items, size, work) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

// ---- câu chữ -----------------------------------------------------------------------------------

/// Một tin nhắn tối đa 2.000 ký tự; chừa chỗ cho phần bao ngoài.
export const MAX_SUGGEST_CHARS = 1900;

/// Ba lý do mỗi mã, bớt dần khi tin dài quá trần.
export function suggestMessage(result) {
  let text = '';
  for (let most = 3; most >= 1; most--) {
    text = suggestText(result, most);
    if (text.length <= MAX_SUGGEST_CHARS) break;
  }
  return text;
}

function suggestText({ at, scanned, picks }, most) {
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
  const head = `${picks.length ? `TOP ${picks.length} ` : ''}MÃ ĐÁNG MUA · ${time} ${formatDay(tradingDay(at.getTime() / 1000))} · quét ${scanned} mã`;
  if (!picks.length) {
    return [head, 'Chưa có mã vốn hoá từ 1.000 tỷ nào đủ tín hiệu tích cực với độ tin cậy từ trung bình trở lên. Đứng ngoài cũng là một vị thế.'].join('\n');
  }

  const market = picks[0].steps.find((step) => step.key === 'market');
  return [
    head,
    market ? market.text : null,
    '',
    ...picks.flatMap((analysis, i) => [
      `${i + 1}. ${analysis.symbol} ${money(analysis.close)} ${pct(analysis.change)} · vốn hoá ${count(analysis.marketCap / 1e9)} tỷ · tin cậy ${CONFIDENCE[analysis.confidence]} (+${analysis.score})`,
      `   ${reasons(analysis, most).join(' · ')}`,
      `   Mua ${range(analysis.plan.buy)} · chốt ${money(analysis.plan.targets[0])} · cắt lỗ ${money(analysis.plan.stop)} · R:R ${one.format(rewardNow(analysis))}`,
    ]),
    '',
    'Tín hiệu tự động từ PTKT, không phải khuyến nghị đầu tư. Xem kỹ: !ptkt <mã>',
  ].filter((line) => line !== null).join('\n');
}

/// Lý do, ngắn: những bước kéo điểm lên, mỗi bước một cụm từ. Thị trường chung đã nói ở đầu tin.
export function reasons(analysis, most = 3) {
  return analysis.steps
    .filter((step) => step.score > 0 && step.key !== 'market')
    .sort((a, b) => b.score - a.score)
    .slice(0, most)
    .map(short);
}

function short(step) {
  switch (step.key) {
    case 'trend': return step.text.split(':')[0];
    case 'rsi': return step.text.replace(':', '');
    case 'macd': return step.text.replace(':', '').replace(' chậm lại', '');
    case 'volume': return `tiền vào ${step.text.match(/\(([^)]*)\)/)?.[1] ?? ''}`.trim();
    case 'year': return 'sát đỉnh 1 năm';
    case 'relative': return step.text.split(':')[0].replace('VN-Index 20 phiên', 'VN-Index');
    default: return step.text;
  }
}

function range([from, to]) {
  return from === to ? money(from) : `${money(from)}–${money(to)}`;
}

function pct(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(Math.abs(value))}%`;
}
