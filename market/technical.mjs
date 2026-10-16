// Phân tích kỹ thuật cho một mã, dùng cho lệnh `!ptkt vic`.
//
// Không có mô hình ngôn ngữ nào ở đây, và đó là chủ ý: cùng một chuỗi nến thì ra cùng một nhận
// định, và mọi con số đều tính lại được bằng tay. Các bước theo đúng thứ tự một người đọc chart
// đi qua — xu hướng theo MA, động lượng theo RSI và MACD, dòng tiền theo khối lượng, biên độ theo
// Bollinger, vùng giá theo đỉnh đáy gần nhất, rồi đặt mã vào bối cảnh VN-Index. Mỗi bước cho một
// điểm; tổng điểm ra đánh giá, còn việc các bước có cùng chiều với nhau hay không ra độ tin cậy.
//
// Câu trả lời là **một hình kèm vài dòng chữ**, không phải một bài văn. Con số nằm trên hình, ngay
// cạnh thứ nó mô tả: MA là đường đi cùng nến, vùng mua là một dải tô, RSI có sẵn vạch 30 và 70.
// Chữ chỉ còn kết luận, điểm mua bán, và mỗi bước một cụm từ.
import { CHART, kindOf } from './dnse.mjs';
import { formatDay, tradingDay } from './chart.mjs';
import { money, vietnamNow } from './quote.mjs';

const TIMEOUT_MS = 8000;

/// Khoảng 300 phiên: đủ cho MA200 và cho vùng giá một năm, kể cả khi có kỳ nghỉ lễ dài.
const LOOKBACK_DAYS = 450;

/// Nến 5 phút của mấy ngày gần nhất: đủ để có phiên đang chạy, kể cả sau một kỳ nghỉ cuối tuần.
const INTRADAY_LOOKBACK_DAYS = 4;

/// MACD(12, 26, 9) cần chừng này cây nến mới có đường tín hiệu. Ít hơn thì không có gì để đọc.
export const MIN_SESSIONS = 35;

const INDEX = 'VNINDEX';
const YEAR_SESSIONS = 250;

/// Dưới mức giá trị giao dịch này mỗi phiên, vài lệnh lớn đủ vẽ lại cả chart.
const THIN_VALUE = 1e9;

/// Số phiên vẽ trên hình: khoảng bốn tháng — đủ thấy xu hướng, mà nến chưa mảnh tới mức không
/// còn phân biệt được nến rỗng với nến đặc khi xem trên điện thoại.
const DRAWN_SESSIONS = 80;

const VERDICT = { positive: 'TÍCH CỰC', negative: 'TIÊU CỰC', neutral: 'BÌNH THƯỜNG' };
const CONFIDENCE = { high: 'CAO', medium: 'TRUNG BÌNH', low: 'THẤP' };

const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

/// Bao nhiêu phiên gửi kèm cho trang vẽ chart — chừng ba tháng giao dịch.
const CARD_SESSIONS = 60;

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

  /// Nến 5 phút gần nhất. Chỉ để dựng cây nến của phiên đang chạy, nên hỏng thì coi như không có.
  async function intraday(symbol) {
    const to = Math.floor(now() / 1000);
    const from = to - INTRADAY_LOOKBACK_DAYS * 24 * 60 * 60;
    const url = `${base}/${kindOf(symbol)}?from=${from}&to=${to}&symbol=${symbol}&resolution=5`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
      return response.ok ? rowsFrom(await response.json()) : [];
    } catch {
      return [];
    }
  }

  /// Bài phân tích, hoặc `null` khi không phân tích được — kèm lý do, vì "không có mã ấy" và "mã
  /// mới lên sàn chưa đủ phiên" là hai chuyện người đọc cần phân biệt.
  async function study(symbol) {
    const code = String(symbol ?? '').toUpperCase();
    // VN-Index chỉ là bối cảnh: hỏng thì bỏ hai bước so với thị trường, không bỏ cả bài.
    const [rows, index, minutes, indexMinutes] = await Promise.all([
      daily(code),
      code === INDEX ? null : daily(INDEX).catch(() => null),
      intraday(code),
      code === INDEX ? [] : intraday(INDEX),
    ]);
    if (!rows.length) return { analysis: null, reason: `${code} — không có dữ liệu` };

    const analysis = analyze(code, withSession(rows, minutes), index && withSession(index, indexMinutes), { at: new Date(now()) });
    return {
      analysis,
      reason: analysis ? '' : `${code} chưa đủ ${MIN_SESSIONS} phiên giao dịch để phân tích kỹ thuật.`,
    };
  }

  return {
    /// Một tin nhắn có hình khi phân tích được; một dòng chữ khi không có gì để phân tích.
    async report(symbol) {
      const { analysis, reason } = await study(symbol);
      return analysis ? technicalRich(analysis) : reason;
    },

    /// Cùng bài ấy, dạng dữ liệu — cho trang widget, nơi hình SVG của tin nhắn không dùng được:
    /// trang tự vẽ lấy để chart theo màu nền người xem đang dùng và co giãn theo khung.
    async card(symbol) {
      const { analysis, reason } = await study(symbol);
      // `none` chứ không phải `reason`: bài phân tích **có** một trường `reason` rồi — lý do của mức
      // tin cậy — và hai chữ giống nhau mang hai nghĩa là chỗ trang đọc nhầm cái này thành cái kia.
      return analysis ? technicalCard(analysis) : { none: reason };
    },
  };
}

