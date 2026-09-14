// Phân tích kỹ thuật cho một mã, dùng cho lệnh `!ptkt vic`.
//
// Không có mô hình ngôn ngữ nào ở đây, và đó là chủ ý: cùng một chuỗi nến thì ra cùng một nhận
// định, và mọi con số trong câu trả lời đều tính lại được bằng tay. Các bước theo đúng thứ tự một
// người đọc chart đi qua — xu hướng theo MA, động lượng theo RSI và MACD, dòng tiền theo khối
// lượng, biên độ theo Bollinger và ATR, vùng giá theo đỉnh đáy gần nhất, rồi đặt mã vào bối cảnh
// VN-Index. Mỗi bước cho một gạch đầu dòng và một điểm; tổng điểm ra đánh giá, còn việc các bước
// có cùng chiều với nhau hay không ra độ tin cậy.
import { CHART, kindOf } from './dnse.mjs';
import { formatDay, tradingDay } from './chart.mjs';
import { money, vietnamNow } from './quote.mjs';

const TIMEOUT_MS = 8000;

/// Khoảng 300 phiên: đủ cho MA200 và cho vùng giá một năm, kể cả khi có kỳ nghỉ lễ dài.
const LOOKBACK_DAYS = 450;

/// MACD(12, 26, 9) cần chừng này cây nến mới có đường tín hiệu. Ít hơn thì không có gì để đọc.
export const MIN_SESSIONS = 35;

const INDEX = 'VNINDEX';
const YEAR_SESSIONS = 250;

/// Dưới mức giá trị giao dịch này mỗi phiên, vài lệnh lớn đủ vẽ lại cả chart.
const THIN_VALUE = 1e9;

const VERDICT = { positive: 'TÍCH CỰC', negative: 'TIÊU CỰC', neutral: 'BÌNH THƯỜNG' };
const CONFIDENCE = { high: 'CAO', medium: 'TRUNG BÌNH', low: 'THẤP' };

export function technicalAnalysis({ base = CHART, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  async function daily(symbol) {
    const to = Math.floor(now() / 1000);
    const from = to - LOOKBACK_DAYS * 24 * 60 * 60;
    const url = `${base}/${kindOf(symbol)}?from=${from}&to=${to}&symbol=${symbol}&resolution=1D`;

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    // Mã không có thật trả về 4xx ở vài đường: đó là "không có dữ liệu", không phải nguồn chết.
    if (response.status >= 400 && response.status < 500) return [];
    if (!response.ok) throw new Error(`nến ${symbol} trả lời ${response.status}`);
    return rowsFrom(await response.json());
  }

  return {
    async report(symbol) {
      const code = String(symbol ?? '').toUpperCase();
      // VN-Index chỉ là bối cảnh: hỏng thì bỏ hai dòng thị trường, không bỏ cả bài phân tích.
      const [rows, index] = await Promise.all([
        daily(code),
        code === INDEX ? null : daily(INDEX).catch(() => null),
      ]);
      if (!rows.length) return `${code} — không có dữ liệu`;

      const analysis = analyze(code, rows, index, { at: new Date(now()) });
      return analysis
        ? technicalMessage(analysis)
        : `${code} chưa đủ ${MIN_SESSIONS} phiên giao dịch để phân tích kỹ thuật.`;
    },
  };
}

export function rowsFrom(data) {
  if (!Array.isArray(data?.t) || !Array.isArray(data?.c)) return [];
  return data.t.map((stamp, index) => {
    const close = Number(data.c[index]);
    return {
      time: Number(stamp),
      open: Number(data.o?.[index] ?? close),
      high: Number(data.h?.[index] ?? close),
      low: Number(data.l?.[index] ?? close),
      close,
      volume: Number(data.v?.[index] ?? 0),
    };
  }).filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0);
}

/**
 * Cả bài phân tích, dưới dạng dữ liệu. `null` khi chưa đủ nến.
 *
 * `indexRows` là nến VN-Index; thiếu thì bỏ hai bước so với thị trường. `at` để biết cây nến cuối
 * có phải phiên đang chạy không — khối lượng của nửa phiên so với trung bình cả phiên thì luôn
 * trông như cạn thanh khoản.
 */
