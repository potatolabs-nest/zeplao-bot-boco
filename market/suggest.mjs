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
import { money, vietnamNow } from './quote.mjs';

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
    // Điểm của mọi mã đã chấm, để hình đặt mười mã được chọn cạnh cả sàn.
    const scores = [];
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
      scores.push(analysis.score);
      if (recommendable(analysis, quote)) picks.push(analysis);
    });

    picks.sort(byStrength);
    return { at, scanned: analyzed, scores, picks: await bigEnough(picks, company) };
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

/**
 * Chữ đi kèm hình: mỗi mã một dòng, đủ để đặt lệnh mà không cần mở hình. Lý do, điểm, độ tin cậy và
 * chỗ đứng so với cả sàn nằm trên hình — ba dòng chữ mỗi mã nhân mười là một bức tường không ai đọc.
 */
export function suggestMessage({ at, scanned, picks }) {
  const head = `${picks.length ? `TOP ${picks.length} ` : ''}MÃ ĐÁNG MUA · ${stamp(at)} · quét ${scanned} mã`;
  if (!picks.length) {
    return [head, 'Chưa có mã vốn hoá từ 1.000 tỷ nào đủ tín hiệu tích cực với độ tin cậy từ trung bình trở lên. Đứng ngoài cũng là một vị thế.'].join('\n');
  }

  const market = marketOf(picks);
  return [
    head,
    market ? market.text : null,
    '',
    ...picks.map((analysis, i) => `${i + 1}. ${analysis.symbol} ${money(analysis.close)} ${pct(analysis.change)} · mua ${range(analysis.plan.buy)} · chốt ${money(analysis.plan.targets[0])} · cắt lỗ ${money(analysis.plan.stop)}`),
    '',
    'Tín hiệu tự động từ PTKT, không phải khuyến nghị đầu tư. Xem kỹ: !ptkt <mã>',
  ].filter((line) => line !== null).join('\n');
}

/// Tin gửi đi: hình trước, chữ ngay sau — như `!ptkt`. Không có mã nào thì chỉ chữ.
export function suggestRich(result) {
  const text = suggestMessage(result);
  if (!result.picks.length) return text;
  return {
    text,
    image: { fileName: `sugg-${tradingDay(result.at.getTime() / 1000)}.svg`, svg: suggestSvg(result) },
    rich: { blocks: [{ type: 'paragraph', text }] },
  };
}

function marketOf(picks) {
  return picks[0]?.steps.find((step) => step.key === 'market') ?? null;
}

function stamp(at) {
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
  return `${time} ${formatDay(tradingDay(at.getTime() / 1000))}`;
}

/// Lý do, ngắn: những bước kéo điểm lên, mỗi bước một cụm từ. Thị trường chung đã nói ở đầu hình.
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

// ---- hình -----------------------------------------------------------------------------------------
//
// Hai câu hỏi, hai phần, đọc từ trên xuống:
//
// 1. **Mười mã này đứng ở đâu so với cả sàn?** Phân bố điểm PTKT của mọi mã đã chấm, mỗi điểm một
//    cột. Cột có mã được chọn tô xanh và mang tên mã ngay trên đầu — nhìn là thấy chúng nằm ở đuôi
//    phải, không phải giữa đám đông. Chiều cao theo căn bậc hai: một cột 300 mã cạnh một cột 3 mã
//    theo thang thẳng thì cột nhỏ không còn thấy được, mà cột nhỏ chính là chỗ cần nhìn.
// 2. **Mua mỗi mã thì được ăn bao nhiêu, mất bao nhiêu?** Mỗi mã một hàng, **chung một trục phần
//    trăm** tính từ giá hiện tại: đỏ là quãng tới cắt lỗ, xanh là quãng tới chốt lời, dải nhạt là
//    vùng mua. Chung trục thì so được giữa các hàng bằng mắt — thanh xanh dài, thanh đỏ ngắn là kèo
//    đẹp, không cần đọc số.

const W = 1000;
const SCALE = 2;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const SECONDARY = '#52514e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const BAR = '#d6d4cc';
const UP = '#0b6b2f';
const UP_SOFT = '#cfe6d6';
const DOWN = '#e0504d';
const CAUTION = '#c8622f';
const MOOD = { 1: UP, 0: '#76746e', '-1': CAUTION };

const HEAD = 150;
const DIST = { top: 270, bottom: 500, left: 60, right: 940 };
const PLAN_TOP = 610;
const ROW = 104;
const LANE = { left: 300, right: 760 };