/**
 * Nến ngày, thêm cây nến của phiên đang chạy khi nguồn nến ngày chưa có nó.
 *
 * Nến ngày của DNSE thường chỉ có phiên hôm nay sau khi sàn đóng cửa một lúc, nên giữa phiên một
 * bài phân tích dựng trên nó là bài của hôm qua. Nến 5 phút thì có ngay: gộp những cây của ngày
 * gần nhất thành một cây — mở cửa cây đầu, cao thấp là cực trị, đóng cửa cây cuối, khối lượng
 * cộng lại — và nối vào cuối. Ngày ấy đã có trong nến ngày thì nến ngày thắng, không đụng gì.
 */
export function withSession(dailyRows, minuteRows) {
  if (!dailyRows?.length || !minuteRows?.length) return dailyRows;
  const day = tradingDay(minuteRows.at(-1).time);
  if (tradingDay(dailyRows.at(-1).time) >= day) return dailyRows;

  const session = minuteRows.filter((row) => tradingDay(row.time) === day);
  if (!session.length) return dailyRows;
  return [...dailyRows, {
    time: session[0].time,
    open: session[0].open,
    high: Math.max(...session.map((row) => row.high)),
    low: Math.min(...session.map((row) => row.low)),
    close: session.at(-1).close,
    volume: session.reduce((sum, row) => sum + row.volume, 0),
  }];
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
  const series = {
    rows,
    ma20: sma(closes, 20),
    ma50: sma(closes, 50),
    ma200: sma(closes, 200),
    rsi: rsi(closes, 14),
    macd: macd(closes),
  };
  const ma20 = series.ma20[last];
  const averages = [
    { name: 'MA20', value: ma20 },
    { name: 'MA50', value: series.ma50[last] },
    { name: 'MA200', value: series.ma200[last] },
  ];
  const zones = levels(rows, close, atrValue);

  const trend = trendStep(close, averages);
  const steps = [
    trend,
    momentumStep(series.rsi[last]),
    macdStep(series.macd, last),
    volumeStep(live ? rows.slice(0, -1) : rows),
    bandStep(closes),
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
    zones,
    plan: plan(verdict, { close, atr: atrValue, ma20, zones }),
    series,
  };
}

/// Tin nhắn gửi đi: vài dòng chữ, và hình.
export function technicalRich(analysis) {
  const text = technicalMessage(analysis);
  return {
    text,
    image: {
      fileName: `ptkt-${analysis.symbol.toLowerCase()}-${analysis.day}.svg`,
      svg: technicalSvg(analysis),
    },
    rich: { blocks: [{ type: 'paragraph', text }] },
  };
}

/**
 * Bài phân tích dạng dữ liệu, cho trang widget.
 *
 * Cùng những con số mà `!ptkt` nói ra, nhưng để trang tự vẽ: hình SVG của tin nhắn là ảnh có nền
 * sáng cố định, còn widget chạy trong nền tối hay sáng tuỳ người xem và co giãn theo khung. Chuỗi
 * giá gửi kèm chỉ chừng ba tháng gần nhất — đủ để nhìn ra xu hướng, và mỗi mã thêm chưa tới 2 KB
 * vào gói đẩy.
 */