export function analyze(symbol, rows, indexRows = null, { at = new Date() } = {}) {
  if (!rows || rows.length < MIN_SESSIONS) return null;

  const code = String(symbol).toUpperCase();
  const closes = rows.map((row) => row.close);
  const last = rows.length - 1;
  const close = closes[last];
  const day = tradingDay(rows[last].time);
  const live = isLive(day, at);
  const atrValue = atr(rows, 14)[last];
  const ma20 = sma(closes, 20)[last];
  const averages = [
    { name: 'MA20', value: ma20 },
    { name: 'MA50', value: sma(closes, 50)[last] },
    { name: 'MA200', value: sma(closes, 200)[last] },
  ];
  const zones = levels(rows, close, atrValue);

  const trend = trendStep(close, averages, changeOver(closes, 20));
  const steps = [
    trend,
    momentumStep(rsi(closes, 14)[last]),
    macdStep(macd(closes), last),
    volumeStep(live ? rows.slice(0, -1) : rows),
    bandStep(closes, atrValue),
    levelsStep(zones),
    yearStep(rows, close, trend.score),
  ];
  if (code !== INDEX && indexRows?.length > 20) {
    steps.push(relativeStep(code, closes, indexRows.map((row) => row.close)));
    steps.push(marketStep(indexRows.map((row) => row.close)));
  }
  const shown = steps.filter(Boolean);

  const score = shown.reduce((sum, step) => sum + step.score, 0);
  const verdict = score >= 3 ? 'positive' : score <= -3 ? 'negative' : 'neutral';
  const { confidence, reason } = confidenceOf(verdict, shown, {
    sessions: rows.length,
    thin: kindOf(code) === 'stock' && averageValue(rows) < THIN_VALUE,
  });

  return {
    symbol: code,
    day,
    live,
    close,
    change: pctChange(closes[last - 1], close),
    steps: shown,
    score,
    verdict,
    confidence,
    reason,
    plan: plan(verdict, { close, atr: atrValue, ma20, zones }),
  };
}

export function technicalMessage(analysis) {
  const session = `phiên ${formatDay(analysis.day)}${analysis.live ? ' (đang giao dịch)' : ''}`;
  return [
    `PTKT ${analysis.symbol} · ${session} · giá ${money(analysis.close)} (${pct(analysis.change)})`,
    ...analysis.steps.map((step) => `- ${step.text}`),
    '',
    `Đánh giá: ${VERDICT[analysis.verdict]} (điểm ${signedInt(analysis.score)})`,
    `Độ tin cậy: ${CONFIDENCE[analysis.confidence]} — ${analysis.reason}`,
    ...analysis.plan,
    '',
    'Tín hiệu kỹ thuật tự động từ giá và khối lượng, không phải khuyến nghị đầu tư.',
  ].join('\n');
}

// ---- các bước -------------------------------------------------------------------------------

function trendStep(close, averages, change20) {
  const known = averages.filter((average) => average.value != null);
  const above = known.filter((average) => close > average.value).length;
  const values = known.map((average) => average.value);
  const stackedUp = known.length >= 2 && above === known.length && values.every((v, i) => i === 0 || values[i - 1] > v);
  const stackedDown = known.length >= 2 && above === 0 && values.every((v, i) => i === 0 || values[i - 1] < v);

  const share = above / known.length;
  const score = stackedUp ? 2 : stackedDown ? -2 : share > 0.5 ? 1 : share < 0.5 ? -1 : 0;
  const label = { 2: 'tăng rõ', 1: 'nghiêng tăng', 0: 'đi ngang', '-1': 'nghiêng giảm', '-2': 'giảm rõ' }[score];
  const positions = known
    .map((average) => `${close > average.value ? 'trên' : 'dưới'} ${average.name} (${money(average.value)})`)
    .join(', ');
  const stacked = stackedUp ? ', các đường MA xếp tăng dần' : stackedDown ? ', các đường MA xếp giảm dần' : '';

  return { score, text: `Xu hướng ${label}: giá ${positions}${stacked}; 20 phiên ${pct(change20)}.` };
}