export function suggestSvg({ at, scanned, scores = [], picks }) {
  const height = PLAN_TOP + 70 + picks.length * ROW + 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${height * SCALE}" viewBox="0 0 ${W} ${height}" font-family="${FONT}">
  <rect width="${W}" height="${height}" fill="${SURFACE}"/>
  ${headerSvg(at, scanned, picks)}
  ${distributionSvg(scores, picks, scanned)}
  ${planSvg(picks)}
  <text x="36" y="${height - 24}" font-size="18" fill="${MUTED}">Tín hiệu tự động từ giá và khối lượng, không phải khuyến nghị đầu tư. Xem kỹ: !ptkt &lt;mã&gt;</text>
</svg>`;
}

function headerSvg(at, scanned, picks) {
  const market = marketOf(picks);
  const mood = market?.score ?? 0;
  const label = market ? market.text.replace('Thị trường chung: ', 'Thị trường ') : '';
  const pill = Math.round(label.length * 10.6 + 36);
  return `<text x="36" y="66" font-size="40" font-weight="800" fill="${INK}">${picks.length} mã đáng mua nhất</text>
  <text x="36" y="104" font-size="22" fill="${SECONDARY}">${escapeXml(stamp(at))} · chấm PTKT ${scanned} mã · vốn hoá từ 1.000 tỷ</text>
  ${market ? `<rect x="36" y="${HEAD - 26}" width="${pill}" height="38" rx="19" fill="${MOOD[mood]}"/>
  <text x="${36 + pill / 2}" y="${HEAD - 0}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>` : ''}`;
}

function distributionSvg(scores, picks, scanned) {
  if (!scores.length) return '';
  const low = Math.min(...scores, ...picks.map((pick) => pick.score));
  const high = Math.max(...scores, ...picks.map((pick) => pick.score));
  const counts = new Map();
  for (const score of scores) counts.set(score, (counts.get(score) ?? 0) + 1);
  const most = Math.max(...counts.values());

  const slots = high - low + 1;
  const slot = (DIST.right - DIST.left) / slots;
  const bar = Math.min(56, slot * 0.72);
  const x = (score) => DIST.left + slot * (score - low + 0.5);
  // Phần dưới cho cột, phần trên cho chú thích tên mã.
  const floor = DIST.bottom;
  const reach = (DIST.bottom - DIST.top) * 0.58;
  const tall = (n) => Math.max(3, Math.sqrt(n / most) * reach);

  const chosen = new Map();
  for (const pick of picks) chosen.set(pick.score, [...(chosen.get(pick.score) ?? []), pick.symbol]);
  const cut = Math.min(...picks.map((pick) => pick.score));
  const above = scores.filter((score) => score >= cut).length;
  const share = (above / scores.length) * 100;

  const bars = [];
  for (let score = low; score <= high; score++) {
    const n = counts.get(score) ?? 0;
    const picked = chosen.has(score);
    const h = n ? tall(n) : 0;
    const cx = x(score);
    if (n) bars.push(`<rect x="${r(cx - bar / 2)}" y="${r(floor - h)}" width="${r(bar)}" height="${r(h)}" rx="3" fill="${picked ? UP : BAR}"/>`);
    if (n && slot >= 30) bars.push(`<text x="${r(cx)}" y="${r(floor - h - 6)}" text-anchor="middle" font-size="14" fill="${picked ? UP : MUTED}">${n}</text>`);
    bars.push(`<text x="${r(cx)}" y="${floor + 26}" text-anchor="middle" font-size="16" font-weight="${score === 0 ? 700 : 400}" fill="${picked ? UP : MUTED}">${score > 0 ? `+${score}` : score}</text>`);
  }

  // Tên mã thành chú thích ở góc trên bên phải, mỗi mức điểm một dòng. Chồng thẳng lên đầu cột thì
  // tám mã cùng điểm là một cột chữ cao hơn cả hình.
  const notes = [...chosen.entries()].sort(([a], [b]) => b - a).map(([score, names], i) => `<text x="${DIST.right}" y="${DIST.top + 6 + i * 26}" text-anchor="end" font-size="19" fill="${UP}"><tspan font-weight="800">điểm +${score}:</tspan> ${escapeXml(names.join(' · '))}</text>`);

  return `<text x="36" y="${DIST.top - 36}" font-size="24" font-weight="700" fill="${INK}">So với cả sàn: thuộc nhóm ${one.format(share)}% điểm cao nhất</text>
  <text x="36" y="${DIST.top - 8}" font-size="18" fill="${SECONDARY}">Mỗi cột là số mã theo điểm PTKT của ${scanned} mã · cột xanh có mã được chọn</text>
  <line x1="${DIST.left}" y1="${floor}" x2="${DIST.right}" y2="${floor}" stroke="${GRID}" stroke-width="2"/>
  ${bars.join('\n  ')}
  ${notes.join('\n  ')}
  <text x="${DIST.left}" y="${floor + 52}" font-size="16" fill="${MUTED}">← tiêu cực</text>
  <text x="${DIST.right}" y="${floor + 52}" text-anchor="end" font-size="16" fill="${MUTED}">tích cực →</text>`;
}

function planSvg(picks) {
  const percent = (pick, price) => ((price - pick.close) / pick.close) * 100;
  const lowest = Math.min(-2, ...picks.map((pick) => percent(pick, pick.plan.stop)));
  const highest = Math.max(2, ...picks.map((pick) => percent(pick, pick.plan.targets[0])));
  const step = [1, 2, 5, 10, 20, 50].find((size) => (highest - lowest) / size <= 7) ?? 100;
  const lo = Math.floor(lowest / step) * step;
  const hi = Math.ceil(highest / step) * step;
  const x = (value) => LANE.left + ((value - lo) / (hi - lo)) * (LANE.right - LANE.left);
  const first = PLAN_TOP + 70;

  const ticks = [];
  for (let value = lo; value <= hi + 1e-9; value += step) ticks.push(value);
  // Lưới chỉ chạy qua dải thanh của từng hàng, không cắt ngang dòng lý do.
  const grid = ticks.map((value) => `${picks.map((_, i) => `<line x1="${r(x(value))}" y1="${first + i * ROW + 4}" x2="${r(x(value))}" y2="${first + i * ROW + 48}" stroke="${value === 0 ? SECONDARY : '#cfcdc4'}" stroke-width="${value === 0 ? 2 : 1}"${value === 0 ? '' : ' stroke-dasharray="3 4"'}/>`).join('')}
  <text x="${r(x(value))}" y="${first - 20}" text-anchor="middle" font-size="15" fill="${value === 0 ? INK : MUTED}" font-weight="${value === 0 ? 700 : 400}">${value === 0 ? 'giá' : `${value > 0 ? '+' : ''}${value}%`}</text>`).join('\n  ');

  const rows = picks.map((pick, i) => {
    const top = first + i * ROW;
    const mid = top + 26;
    const stop = x(percent(pick, pick.plan.stop));
    const target = x(percent(pick, pick.plan.targets[0]));
    const zero = x(0);
    const [buyLow, buyHigh] = pick.plan.buy.map((price) => x(percent(pick, price)));
    const arrow = pick.change > 0 ? '▲' : pick.change < 0 ? '▼' : '';
    const tone = pick.change > 0 ? UP : pick.change < 0 ? DOWN : MUTED;
    const reward = rewardNow(pick);
    return `<text x="36" y="${mid + 8}" font-size="20" fill="${MUTED}">${i + 1}</text>
  <text x="68" y="${mid + 10}" font-size="30" font-weight="800" fill="${INK}">${escapeXml(pick.symbol)}</text>
  <text x="168" y="${mid + 8}" font-size="20" font-weight="600" fill="${INK}">${money(pick.close)}</text>
  <text x="168" y="${mid + 32}" font-size="16" fill="${tone}">${arrow}${pct(Math.abs(pick.change)).replace(/^[+-]/, '')}</text>
  <rect x="${r(Math.min(buyLow, buyHigh) - 2)}" y="${mid - 15}" width="${r(Math.max(4, Math.abs(buyHigh - buyLow) + 4))}" height="30" rx="4" fill="${UP_SOFT}"/>
  <rect x="${r(stop)}" y="${mid - 6}" width="${r(zero - stop)}" height="12" rx="3" fill="${DOWN}"/>
  <rect x="${r(zero)}" y="${mid - 6}" width="${r(target - zero)}" height="12" rx="3" fill="${UP}"/>
  <circle cx="${r(zero)}" cy="${mid}" r="7" fill="${INK}" stroke="${SURFACE}" stroke-width="2"/>
  <text x="${r(stop)}" y="${mid + 30}" text-anchor="middle" font-size="15" fill="${DOWN}">${money(pick.plan.stop)}</text>
  <text x="${r(target)}" y="${mid + 30}" text-anchor="middle" font-size="15" fill="${UP}">${money(pick.plan.targets[0])}</text>
  <text x="${LANE.right + 24}" y="${mid + 2}" font-size="22" font-weight="800" fill="${reward >= 2 ? UP : INK}">R:R ${one.format(reward)}</text>
  <text x="${LANE.right + 24}" y="${mid + 28}" font-size="16" fill="${SECONDARY}">điểm +${pick.score} · tin cậy ${CONFIDENCE[pick.confidence]}</text>
  <text x="68" y="${top + 74}" font-size="16" fill="${SECONDARY}">${escapeXml(reasons(pick, 3).join(' · '))}</text>`;
  }).join('\n  ');
  const stripes = picks.map((_, i) => (i % 2 ? '' : `<rect x="20" y="${first + i * ROW - 14}" width="${W - 40}" height="${ROW}" rx="10" fill="#f3f2ee"/>`)).join('');

  return `<text x="36" y="${PLAN_TOP - 8}" font-size="24" font-weight="700" fill="${INK}">Mua ở giá hiện tại: mất bao nhiêu, được bao nhiêu</text>
  <rect x="36" y="${PLAN_TOP + 8}" width="28" height="12" rx="3" fill="${DOWN}"/>
  <text x="72" y="${PLAN_TOP + 20}" font-size="16" fill="${SECONDARY}">tới cắt lỗ</text>
  <rect x="166" y="${PLAN_TOP + 8}" width="28" height="12" rx="3" fill="${UP}"/>
  <text x="202" y="${PLAN_TOP + 20}" font-size="16" fill="${SECONDARY}">tới chốt lời</text>
  <rect x="306" y="${PLAN_TOP + 2}" width="28" height="24" rx="4" fill="${UP_SOFT}"/>
  <text x="342" y="${PLAN_TOP + 20}" font-size="16" fill="${SECONDARY}">vùng mua</text>
  ${stripes}
  ${grid}
  ${rows}`;
}

function r(value) {
  return Math.round(value * 10) / 10;
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