export function technicalCard(analysis, span = CARD_SESSIONS) {
  const rows = analysis.series.rows.slice(-span);
  const from = analysis.series.rows.length - rows.length;
  const trim = (list) => list.slice(from).map((value) => (Number.isFinite(value) ? round2(value) : null));

  return {
    day: formatDay(analysis.day),
    live: analysis.live ? 1 : 0,
    close: money(analysis.close),
    change: pct(analysis.change),
    up: analysis.change > 0 ? 1 : analysis.change < 0 ? -1 : 0,
    verdict: VERDICT[analysis.verdict],
    kind: analysis.verdict,
    confidence: CONFIDENCE[analysis.confidence],
    reason: analysis.reason,
    steps: analysis.steps.map((step) => [step.text, step.score]),
    plan: planLines(analysis.plan),
    zones: {
      supports: analysis.zones.supports.map(money),
      resistances: analysis.zones.resistances.map(money),
    },
    // Chuỗi để vẽ: nến, khối lượng và hai đường trung bình, cùng một mốc thời gian, cùng độ dài.
    // Gửi cả bốn giá mỗi phiên chứ không riêng giá đóng: một đường gấp khúc không nói được phiên
    // nào giằng co, phiên nào dứt khoát — mà đó chính là thứ người ta mở chart ra để nhìn.
    chart: {
      open: rows.map((row) => round2(row.open)),
      high: rows.map((row) => round2(row.high)),
      low: rows.map((row) => round2(row.low)),
      close: rows.map((row) => round2(row.close)),
      // Khối lượng tính bằng nghìn cổ phiếu: chart chỉ cần tỉ lệ giữa các cột, mà số nguyên ngắn
      // hơn thì gói nhẹ hơn.
      volume: rows.map((row) => Math.round((row.volume ?? 0) / 1000)),
      ma20: trim(analysis.series.ma20),
      ma50: trim(analysis.series.ma50),
      // Mốc ngày đầu và cuối thôi: trục x của một chart ba tháng không cần nhãn nào khác.
      first: formatDay(tradingDay(rows[0].time)),
      last: formatDay(tradingDay(rows.at(-1).time)),
      // Hỗ trợ và kháng cự gần nhất, vẽ thành hai đường ngang.
      support: round2(analysis.zones.supports[0]),
      resistance: round2(analysis.zones.resistances[0]),
    },
  };
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;

export function technicalMessage(analysis) {
  const live = analysis.live ? ' (đang giao dịch)' : '';
  return [
    `PTKT ${analysis.symbol} · phiên ${formatDay(analysis.day)}${live} · ${money(analysis.close)} (${pct(analysis.change)})`,
    `${VERDICT[analysis.verdict]} · tin cậy ${CONFIDENCE[analysis.confidence]} (${analysis.reason})`,
    ...analysis.steps.map((step) => `- ${step.text}`),
    ...planLines(analysis.plan),
    'Tín hiệu tự động, không phải khuyến nghị đầu tư.',
  ].join('\n');
}

// ---- các bước -------------------------------------------------------------------------------

function trendStep(close, averages) {
  const known = averages.filter((average) => average.value != null);
  const above = known.filter((average) => close > average.value).map((average) => average.name);
  const below = known.filter((average) => close <= average.value).map((average) => average.name);
  const values = known.map((average) => average.value);
  const stackedUp = known.length >= 2 && !below.length && values.every((v, i) => i === 0 || values[i - 1] > v);
  const stackedDown = known.length >= 2 && !above.length && values.every((v, i) => i === 0 || values[i - 1] < v);

  const share = above.length / known.length;
  const score = stackedUp ? 2 : stackedDown ? -2 : share > 0.5 ? 1 : share < 0.5 ? -1 : 0;
  const label = { 2: 'tăng rõ', 1: 'nghiêng tăng', 0: 'đi ngang', '-1': 'nghiêng giảm', '-2': 'giảm rõ' }[score];
  const where = [
    above.length && `trên ${above.join(', ')}`,
    below.length && `dưới ${below.join(', ')}`,
  ].filter(Boolean).join('; ');

  return { key: 'trend', score, text: `Xu hướng ${label}: giá ${where}` };
}

function momentumStep(value) {
  if (value == null) return null;
  const [score, meaning] = value >= 70 ? [-1, 'quá mua, dễ rung lắc']
    : value >= 55 ? [1, 'tích cực']
      : value >= 45 ? [0, 'trung tính']
        : value >= 30 ? [-1, 'yếu']
          : [0, 'quá bán, chờ tín hiệu đảo chiều'];
  return { key: 'rsi', score, text: `RSI ${Math.round(value)}: ${meaning}` };
}

function macdStep({ line, histogram }, last) {
  const now = histogram[last];
  const before = histogram[last - 1];
  if (now == null || before == null) return null;

  let crossed = null;
  for (let back = 0; back < 3 && histogram[last - back - 1] != null; back++) {
    const here = histogram[last - back];
    if (here !== 0 && Math.sign(here) !== Math.sign(histogram[last - back - 1])) {
      crossed = { up: here > 0 };
      break;
    }
  }

  const score = Math.sign(now);
  const strong = Math.abs(now) > Math.abs(before) || Boolean(crossed);
  const positiveZone = line[last] >= 0;
  // Cùng một histogram dương mà nằm dưới mốc 0 thì chỉ là nhịp hồi trong vùng yếu, chưa phải
  // động lượng tăng; histogram âm trên mốc 0 là điều chỉnh trong vùng khoẻ, chưa phải đà giảm.
  const meaning = score > 0
    ? positiveZone
      ? (strong ? 'động lượng tăng' : 'động lượng tăng chậm lại')
      : (strong ? 'hồi phục từ vùng yếu' : 'nhịp hồi yếu dần')
    : score < 0
      ? positiveZone
        ? (strong ? 'động lượng tăng suy yếu' : 'điều chỉnh nhẹ trong vùng khoẻ')
        : (strong ? 'động lượng giảm' : 'đà giảm chậm lại')
      : 'chưa rõ';
  const cross = crossed ? ` (vừa cắt ${crossed.up ? 'lên' : 'xuống'})` : '';

  return { key: 'macd', score, text: `MACD: ${meaning}${cross}` };
}

function volumeStep(rows) {
  if (rows.length < 26) return null;
  const count = rows.length;
  const recent = mean(rows.slice(-5).map((row) => row.volume));
  const base = mean(rows.slice(-25, -5).map((row) => row.volume));
  if (!(base > 0)) return null;

  const ratio = recent / base;
  const moved = changeOver(rows.map((row) => row.close), 5);
  const [score, meaning] = ratio >= 1.3 && moved > 0 ? [1, 'tiền vào xác nhận đà tăng']
    : ratio >= 1.3 && moved < 0 ? [-1, 'bán mạnh khi giá giảm']
      : ratio <= 0.7 ? [0, 'cạn thanh khoản']
        : [0, 'ổn định'];

  return {
    key: 'volume',
    score,
    text: `Khối lượng: ${meaning} (${one.format(ratio)} lần TB20)`,
    // Để hình tô đậm đúng năm phiên đã đem ra so, và kẻ đúng đường trung bình đã dùng.
    window: { base, recentFrom: count - 5, baseFrom: count - 25, last: count - 1 },
  };
}

function bandStep(closes) {
  const widths = [];
  for (let end = Math.max(20, closes.length - 120); end <= closes.length; end++) {
    const { middle, deviation } = band(closes.slice(end - 20, end));
    if (middle > 0) widths.push((4 * deviation) / middle);
  }
  const { middle, deviation } = band(closes.slice(-20));
  const upper = middle + 2 * deviation;
  const lower = middle - 2 * deviation;
  const position = deviation === 0 ? 0.5 : (closes.at(-1) - lower) / (upper - lower);

  const where = position > 1 ? 'vượt dải trên, dễ điều chỉnh ngắn'
    : position < 0 ? 'thủng dải dưới, dễ hồi ngắn'
      : position >= 0.5 ? 'giá ở nửa trên dải'
        : 'giá ở nửa dưới dải';
  const squeeze = widths.length >= 60
    && widths.at(-1) <= [...widths].sort((a, b) => a - b)[Math.floor(widths.length * 0.2)];

  return { key: 'band', score: 0, text: `Bollinger: ${where}${squeeze ? ', dải đang nén, sắp biến động mạnh' : ''}` };
}

function yearStep(rows, close, trendScore) {
  const recent = rows.slice(-YEAR_SESSIONS);
  const high = Math.max(...recent.map((row) => row.high));
  const low = Math.min(...recent.map((row) => row.low));
  const fromHigh = pctChange(high, close);
  const fromLow = pctChange(low, close);

  const [score, note] = fromHigh >= -5 && trendScore > 0 ? [1, ', sát đỉnh: cổ phiếu khoẻ']
    : fromLow <= 5 && trendScore < 0 ? [-1, ', sát đáy: chưa có lực đỡ']
      : [0, ''];
  const span = recent.length >= YEAR_SESSIONS ? '1 năm' : `${recent.length} phiên`;

  return { key: 'year', score, text: `Cách đỉnh ${span} ${pctShort(fromHigh)}${note}` };
}

function relativeStep(symbol, closes, indexCloses) {
  const own = changeOver(closes, 20);
  const market = changeOver(indexCloses, 20);
  const gap = own - market;
  const label = gap > 3 ? 'Mạnh hơn' : gap < -3 ? 'Yếu hơn' : 'Đi cùng';
  return {
    key: 'relative',
    score: gap > 3 ? 1 : gap < -3 ? -1 : 0,
    text: `${label} VN-Index 20 phiên: ${pctShort(own)} so với ${pctShort(market)}`,
  };
}

function marketStep(closes) {
  const last = closes.length - 1;
  const close = closes[last];
  const ma20 = sma(closes, 20)[last];
  const ma50 = sma(closes, 50)[last] ?? ma20;
  const score = close > ma50 && ma20 > ma50 ? 1 : close < ma50 && ma20 < ma50 ? -1 : 0;
  const meaning = score > 0 ? 'thuận lợi' : score < 0 ? 'bất lợi, nên phòng thủ' : 'giằng co';
  return { key: 'market', score, text: `Thị trường chung: ${meaning}` };
}

function confidenceOf(verdict, steps, { sessions, thin }) {
  const up = steps.filter((step) => step.score > 0).length;
  const down = steps.filter((step) => step.score < 0).length;
  const total = Math.abs(steps.reduce((sum, step) => sum + step.score, 0));

  let confidence;
  let reason;
  if (verdict === 'neutral') {
    confidence = up >= 2 && down >= 2 ? 'low' : 'medium';
    reason = up && down ? `tín hiệu trái chiều: ${up} tốt, ${down} xấu` : 'ít tín hiệu rõ ràng';
  } else {
    const agree = verdict === 'positive' ? up : down;
    const against = verdict === 'positive' ? down : up;
    confidence = against >= 3 ? 'low' : total >= 5 && against <= 1 ? 'high' : 'medium';
    reason = `${agree}/${agree + against} tín hiệu cùng chiều`;
  }

  if (sessions < 120) {
    confidence = 'low';
    reason += `, mới có ${sessions} phiên`;
  }
  if (thin) {
    confidence = 'low';
    reason += ', thanh khoản thấp';
  }
  return { confidence, reason };
}

/**
 * Điểm mua, bán, cắt lỗ — dưới dạng con số, để chữ và hình cùng đọc từ một chỗ.
 *
 * Tích cực: mua ở vùng hỗ trợ (hoặc khi vượt kháng cự), chốt lời ở kháng cự. Tiêu cực: chưa mua,
 * bán khi hồi về MA20 hoặc kháng cự gần nhất. Bình thường: mua thăm dò ở hỗ trợ, bán ở kháng cự.
 * Cắt lỗ luôn nằm dưới hỗ trợ nửa ATR, để một cú rung bình thường không quét mất vị thế.
 *
 * Mục tiêu chốt lời phải cách giá đủ xa mới đáng gọi là mục tiêu: một kháng cự chỉ cao hơn giá
 * vài trăm đồng là mốc để **vượt qua**, không phải chỗ để bán. Không còn kháng cự nào đủ xa thì
 * lấy hai lần ATR.
 */
function plan(verdict, { close, atr: atrValue, ma20, zones }) {
  const support = zones.supports[0];
  const [first] = zones.resistances;
  const stop = floorTick(support - 0.5 * atrValue);
  const beyond = (distance) => {
    const far = zones.resistances.filter((value) => value >= close + distance * atrValue).slice(0, 2);
    return (far.length ? far : [close + 2 * atrValue]).map(roundTick);
  };

  if (verdict === 'positive') {
    const near = close - support <= atrValue;
    const buy = [roundTick(support), roundTick(near ? close : support + 0.5 * atrValue)];
    const entry = mean(buy);
    const targets = beyond(1);
    return {
      verdict,
      buy,
      breakout: roundTick(first),
      targets,
      stop,
      risk: pctChange(entry, stop),
      reward: (targets[0] - entry) / Math.max(entry - stop, Number.EPSILON),
    };
  }

  if (verdict === 'negative') {
    const reclaim = ma20 != null && ma20 > close && ma20 < first
      ? { value: roundTick(ma20), name: 'MA20' }
      : { value: roundTick(first), name: 'kháng cự' };
    return { verdict, reclaim, sell: [reclaim.value], stop };
  }

  return {
    verdict,
    buy: [roundTick(support), roundTick(Math.min(close, support + 0.5 * atrValue))],
    sell: beyond(0.5),
    stop,
  };
}

function planLines(plan) {
  const stop = `Cắt lỗ: ${money(plan.stop)}`;
  if (plan.verdict === 'positive') {
    return [
      `Mua: ${range(plan.buy)} hoặc khi vượt ${money(plan.breakout)}`,
      `Chốt lời: ${plan.targets.map(money).join(' · ')} · ${stop} (${pctShort(plan.risk)}) · R:R ${one.format(plan.reward)}`,
    ];
  }
  if (plan.verdict === 'negative') {
    return [
      `Mua: chưa, chờ lấy lại ${money(plan.reclaim.value)} (${plan.reclaim.name})`,
      `Bán: khi hồi về ${money(plan.sell[0])} · ${stop}`,
    ];
  }
  return [
    `Mua thăm dò: ${range(plan.buy)} · Bán: ${plan.sell.map(money).join(' · ')}`,
    stop,
  ];
}

// ---- vùng giá ----------------------------------------------------------------------------------

/**
 * Hỗ trợ và kháng cự từ đỉnh đáy cục bộ của 120 phiên gần nhất.
 *
 * Một đỉnh là cây nến có giá cao nhất trong ba cây mỗi bên; đáy tương tự. Hai mức gần nhau hơn
 * nửa ATR là một vùng, không phải hai. Không có đáy nào dưới giá (vừa lập đáy mới) hay đỉnh nào
 * trên giá (vừa lập đỉnh mới) thì lấy hai lần ATR.
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
  const resistances = distinct(highs.filter((price) => price > close).sort((a, b) => a - b), gap).slice(0, 3);

  return {
    supports: supports.length ? supports : [close - 2 * atrValue],
    resistances: resistances.length ? resistances : [close + 2 * atrValue],
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

// ---- hình ----------------------------------------------------------------------------------------
//
// Bốn ô xếp dọc, chung một trục ngày: giá, khối lượng, RSI, MACD. Không có ô nào mang hai thang
// giá trị — hai thước đo khác đơn vị là hai ô, không phải một ô hai trục.
//
// Nến tăng **rỗng**, nến giảm **đặc**. Xanh với đỏ là quy ước của bảng điện nên giữ, nhưng với
// người mù màu đỏ-lục thì hai màu ấy gần như một; hình dạng nói được điều màu không nói được.

const W = 1000;
const H = 1300;
const SCALE = 2;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const PLOT = { left: 84, right: 770 };
const TAG = { x: 788, width: 198, height: 30, gap: 36 };
const PANELS = {
  price: { top: 252, bottom: 740 },
  volume: { top: 798, bottom: 878 },
  rsi: { top: 934, bottom: 1034 },
  macd: { top: 1090, bottom: 1190 },
};

const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const SECONDARY = '#52514e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const UP = '#0b6b2f';
const DOWN = '#f0605d';
const CAUTION = '#ec835a';
const FAST = '#2a78d6';
const SLOW = '#eb6834';
const LONG = '#4a3aa7';
const BADGE = { positive: UP, negative: DOWN, neutral: '#76746e' };

export function technicalSvg(analysis) {
  const { rows } = analysis.series;
  const count = Math.min(DRAWN_SESSIONS, rows.length);
  const start = rows.length - count;
  const slot = (PLOT.right - PLOT.left) / count;
  const view = {
    start,
    end: rows.length - 1,
    slot,
    bar: Math.max(2, slot * 0.62),
    x: (index) => PLOT.left + slot * (index - start + 0.5),
  };
  view.dates = [0, 0.25, 0.5, 0.75, 1].map((share) => start + Math.round(share * (count - 1)));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  ${headerSvg(analysis)}
  ${legendSvg()}
  ${priceSvg(analysis, view)}
  ${volumeSvg(analysis, view)}
  ${rsiSvg(analysis, view)}
  ${macdSvg(analysis, view)}
  ${view.dates.map((index) => `<text x="${r(view.x(index))}" y="${PANELS.macd.bottom + 30}" text-anchor="middle" font-size="19" fill="${MUTED}">${shortDate(rows[index].time)}</text>`).join('')}
  <text x="${PLOT.left}" y="${H - 28}" font-size="19" fill="${MUTED}">Tín hiệu tự động từ giá và khối lượng, không phải khuyến nghị đầu tư.</text>
</svg>`;
}

function headerSvg(analysis) {
  const arrow = analysis.change > 0 ? '▲' : analysis.change < 0 ? '▼' : '▬';
  const arrowColor = analysis.change > 0 ? UP : analysis.change < 0 ? DOWN : MUTED;
  const label = VERDICT[analysis.verdict];
  const badge = Math.round(label.length * 16.5 + 48);
  const session = `Phân tích kỹ thuật · phiên ${formatDay(analysis.day)}${analysis.live ? ' · đang giao dịch' : ''}`;

  return `<text x="36" y="74" fill="${INK}"><tspan font-size="52" font-weight="800">${escapeXml(analysis.symbol)}</tspan><tspan dx="22" font-size="40" font-weight="600">${money(analysis.close)}</tspan><tspan dx="14" font-size="26" fill="${arrowColor}">${arrow}</tspan><tspan dx="6" font-size="28" fill="${SECONDARY}">${pct(analysis.change)}</tspan></text>
  <text x="36" y="116" font-size="24" fill="${SECONDARY}">${escapeXml(session)}</text>
  <rect x="36" y="138" width="${badge}" height="46" rx="23" fill="${BADGE[analysis.verdict]}"/>
  <text x="${36 + badge / 2}" y="169" text-anchor="middle" font-size="24" font-weight="800" fill="#ffffff">${label}</text>
  <text x="${36 + badge + 18}" y="169" font-size="24" fill="${INK}"><tspan font-weight="700">Tin cậy ${CONFIDENCE[analysis.confidence]}</tspan><tspan fill="${SECONDARY}"> · ${escapeXml(analysis.reason)}</tspan></text>`;
}

function legendSvg() {
  const y = 222;
  const lineKey = (x, color, text) => `<line x1="${x}" y1="${y - 7}" x2="${x + 30}" y2="${y - 7}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
  <text x="${x + 40}" y="${y}" font-size="20" fill="${SECONDARY}">${text}</text>`;
  return `<rect x="${PLOT.left}" y="${y - 20}" width="10" height="18" fill="${SURFACE}" stroke="${UP}" stroke-width="2"/>
  <text x="${PLOT.left + 18}" y="${y}" font-size="20" fill="${SECONDARY}">Tăng</text>
  <rect x="${PLOT.left + 84}" y="${y - 20}" width="10" height="18" fill="${DOWN}"/>
  <text x="${PLOT.left + 102}" y="${y}" font-size="20" fill="${SECONDARY}">Giảm</text>
  ${lineKey(PLOT.left + 184, FAST, 'MA20')}
  ${lineKey(PLOT.left + 314, SLOW, 'MA50')}
  ${lineKey(PLOT.left + 444, LONG, 'MA200')}`;
}

function priceSvg(analysis, view) {
  const { top, bottom } = PANELS.price;
  const { rows, ma20, ma50, ma200 } = analysis.series;
  const marks = planMarks(analysis.plan);

  // Thang giá theo nến, MA20, MA50 và các mức mua bán — **không** theo MA200. MA200 có thể nằm
  // cách giá cả chục phần trăm, và kéo thang theo nó thì nến bị ép vào một góc ô. Nó vẫn được vẽ,
  // cắt ở mép ô, và khi ra ngoài khung thì có một dòng nói nó đang ở đâu.
  const values = [];
  for (let i = view.start; i <= view.end; i++) {
    values.push(rows[i].high, rows[i].low);
    for (const average of [ma20, ma50]) if (average[i] != null) values.push(average[i]);
  }
  for (const mark of marks) values.push(...(mark.zone ?? [mark.value]));
  const [min, max] = padded(Math.min(...values), Math.max(...values));
  const y = (value) => top + ((max - value) / (max - min)) * (bottom - top);

  const candles = [];
  for (let i = view.start; i <= view.end; i++) {
    const row = rows[i];
    const x = r(view.x(i));
    const rising = row.close >= row.open;
    const color = rising ? UP : DOWN;
    const bodyTop = y(Math.max(row.open, row.close));
    const bodyBottom = Math.max(y(Math.min(row.open, row.close)), bodyTop + 2);
    const left = r(view.x(i) - view.bar / 2);
    candles.push(rising
      ? `<line x1="${x}" y1="${r(y(row.high))}" x2="${x}" y2="${r(bodyTop)}" stroke="${color}" stroke-width="1.6"/><line x1="${x}" y1="${r(bodyBottom)}" x2="${x}" y2="${r(y(row.low))}" stroke="${color}" stroke-width="1.6"/><rect x="${left}" y="${r(bodyTop)}" width="${r(view.bar)}" height="${r(bodyBottom - bodyTop)}" fill="${SURFACE}" stroke="${color}" stroke-width="1.6"/>`
      : `<line x1="${x}" y1="${r(y(row.high))}" x2="${x}" y2="${r(y(row.low))}" stroke="${color}" stroke-width="1.6"/><rect x="${left}" y="${r(bodyTop)}" width="${r(view.bar)}" height="${r(bodyBottom - bodyTop)}" fill="${color}"/>`);
  }

  const tags = [...marks, { value: analysis.close, label: `Giá ${money(analysis.close)}`, color: INK }];
  const longLast = ma200[view.end];
  const longOutside = longLast != null && (longLast < min || longLast > max);
  const longNoteY = longLast < min ? bottom - 14 : top + 26;

  return `<g>
    ${ticks(min, max).map((tick) => `<line x1="${PLOT.left}" y1="${r(y(tick))}" x2="${PLOT.right}" y2="${r(y(tick))}" stroke="${GRID}" stroke-width="1"/>
    <text x="${PLOT.left - 10}" y="${r(y(tick) + 6)}" text-anchor="end" font-size="18" fill="${MUTED}">${money(tick)}</text>`).join('')}
    ${gridX(view, top, bottom)}
    ${marks.filter((mark) => mark.zone).map((mark) => `<rect x="${PLOT.left}" y="${r(y(mark.zone[1]))}" width="${PLOT.right - PLOT.left}" height="${r(Math.max(3, y(mark.zone[0]) - y(mark.zone[1])))}" fill="${mark.color}" opacity="0.14"/>`).join('')}
    ${candles.join('')}
    <clipPath id="price-plot"><rect x="${PLOT.left}" y="${top}" width="${PLOT.right - PLOT.left}" height="${bottom - top}"/></clipPath>
    <g clip-path="url(#price-plot)">
      ${path([ma200], view, y, LONG)}
      ${path([ma50], view, y, SLOW)}
      ${path([ma20], view, y, FAST)}
    </g>
    ${longOutside ? `<line x1="${PLOT.left + 12}" y1="${longNoteY - 6}" x2="${PLOT.left + 38}" y2="${longNoteY - 6}" stroke="${LONG}" stroke-width="4" stroke-linecap="round"/>
    <text x="${PLOT.left + 48}" y="${longNoteY}" font-size="18" fill="${SECONDARY}">MA200 ${money(longLast)} — ${longLast < min ? 'dưới' : 'trên'} khung</text>` : ''}
    ${marks.filter((mark) => !mark.zone).map((mark) => `<line x1="${PLOT.left}" y1="${r(y(mark.value))}" x2="${PLOT.right}" y2="${r(y(mark.value))}" stroke="${mark.color}" stroke-width="2.5" stroke-dasharray="12 8"/>`).join('')}
    <line x1="${PLOT.left}" y1="${bottom}" x2="${PLOT.right}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>
    ${tagsSvg(tags, y, top, bottom)}
  </g>`;
}

function volumeSvg(analysis, view) {
  const { top, bottom } = PANELS.volume;
  const { rows } = analysis.series;
  const step = analysis.steps.find((one) => one.key === 'volume');
  const window = step?.window;
  const highest = Math.max(1, ...rows.slice(view.start).map((row) => row.volume));
  const y = (value) => bottom - (value / highest) * (bottom - top);

  const bars = [];
  for (let i = view.start; i <= view.end; i++) {
    const compared = window && i >= window.recentFrom && i <= window.last;
    const height = Math.max(1, bottom - y(rows[i].volume));
    bars.push(`<rect x="${r(view.x(i) - view.bar / 2)}" y="${r(bottom - height)}" width="${r(view.bar)}" height="${r(height)}" fill="${compared ? SECONDARY : '#cfcdc6'}"/>`);
  }

  const average = window
    ? `<line x1="${r(view.x(Math.max(window.baseFrom, view.start)) - view.slot / 2)}" y1="${r(y(window.base))}" x2="${PLOT.right}" y2="${r(y(window.base))}" stroke="${INK}" stroke-width="2" stroke-dasharray="8 6"/>
    <text x="${TAG.x}" y="${r(y(window.base) + 6)}" font-size="18" fill="${SECONDARY}">TB20 · cột đậm: 5 phiên</text>`
    : '';

  return `<g>
    ${title(step?.text ?? 'Khối lượng', top)}
    ${gridX(view, top, bottom)}
    ${bars.join('')}
    ${average}
    <line x1="${PLOT.left}" y1="${bottom}" x2="${PLOT.right}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>
  </g>`;
}

function rsiSvg(analysis, view) {
  const { top, bottom } = PANELS.rsi;
  const values = analysis.series.rsi;
  const step = analysis.steps.find((one) => one.key === 'rsi');
  const y = (value) => top + ((100 - value) / 100) * (bottom - top);
  const last = values[view.end];

  return `<g>
    ${title(step?.text ?? 'RSI', top)}
    <rect x="${PLOT.left}" y="${r(y(70))}" width="${PLOT.right - PLOT.left}" height="${r(y(30) - y(70))}" fill="#f0efec"/>
    ${gridX(view, top, bottom)}
    ${[70, 30].map((level) => `<line x1="${PLOT.left}" y1="${r(y(level))}" x2="${PLOT.right}" y2="${r(y(level))}" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="8 6"/>`).join('')}
    <text x="${TAG.x}" y="${r(y(70) + 6)}" font-size="18" fill="${SECONDARY}">70 · quá mua</text>
    <text x="${TAG.x}" y="${r(y(30) + 6)}" font-size="18" fill="${SECONDARY}">30 · quá bán</text>
    ${[100, 50, 0].map((level) => `<text x="${PLOT.left - 10}" y="${r(y(level) + 6)}" text-anchor="end" font-size="18" fill="${MUTED}">${level}</text>`).join('')}
    ${path([values], view, y, FAST)}
    ${last != null ? `<circle cx="${r(view.x(view.end))}" cy="${r(y(last))}" r="6" fill="${FAST}" stroke="${SURFACE}" stroke-width="3"/>` : ''}
    <line x1="${PLOT.left}" y1="${bottom}" x2="${PLOT.right}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>
  </g>`;
}

function macdSvg(analysis, view) {
  const { top, bottom } = PANELS.macd;
  const { line, signal, histogram } = analysis.series.macd;
  const step = analysis.steps.find((one) => one.key === 'macd');

  const visible = [];
  for (let i = view.start; i <= view.end; i++) {
    for (const value of [line[i], signal[i], histogram[i]]) if (value != null) visible.push(Math.abs(value));
  }
  const reach = (Math.max(0, ...visible) || 1) * 1.1;
  const middle = (top + bottom) / 2;
  const y = (value) => middle - (value / reach) * ((bottom - top) / 2);

  const bars = [];
  for (let i = view.start; i <= view.end; i++) {
    if (histogram[i] == null) continue;
    const edge = y(histogram[i]);
    bars.push(`<rect x="${r(view.x(i) - view.bar / 2)}" y="${r(Math.min(edge, middle))}" width="${r(view.bar)}" height="${r(Math.max(1, Math.abs(edge - middle)))}" fill="${histogram[i] >= 0 ? UP : DOWN}" opacity="0.55"/>`);
  }

  const key = (offset, color, text) => `<line x1="${TAG.x}" y1="${top + offset - 6}" x2="${TAG.x + 26}" y2="${top + offset - 6}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
    <text x="${TAG.x + 36}" y="${top + offset}" font-size="18" fill="${SECONDARY}">${text}</text>`;

  return `<g>
    ${title(step?.text ?? 'MACD', top)}
    ${gridX(view, top, bottom)}
    <line x1="${PLOT.left}" y1="${r(middle)}" x2="${PLOT.right}" y2="${r(middle)}" stroke="${AXIS}" stroke-width="1"/>
    <text x="${PLOT.left - 10}" y="${r(middle + 6)}" text-anchor="end" font-size="18" fill="${MUTED}">0</text>
    ${bars.join('')}
    ${path([signal], view, y, SLOW)}
    ${path([line], view, y, FAST)}
    ${key(22, FAST, 'MACD')}
    ${key(52, SLOW, 'Tín hiệu')}
    ${key(82, UP, 'Histogram')}
  </g>`;
}

function planMarks(plan) {
  const marks = [];
  if (plan.buy) marks.push({ zone: plan.buy, value: mean(plan.buy), label: `Mua ${range(plan.buy)}`, color: UP });
  for (const target of plan.targets ?? []) marks.push({ value: target, label: `Chốt lời ${money(target)}`, color: UP });
  for (const sell of plan.sell ?? []) marks.push({ value: sell, label: `Bán ${money(sell)}`, color: CAUTION });
  marks.push({ value: plan.stop, label: `Cắt lỗ ${money(plan.stop)}`, color: DOWN });
  return marks;
}

/// Nhãn ở mép phải, mỗi nhãn nối về đúng mức giá của nó; nhãn gần nhau thì đẩy dãn ra.
function tagsSvg(tags, y, top, bottom) {
  const placed = tags.map((tag) => ({ ...tag, at: y(tag.value) })).sort((a, b) => a.at - b.at);
  placed.forEach((tag, i) => {
    tag.y = Math.max(tag.at, i ? placed[i - 1].y + TAG.gap : top + TAG.height / 2);
  });
  for (let i = placed.length - 1; i >= 0; i--) {
    const limit = i === placed.length - 1 ? bottom - TAG.height / 2 : placed[i + 1].y - TAG.gap;
    placed[i].y = Math.min(placed[i].y, limit);
  }

  return placed.map((tag) => `<polyline points="${PLOT.right},${r(tag.at)} ${PLOT.right + 8},${r(tag.at)} ${TAG.x},${r(tag.y)}" fill="none" stroke="${tag.color}" stroke-width="2"/>
    <rect x="${TAG.x}" y="${r(tag.y - TAG.height / 2)}" width="${TAG.width}" height="${TAG.height}" rx="6" fill="#ffffff" stroke="${AXIS}" stroke-width="1"/>
    <rect x="${TAG.x}" y="${r(tag.y - TAG.height / 2)}" width="7" height="${TAG.height}" rx="3" fill="${tag.color}"/>
    <text x="${TAG.x + 16}" y="${r(tag.y + 6)}" font-size="18" font-weight="600" fill="${INK}">${escapeXml(tag.label)}</text>`).join('');
}

function title(text, top) {
  return `<text x="${PLOT.left}" y="${top - 14}" font-size="22" font-weight="600" fill="${INK}">${escapeXml(text)}</text>`;
}

function gridX(view, top, bottom) {
  return view.dates.map((index) => `<line x1="${r(view.x(index))}" y1="${top}" x2="${r(view.x(index))}" y2="${bottom}" stroke="${GRID}" stroke-width="1"/>`).join('');
}

function path([values], view, y, color) {
  let d = '';
  let open = false;
  for (let i = view.start; i <= view.end; i++) {
    if (values[i] == null) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${r(view.x(i))},${r(y(values[i]))}`;
    open = true;
  }
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : '';
}

function padded(min, max) {
  const pad = (max - min) * 0.06 || max * 0.02 || 1;
  return [min - pad, max + pad];
}

function ticks(min, max, count = 5) {
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  const out = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) out.push(Number(value.toFixed(6)));
  return out;
}

function shortDate(seconds) {
  const [, month, date] = tradingDay(seconds).split('-');
  return `${date}/${month}`;
}

function r(value) {
  return Math.round(value * 10) / 10;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

export function roundTick(price) {
  const tick = tickOf(price);
  return Number((Math.round(price / tick) * tick).toFixed(2));
}

export function floorTick(price) {
  const tick = tickOf(price);
  return Number((Math.floor(price / tick + 1e-9) * tick).toFixed(2));
}

function range([from, to]) {
  return from === to ? money(from) : `${money(from)}–${money(to)}`;
}

function pct(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(Math.abs(value))}%`;
}

function pctShort(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${one.format(Math.abs(value))}%`;
}