function momentumStep(value) {
  if (value == null) return null;
  const [score, meaning] = value >= 70 ? [-1, 'quá mua, dễ rung lắc chốt lời ngắn hạn']
    : value >= 55 ? [1, 'động lượng tích cực, bên mua chiếm ưu thế']
      : value >= 45 ? [0, 'trung tính, cung cầu cân bằng']
        : value >= 30 ? [-1, 'động lượng yếu, bên bán chiếm ưu thế']
          : [0, 'quá bán, có thể hồi kỹ thuật nhưng chưa có tín hiệu đảo chiều'];
  return { score, text: `RSI(14) ${Math.round(value)}: ${meaning}.` };
}

function macdStep({ line, histogram }, last) {
  const now = histogram[last];
  const before = histogram[last - 1];
  if (now == null || before == null) return null;

  let crossed = null;
  for (let back = 0; back < 3 && histogram[last - back - 1] != null; back++) {
    const here = histogram[last - back];
    if (here !== 0 && Math.sign(here) !== Math.sign(histogram[last - back - 1])) {
      crossed = { up: here > 0, back };
      break;
    }
  }

  const score = Math.sign(now);
  const widening = Math.abs(now) > Math.abs(before);
  const where = crossed
    ? `MACD vừa cắt ${crossed.up ? 'lên trên' : 'xuống dưới'} đường tín hiệu${crossed.back ? ` ${crossed.back} phiên trước` : ' ở phiên gần nhất'}`
    : `MACD ${now > 0 ? 'trên' : 'dưới'} đường tín hiệu, histogram ${widening ? 'mở rộng' : 'thu hẹp'}`;
  const strong = widening || Boolean(crossed);
  const positiveZone = line[last] >= 0;
  // Cùng một histogram dương mà nằm dưới mốc 0 thì chỉ là nhịp hồi trong vùng yếu, chưa phải
  // động lượng tăng; histogram âm trên mốc 0 là điều chỉnh trong vùng khoẻ, chưa phải đà giảm.
  const meaning = score > 0
    ? positiveZone
      ? (strong ? 'động lượng tăng' : 'động lượng tăng đang chậm lại')
      : (strong ? 'đang hồi phục từ vùng yếu' : 'nhịp hồi trong vùng yếu đang nhạt dần')
    : score < 0
      ? positiveZone
        ? (strong ? 'động lượng tăng suy yếu rõ' : 'điều chỉnh nhẹ trong vùng khoẻ')
        : (strong ? 'động lượng giảm' : 'đà giảm đang chậm lại')
      : 'động lượng chưa rõ';

  return { score, text: `${where}, ${positiveZone ? 'trên' : 'dưới'} mốc 0: ${meaning}.` };
}

function volumeStep(rows) {
  if (rows.length < 26) return null;
  const recent = mean(rows.slice(-5).map((row) => row.volume));
  const base = mean(rows.slice(-25, -5).map((row) => row.volume));
  if (!(base > 0)) return null;

  const ratio = recent / base;
  const moved = changeOver(rows.map((row) => row.close), 5);
  const [score, meaning] = ratio >= 1.3 && moved > 0 ? [1, 'dòng tiền vào xác nhận đà tăng']
    : ratio >= 1.3 && moved < 0 ? [-1, 'khối lượng lớn khi giá giảm, áp lực bán mạnh']
      : ratio <= 0.7 ? [0, 'thanh khoản cạn, tín hiệu giá kém tin cậy']
        : [0, 'thanh khoản ổn định, chưa có đột biến'];

  return {
    score,
    text: `Khối lượng 5 phiên bằng ${money(ratio)} lần trung bình 20 phiên trước, giá 5 phiên ${pct(moved)}: ${meaning}.`,
  };
}

function bandStep(closes, atrValue) {
  const widths = [];
  for (let end = Math.max(20, closes.length - 120); end <= closes.length; end++) {
    const { middle, deviation } = band(closes.slice(end - 20, end));
    if (middle > 0) widths.push((4 * deviation) / middle);
  }
  const { middle, deviation } = band(closes.slice(-20));
  const upper = middle + 2 * deviation;
  const lower = middle - 2 * deviation;
  const close = closes.at(-1);
  const position = deviation === 0 ? 0.5 : (close - lower) / (upper - lower);

  const where = position > 1 ? 'vượt dải trên, dễ có nhịp điều chỉnh ngắn'
    : position < 0 ? 'thủng dải dưới, dễ có nhịp hồi ngắn'
      : position >= 0.5 ? 'ở nửa trên dải'
        : 'ở nửa dưới dải';
  const current = widths.at(-1);
  const squeeze = widths.length >= 60
    && current <= [...widths].sort((a, b) => a - b)[Math.floor(widths.length * 0.2)];
  const squeezed = squeeze ? '; dải đang co hẹp, thường báo trước một nhịp biến động mạnh' : '';

  return {
    score: 0,
    text: `Bollinger(20) ${money(lower)}–${money(upper)}: giá ${where}${squeezed}. ATR(14) ${money(atrValue)} ≈ ${money((atrValue / close) * 100)}%/phiên.`,
  };
}

function levelsStep(zones) {
  const supports = zones.supportFromAtr ? `${money(zones.supports[0])} (theo ATR, chưa có đáy gần)` : zones.supports.map(money).join(', ');
  const resistances = zones.resistanceFromAtr ? `${money(zones.resistances[0])} (theo ATR, đang ở vùng đỉnh)` : zones.resistances.map(money).join(', ');
  return { score: 0, text: `Hỗ trợ gần ${supports} · kháng cự gần ${resistances}.` };
}

function yearStep(rows, close, trendScore) {
  const recent = rows.slice(-YEAR_SESSIONS);
  const high = Math.max(...recent.map((row) => row.high));
  const low = Math.min(...recent.map((row) => row.low));
  const fromHigh = pctChange(high, close);
  const fromLow = pctChange(low, close);

  const [score, note] = fromHigh >= -5 && trendScore > 0 ? [1, ' — sát đỉnh trong xu hướng tăng, cổ phiếu khoẻ']
    : fromLow <= 5 && trendScore < 0 ? [-1, ' — sát đáy trong xu hướng giảm, chưa có lực đỡ rõ']
      : [0, ''];
  const span = recent.length >= YEAR_SESSIONS ? '1 năm' : `${recent.length} phiên`;

  return { score, text: `Vùng giá ${span} ${money(low)}–${money(high)}: cách đỉnh ${pct(fromHigh)}, cách đáy ${pct(fromLow)}${note}.` };
}

function relativeStep(symbol, closes, indexCloses) {
  const own = changeOver(closes, 20);
  const market = changeOver(indexCloses, 20);
  const gap = own - market;
  const [score, meaning] = gap > 3 ? [1, 'mạnh hơn thị trường'] : gap < -3 ? [-1, 'yếu hơn thị trường'] : [0, 'đi cùng thị trường'];
  return { score, text: `So với VN-Index 20 phiên: ${symbol} ${pct(own)}, VN-Index ${pct(market)} → ${meaning}.` };
}

function marketStep(closes) {
  const last = closes.length - 1;
  const close = closes[last];
  const ma20 = sma(closes, 20)[last];
  const ma50 = sma(closes, 50)[last] ?? ma20;
  const score = close > ma50 && ma20 > ma50 ? 1 : close < ma50 && ma20 < ma50 ? -1 : 0;
  const meaning = score > 0 ? 'thuận lợi cho vị thế mua' : score < 0 ? 'bất lợi, ưu tiên phòng thủ' : 'giằng co';
  return {
    score,
    text: `Thị trường chung: VN-Index ${money(close)} ${close > ma20 ? 'trên' : 'dưới'} MA20, ${close > ma50 ? 'trên' : 'dưới'} MA50, 20 phiên ${pct(changeOver(closes, 20))} → ${meaning}.`,
  };
}

function confidenceOf(verdict, steps, { sessions, thin }) {
  const up = steps.filter((step) => step.score > 0).length;
  const down = steps.filter((step) => step.score < 0).length;
  const total = Math.abs(steps.reduce((sum, step) => sum + step.score, 0));

  let confidence;
  let reason;
  if (verdict === 'neutral') {
    confidence = up >= 2 && down >= 2 ? 'low' : 'medium';
    reason = up && down ? `tín hiệu trái chiều (${up} tích cực, ${down} tiêu cực)` : 'ít tín hiệu rõ ràng';
  } else {
    const agree = verdict === 'positive' ? up : down;
    const against = verdict === 'positive' ? down : up;
    confidence = against >= 3 ? 'low' : total >= 5 && against <= 1 ? 'high' : 'medium';
    reason = `${agree}/${agree + against} tín hiệu cùng chiều`;
  }

  if (sessions < 120) {
    confidence = 'low';
    reason += `, mới có ${sessions} phiên dữ liệu`;
  }
  if (thin) {
    confidence = 'low';
    reason += ', thanh khoản thấp';
  }
  return { confidence, reason };
}

function plan(verdict, { close, atr: atrValue, ma20, zones }) {
  const support = zones.supports[0];
  const [first, second] = zones.resistances;
  const stop = floorTick(support - 0.5 * atrValue);
  const targets = [first, second].filter((value) => value != null).map((value) => money(roundTick(value))).join(' · ');

  if (verdict === 'positive') {
    const near = close - support <= atrValue;
    const zone = near ? [support, close] : [support, support + 0.5 * atrValue];
    const entry = (zone[0] + zone[1]) / 2;
    const reward = (first - entry) / Math.max(entry - stop, Number.EPSILON);
    const why = near ? 'quanh giá hiện tại, sát hỗ trợ' : 'khi điều chỉnh về hỗ trợ';
    return [
      `Điểm mua: ${range(zone)} (${why}), hoặc khi vượt ${money(roundTick(first))} kèm khối lượng lớn`,
      `Điểm bán/chốt lời: ${targets}`,
      `Cắt lỗ: dưới ${money(stop)} (${pct(pctChange(entry, stop))} từ giá mua) · R:R ≈ ${money(reward)}${reward < 1 ? ', chưa hấp dẫn' : ''}`,
    ];
  }

  const overhead = ma20 != null && ma20 > close && ma20 < first
    ? { value: ma20, name: 'MA20' }
    : { value: first, name: 'kháng cự' };

  if (verdict === 'negative') {
    return [
      `Điểm mua: chưa mua; chỉ xem xét lại khi giá lấy lại ${money(roundTick(overhead.value))} (${overhead.name}) kèm khối lượng`,
      `Điểm bán: hạ tỷ trọng khi hồi về ${money(roundTick(overhead.value))} (${overhead.name})`,
      `Cắt lỗ: đóng cửa dưới ${money(stop)} với vị thế đang giữ`,
    ];
  }

  return [
    `Điểm mua: thăm dò quanh ${range([support, Math.min(close, support + 0.5 * atrValue)])} (hỗ trợ)`,
    `Điểm bán: quanh ${targets} (kháng cự)`,
    `Cắt lỗ: dưới ${money(stop)}`,
  ];
}

// ---- vùng giá ----------------------------------------------------------------------------------

/**
 * Hỗ trợ và kháng cự từ đỉnh đáy cục bộ của 120 phiên gần nhất.
 *
 * Một đỉnh là cây nến có giá cao nhất trong ba cây mỗi bên; đáy tương tự. Hai mức gần nhau hơn
 * nửa ATR là một vùng, không phải hai. Không có đáy nào dưới giá (vừa lập đáy mới) hay đỉnh nào
 * trên giá (vừa lập đỉnh mới) thì lấy hai lần ATR, và nói ra là theo ATR.
 */
function levels(rows, close, atrValue, lookback = 120, wing = 3) {
  const recent = rows.slice(-lookback);
  const highs = [];
  const lows = [];
  for (let i = wing; i < recent.length - wing; i++) {
    const around = recent.slice(i - wing, i + wing + 1);
    if (recent[i].high === Math.max(...around.map((row) => row.high))) highs.push(recent[i].high);
    if (recent[i].low === Math.min(...around.map((row) => row.low))) lows.push(recent[i].low);
  }

  const gap = Math.max(atrValue * 0.5, close * 0.01);
  const supports = distinct(lows.filter((price) => price < close).sort((a, b) => b - a), gap).slice(0, 2);
  const resistances = distinct(highs.filter((price) => price > close).sort((a, b) => a - b), gap).slice(0, 2);

  return {
    supports: supports.length ? supports : [close - 2 * atrValue],
    resistances: resistances.length ? resistances : [close + 2 * atrValue],
    supportFromAtr: !supports.length,
    resistanceFromAtr: !resistances.length,
  };
}

function distinct(sorted, gap) {
  const kept = [];
  for (const price of sorted) {
    if (!kept.length || Math.abs(price - kept.at(-1)) >= gap) kept.push(price);
  }
  return kept;
}

// ---- chỉ báo -----------------------------------------------------------------------------------

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/// EMA mở đầu bằng SMA của `period` giá trị đầu tiên; bỏ qua những ô `null` ở đầu chuỗi.
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const start = values.findIndex((value) => value != null);
  if (start < 0 || values.length - start < period) return out;

  let previous = mean(values.slice(start, start + period));
  out[start + period - 1] = previous;
  const weight = 2 / (period + 1);
  for (let i = start + period; i < values.length; i++) {
    previous = values[i] * weight + previous * (1 - weight);
    out[i] = previous;
  }
  return out;
}

/// RSI kiểu Wilder.
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const move = closes[i] - closes[i - 1];
    gain += Math.max(move, 0);
    loss += Math.max(-move, 0);
  }
  gain /= period;
  loss /= period;
  out[period] = strength(gain, loss);

  for (let i = period + 1; i < closes.length; i++) {
    const move = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(move, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-move, 0)) / period;
    out[i] = strength(gain, loss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, span = 9) {
  const quick = ema(closes, fast);
  const steady = ema(closes, slow);
  const line = closes.map((_, i) => (quick[i] != null && steady[i] != null ? quick[i] - steady[i] : null));
  const signal = ema(line, span);
  const histogram = line.map((value, i) => (value != null && signal[i] != null ? value - signal[i] : null));
  return { line, signal, histogram };
}

/// ATR kiểu Wilder.
export function atr(rows, period = 14) {
  const out = new Array(rows.length).fill(null);
  if (rows.length <= period) return out;

  const ranges = rows.map((row, i) => (i === 0
    ? row.high - row.low
    : Math.max(row.high - row.low, Math.abs(row.high - rows[i - 1].close), Math.abs(row.low - rows[i - 1].close))));
  let value = mean(ranges.slice(1, period + 1));
  out[period] = value;
  for (let i = period + 1; i < rows.length; i++) {
    value = (value * (period - 1) + ranges[i]) / period;
    out[i] = value;
  }
  return out;
}

function strength(gain, loss) {
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

function band(window) {
  const middle = mean(window);
  const deviation = Math.sqrt(mean(window.map((value) => (value - middle) ** 2)));
  return { middle, deviation };
}

// ---- tiện ích ----------------------------------------------------------------------------------

function isLive(day, at) {
  const { weekday, minutes } = vietnamNow(at);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= 9 * 60 && minutes < 15 * 60 && tradingDay(at.getTime() / 1000) === day;
}

function averageValue(rows) {
  const recent = rows.slice(-20);
  return mean(recent.map((row) => row.volume * row.close * 1000));
}

function changeOver(closes, sessions) {
  const from = closes[Math.max(0, closes.length - 1 - sessions)];
  return pctChange(from, closes.at(-1));
}

function pctChange(from, to) {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/// Bước giá: dưới 10 nghìn đồng đi 10đ, từ 10 nghìn trở lên làm tròn 100đ — hợp lệ ở cả ba sàn.
function tickOf(price) {
  return price < 10 ? 0.01 : 0.1;
}

function roundTick(price) {
  const tick = tickOf(price);
  return Number((Math.round(price / tick) * tick).toFixed(2));
}

function floorTick(price) {
  const tick = tickOf(price);
  return Number((Math.floor(price / tick + 1e-9) * tick).toFixed(2));
}

function range([from, to]) {
  const low = roundTick(Math.min(from, to));
  const high = roundTick(Math.max(from, to));
  return low === high ? money(low) : `${money(low)}–${money(high)}`;
}

function pct(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(Math.abs(value))}%`;
}

function signedInt(value) {
  return value > 0 ? `+${value}` : String(value);
}
