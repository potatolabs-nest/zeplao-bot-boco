// Lọc mã hồi phục từ đáy, cho lệnh `!hoiphuc`.
//
// `!manh` mua mã dẫn dắt gần đỉnh, và nó gần như vô dụng khi thị trường điều chỉnh: mã dẫn dắt khi
// ấy cũng đi kém VN-Index. Lệnh này làm điều ngược lại — tìm mã đang ở xa đỉnh, vừa tạo đáy xong,
// để kiếm một nhịp 8–10% rồi bán trước khi chạm kháng cự. Hai lệnh không chồng nhau: một mã đi
// hết đường hồi phục, lấy lại MA200 và về gần đỉnh, là lúc nó chuyển sang `!manh`.
//
// Bắt đáy là trò dễ bắt dao rơi, nên "đã tạo đáy" phải là thứ đo được, không phải cảm giác:
//
//   1. Bối cảnh downtrend — giá dưới MA200, hoặc cách đỉnh 52 tuần từ 25%.
//   2. Đáy chính — thấp nhất 60 phiên, cách hiện tại ít nhất 10 phiên, chưa bị phá.
//   3. Đáy sau cao hơn đáy trước — có một nhịp chỉnh sâu từ 3% sau đáy chính mà không thủng nó.
//   4. Giá trên MA20, và MA20 đã quay lên.
//
// Đạt cả bốn là "đã xác nhận đáy". Điểm mua là **pivot** — đỉnh cao nhất kể từ đáy chính — vượt
// lên với khối lượng. Cắt lỗ dưới đáy sau: thủng nó thì luận điểm "đã tạo đáy" sai. Chốt lời trước
// kháng cự gần nhất (MA50, MA200, đỉnh cũ), không quá +10% — và kháng cự gần hơn 8% thì không vào,
// vì không đủ chỗ cho mục tiêu.
//
// File này không biết gì về mạng: vào là nến ngày, ra là con số và câu chữ.
import { atr, floorTick, roundTick, rsi, sma } from './technical.mjs';
import { formatDay } from './chart.mjs';
import { money } from './quote.mjs';
import { dayOf, heading, indexDays, marketOf, settled, spikeTag, volumeNote } from './strength.mjs';
import { pulseLines, pulseOf } from './pulse.mjs';

export const DEFAULTS = {
  /// Thanh khoản: KL TB20 từ chừng này cổ, hoặc giá trị TB20 từ chừng này đồng — như `!manh`.
  minVolume20: 300_000,
  minValue20: 10e9,

  // ---- Xác nhận đáy ----
  /// Bối cảnh downtrend: giá dưới MA200, hoặc cách đỉnh 52 tuần từ chừng này (%).
  minFromHigh: 25,
  /// Đáy chính là đáy thấp nhất `bottomLookback` phiên, cách hiện tại ít nhất `minBottomAge` phiên.
  bottomLookback: 60,
  minBottomAge: 10,
  /// Đáy sau: một đáy cục bộ (thấp nhất `wing` phiên mỗi bên), sau đáy chính ít nhất `minGap` phiên,
  /// không thấp hơn đáy chính, và giá đã chỉnh từ đỉnh trước nó ít nhất `minPullback`%.
  wing: 3,
  minGap: 5,
  minPullback: 3,
  /// MA20 "quay lên": cao hơn chính nó `ma20Sessions` phiên trước.
  ma20Sessions: 5,

  // ---- Điểm mua ----
  /// Vùng chờ mua: từ dưới pivot chừng này (%) tới trên pivot `buyAbove`%.
  buyBelow: 5,
  buyAbove: 3,
  /// Vượt pivot: đóng cửa trên pivot, KL từ chừng này lần TB20.
  breakoutVolume: 1.5,

  // ---- Bán ----
  /// Kháng cự gần hơn chừng này (%) trên điểm mua thì coi như bị phiên vượt pivot ăn mất, bỏ qua.
  resistanceSkip: 2,
  /// MA50 có tính là kháng cự không (1/0), và đỉnh cũ là cao nhất bao nhiêu phiên mỗi bên — số
  /// càng lớn thì chỉ đỉnh càng rõ mới được tính.
  ma50Resistance: 1,
  peakWing: 5,
  /// Chốt lời trước kháng cự nửa ATR, nhưng không quá `maxGain`%. Kháng cự gần đến mức mục tiêu dưới
  /// `minGain`% thì không vào: không đủ chỗ cho một nhịp 8–10%.
  minGain: 8,
  maxGain: 10,
  /// Lãi tới mục tiêu phải gấp ít nhất chừng này lần rủi ro tới cắt lỗ.
  minRR: 1.5,
};

/// Đủ cho MA200 và đỉnh 52 tuần.
export const MIN_SESSIONS = 250;

export const BOTTOM = [
  { key: 'context', name: 'Đang downtrend', short: 'downtrend' },
  { key: 'bottom', name: 'Đáy chính đã giữ', short: 'đáy chính' },
  { key: 'higherLow', name: 'Đáy sau cao hơn', short: 'đáy sau cao hơn' },
  { key: 'repair', name: 'Giá trên MA20, MA20 quay lên', short: 'MA20 quay lên' },
];

/// Tiêu chí tham khảo: in ra, đếm điểm, nhưng không loại mã nào — backtest sẽ nói cái nào đáng giữ.
export const SIGNS = [
  { key: 'divergence', name: 'RSI phân kỳ dương', short: 'phân kỳ RSI' },
  { key: 'rsi50', name: 'RSI từ 50', short: 'RSI ≥ 50' },
  { key: 'dryRetest', name: 'KL cạn ở đáy sau', short: 'cạn cung ở đáy sau' },
  { key: 'rsUp', name: 'Mạnh hơn VN-Index 20 phiên', short: 'mạnh hơn VNI' },
];

export const STATUS = {
  breakout: 'vượt pivot',
  setup: 'sát pivot',
  extended: 'đã chạy xa pivot',
  building: 'còn xa pivot',
  cramped: 'kháng cự quá gần',
  wide: 'cắt lỗ quá xa',
};

/**
 * Chấm một mã. `index` là `indexDays(...)`; `at` để bỏ cây nến phiên đang chạy, `null` cho backtest.
 * `null` khi chưa đủ phiên.
 */
export function rebound(symbol, rows, index, { at = new Date(), ...options } = {}) {
  const o = { ...DEFAULTS, ...options };
  const own = at === null ? rows : settled(rows, at);
  if (own.length < MIN_SESSIONS) return null;

  const L = own.length - 1;
  const closes = own.map((row) => row.close);
  const volumes = own.map((row) => row.volume);
  const close = closes[L];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const strength = rsi(closes, 14);
  const atrValue = atr(own, 14)[L];
  const vol20 = mean(volumes.slice(-20));
  const value20 = vol20 * close * 1000;
  const liquidity = {
    pass: vol20 >= o.minVolume20 || value20 >= o.minValue20,
    text: `KL TB20 ${count(vol20)} cổ · ${fmt(value20 / 1e9)} tỷ/phiên`,
  };
  const checks = {};
  const signs = {};

  // 1. Bối cảnh downtrend.
  const high52 = Math.max(...own.slice(-250).map((row) => row.high));
  const fromHigh = pct(high52, close);
  checks.context = {
    pass: close < ma200[L] || fromHigh <= -o.minFromHigh,
    text: `giá ${money(close)} · MA200 ${money(ma200[L])} · cách đỉnh 52 tuần ${signed(fromHigh)}`,
  };

  // 2. Đáy chính.
  let b1 = L;
  for (let i = L - o.bottomLookback + 1; i <= L; i++) if (own[i].low < own[b1].low) b1 = i;
  const low1 = own[b1].low;
  const age = L - b1;
  checks.bottom = {
    pass: age >= o.minBottomAge,
    text: `đáy ${money(low1)} ngày ${formatDay(dayOf(own[b1]))}, ${age} phiên trước`,
  };

  // 3. Đáy sau cao hơn: đáy cục bộ gần nhất sau đáy chính, có nhịp chỉnh thật từ đỉnh trước nó.
  let b2 = null;
  let neckline = null;
  for (let i = L - o.wing; i >= b1 + o.minGap; i--) {
    const around = own.slice(i - o.wing, i + o.wing + 1);
    if (own[i].low !== Math.min(...around.map((row) => row.low)) || own[i].low < low1) continue;
    const peak = Math.max(...own.slice(b1 + 1, i).map((row) => row.high));
    if (pct(peak, own[i].low) <= -o.minPullback) {
      b2 = i;
      neckline = peak;
      break;
    }
  }
  checks.higherLow = b2 === null
    ? { pass: false, text: 'chưa có nhịp chỉnh nào giữ được trên đáy chính' }
    : {
      pass: true,
      text: `đáy sau ${money(own[b2].low)} (${signed(pct(low1, own[b2].low))} so đáy chính), chỉnh ${signed(pct(neckline, own[b2].low))} từ ${money(neckline)}`,
    };

  // 4. Giá lấy lại MA20, MA20 quay lên.
  const ma20Slope = pct(ma20[L - o.ma20Sessions], ma20[L]);
  checks.repair = {
    pass: close > ma20[L] && ma20Slope > 0,
    text: `giá ${close > ma20[L] ? 'trên' : 'dưới'} MA20 ${money(ma20[L])} · MA20 ${signed(ma20Slope)} ${o.ma20Sessions} phiên`,
  };

  // ---- Dấu hiệu tham khảo ----
  if (b2 !== null) {
    const r1 = strength[b1];
    const r2 = strength[b2];
    signs.divergence = {
      pass: r1 != null && r2 != null && r2 > r1,
      text: `RSI ở đáy chính ${fmt(r1 ?? 0)}, ở đáy sau ${fmt(r2 ?? 0)}`,
    };
    const near = (i) => mean(volumes.slice(Math.max(0, i - 2), i + 3));
    const ratio = near(b1) > 0 ? near(b2) / near(b1) : 1;
    signs.dryRetest = { pass: ratio < 0.8, text: `KL quanh đáy sau bằng ${fmt(ratio * 100)}% quanh đáy chính` };
  } else {
    signs.divergence = { pass: false, text: 'chưa có đáy sau' };
    signs.dryRetest = { pass: false, text: 'chưa có đáy sau' };
  }
  signs.rsi50 = { pass: strength[L] >= 50, text: `RSI ${fmt(strength[L] ?? 0)}` };
  const market0 = index.get(dayOf(own[L - 20]));
  const market1 = index.get(dayOf(own[L]));
  const marketMove = market0 > 0 && market1 > 0 ? pct(market0, market1) : null;
  const ownMove = pct(closes[L - 20], close);
  signs.rsUp = marketMove == null
    ? { pass: false, text: 'thiếu dữ liệu VN-Index' }
    : { pass: ownMove > marketMove, text: `${signed(ownMove)} so với VN-Index ${signed(marketMove)} trong 20 phiên` };

  // ---- Điểm mua, cắt lỗ, chốt lời ----
  // Pivot là đỉnh cao nhất kể từ đáy chính, không tính phiên gần nhất — để phiên ấy vượt được nó.
  const pivot = Math.max(...own.slice(b1 + 1, L).map((row) => row.high), own[b1].high);
  const toPivot = pct(pivot, close);
  const entry = Math.max(close, pivot);
  const stopBase = b2 !== null ? own[b2].low : low1;
  const stop = floorTick(stopBase - 0.2 * atrValue);
  const risk = pct(entry, stop) * -1;

  const resistances = resistancesAbove(own, entry * (1 + o.resistanceSkip / 100), [
    o.ma50Resistance ? { name: 'MA50', value: ma50[L] } : null,
    { name: 'MA200', value: ma200[L] },
  ].filter(Boolean), o.peakWing);
  const next = resistances[0] ?? null;
  const cap = entry * (1 + o.maxGain / 100);
  const beforeNext = next ? next.value - 0.5 * atrValue : Infinity;
  const target = roundTick(Math.min(cap, beforeNext));
  const gain = pct(entry, target);
  const rr = risk > 0 ? gain / risk : 0;
  const before20 = mean(volumes.slice(-21, -1));
  const volumeRatio = before20 > 0 ? volumes[L] / before20 : 0;

  const confirmed = BOTTOM.every((check) => checks[check.key].pass);
  // Pivot không tính phiên gần nhất, nên đóng cửa trên pivot nghĩa là chính phiên ấy vừa vượt.
  // Phiên vượt có khối lượng thì mua được kể cả khi nó đóng cửa xa pivot — chỗ còn lại tới mục
  // tiêu đã tính từ giá đóng cửa, nên vượt quá xa thì nó tự rơi vào "kháng cự quá gần".
  const breakoutToday = close > pivot && volumeRatio >= o.breakoutVolume;
  const status = !breakoutToday && toPivot > o.buyAbove ? 'extended'
    : toPivot < -o.buyBelow ? 'building'
      : gain < o.minGain ? 'cramped'
        : rr < o.minRR ? 'wide'
          : breakoutToday ? 'breakout'
            : 'setup';

  const bottom = BOTTOM.map((check) => ({ ...check, ...checks[check.key] }));
  const signList = SIGNS.map((check) => ({ ...check, ...signs[check.key] }));
  return {
    symbol: String(symbol).toUpperCase(),
    day: dayOf(own[L]),
    close,
    change: pct(closes[L - 1], close),
    liquidity,
    bottom,
    signs: signList,
    score: signList.filter((s) => s.pass).length,
    confirmed,
    candidate: liquidity.pass && confirmed,
    fromHigh,
    lows: { first: low1, second: b2 !== null ? own[b2].low : null, firstDay: dayOf(own[b1]) },
    plan: {
      pivot: roundTick(pivot), toPivot, entry: roundTick(entry), stop, risk,
      target, gain, rr, resistance: next, volumeRatio,
    },
    status,
  };
}

/**
 * Kháng cự phía trên một mức giá, gần nhất trước: các đường MA truyền vào, và đỉnh cục bộ của một
 * năm qua (cao nhất 5 phiên mỗi bên). Hai đỉnh sát nhau trong 1,5% là một vùng, lấy mức thấp hơn.
 */
function resistancesAbove(rows, floor, averages, wing = 5) {
  const recent = rows.slice(-250);
  const peaks = [];
  for (let i = wing; i < recent.length - wing; i++) {
    const around = recent.slice(i - wing, i + wing + 1);
    if (recent[i].high === Math.max(...around.map((row) => row.high))) {
      peaks.push({ name: `đỉnh ${formatDay(dayOf(recent[i]))}`, value: recent[i].high });
    }
  }
  const all = [...averages.filter((a) => a.value != null), ...peaks]
    .filter((level) => level.value > floor)
    .sort((a, b) => a.value - b.value);
  const merged = [];
  for (const level of all) {
    if (!merged.length || level.value > merged.at(-1).value * 1.015) merged.push(level);
  }
  return merged;
}

/** Chấm cả rổ. `entries` là `[{ symbol, rows }]`. */
export function reboundAll(entries, indexRows, { at = new Date(), index = indexDays(indexRows), ...options } = {}) {
  const results = [];
  const skipped = [];
  for (const { symbol, rows } of entries) {
    const result = rows?.length ? rebound(symbol, rows, index, { at, ...options }) : null;
    if (result) results.push(result);
    else skipped.push(String(symbol).toUpperCase());
  }
  const settledIndex = at === null ? indexRows : settled(indexRows, at);
  return {
    results, skipped, market: marketOf(settledIndex), pulse: pulseOf(settledIndex), day: results.map((r) => r.day).sort().at(-1),
  };
}

const REGIME = {
  up: 'thị trường thuận lợi — mã khoẻ xem !manh',
  mixed: 'thị trường giằng co',
  down: 'thị trường điều chỉnh — lệnh hồi phục là lệnh ngắn, tuân thủ cắt lỗ',
};

export const MOST_LISTED = 8;
/// Danh sách theo dõi in tối đa chừng này mã.
const WATCH_LISTED = 6;

/** Tin nhắn cho `!hoiphuc`: vượt pivot hôm nay, sát pivot, rồi mã đã xác nhận đáy nhưng chưa vào được. */
export function reboundMessage(report, { groupOf = () => '', limit = MOST_LISTED, now = null } = {}) {
  const { results, market } = report;
  const liquid = results.filter((r) => r.liquidity.pass);
  const candidates = liquid.filter((r) => r.candidate);
  const tag = (r) => (groupOf(r.symbol) ? `${r.symbol} (${groupOf(r.symbol)})` : r.symbol);
  const byQuality = (a, b) => b.plan.rr - a.plan.rr || b.score - a.score;

  const lines = heading('HỒI PHỤC', report, now);
  if (market) lines.push(`VN-Index ${signed(market.change20)} 20 phiên · ${REGIME[market.regime]}`);
  lines.push(...pulseLines(report.pulse, { estimated: Boolean(now) }));
  lines.push(`${liquid.length}/${results.length} mã đủ thanh khoản · ${candidates.length} mã đã xác nhận đáy`);

  const planLine = (r) => {
    const p = r.plan;
    const why = p.resistance && p.target < roundTick(p.entry * (1 + DEFAULTS.maxGain / 100))
      ? `trước ${p.resistance.name} ${money(p.resistance.value)}`
      : `chốt +${DEFAULTS.maxGain}%`;
    return `   cắt lỗ ${money(p.stop)} (${signed(-p.risk)}) · bán ${money(p.target)} (${signed(p.gain)}, ${why}) · R:R ${fmt(p.rr)}`;
  };

  const breakouts = candidates.filter((r) => r.status === 'breakout').sort(byQuality);
  if (breakouts.length) {
    lines.push('', 'Vượt pivot hôm nay:');
    breakouts.slice(0, limit).forEach((r, i) => {
      lines.push(`${i + 1}. ${tag(r)} ${money(r.close)} vượt ${money(r.plan.pivot)} · KL ${fmt(r.plan.volumeRatio)} lần TB20${signsNote(r)}`);
      lines.push(planLine(r));
    });
  }

  const setups = candidates.filter((r) => r.status === 'setup').sort(byQuality);
  if (setups.length) {
    lines.push('', `Sát pivot — mua khi đóng cửa trên pivot với KL từ ${fmt(DEFAULTS.breakoutVolume)} lần TB20:`);
    setups.slice(0, limit).forEach((r, i) => {
      lines.push(`${i + 1}. ${tag(r)} ${money(r.close)} · pivot ${money(r.plan.pivot)} (${signed(r.plan.toPivot)}) · ${volumeNote(r, DEFAULTS, now)} · đáy ${money(r.lows.first)} → ${money(r.lows.second)}${signsNote(r)}`);
      lines.push(planLine(r));
    });
  }

  if (!breakouts.length && !setups.length) lines.push('', 'Chưa có mã nào ở điểm mua.');

  const waiting = candidates.filter((r) => r.status !== 'breakout' && r.status !== 'setup').sort(byQuality);
  if (waiting.length) {
    lines.push('', 'Đã xác nhận đáy, chưa có điểm mua:');
    lines.push(...waitingLines(waiting.slice(0, limit), tag));
  }

  // Danh sách theo dõi: mã thiếu đúng một điều kiện xác nhận đáy — luôn in, vì điểm mua kế tiếp hay
  // đến từ nhóm này. Thiếu "đang downtrend" thì mã không phải loại hồi phục — nó thuộc `!manh`.
  const near = liquid
    .filter((r) => !r.confirmed && r.bottom.filter((c) => !c.pass).length === 1 && r.bottom.find((c) => !c.pass).key !== 'context')
    .sort((a, b) => b.score - a.score || b.plan.toPivot - a.plan.toPivot)
    .slice(0, Math.min(WATCH_LISTED, limit));
  if (near.length) {
    lines.push('', 'Theo dõi — gần xác nhận đáy, thiếu một điều kiện:');
    near.forEach((r, i) => {
      const miss = r.bottom.find((c) => !c.pass);
      lines.push(`${i + 1}. ${tag(r)} ${money(r.close)} · pivot ${money(r.plan.pivot)} (${signed(r.plan.toPivot)}) · thiếu ${miss.short} (${miss.text})${signsNote(r)}`);
    });
  }

  lines.push('', 'Tín hiệu tự động, không phải khuyến nghị đầu tư.');
  return lines.join('\n');
}

function signsNote(r) {
  const on = r.signs.filter((s) => s.pass).map((s) => s.short);
  return on.length ? ` · ${on.join(', ')}` : '';
}

/// Mã chưa vào được, nhóm theo lý do — mỗi lý do một tiêu đề, mỗi mã một dòng.
function waitingLines(list, tag) {
  const lines = [];
  for (const status of Object.keys(STATUS)) {
    const group = list.filter((r) => r.status === status);
    if (!group.length) continue;
    lines.push(`• ${capitalize(STATUS[status])}:`);
    for (const r of group) lines.push(`   ${tag(r)} ${money(r.close)} · ${waitingNote(r)}${spikeTag(r)}`);
  }
  return lines;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function waitingNote(r) {
  const p = r.plan;
  if (r.status === 'cramped') return `${p.resistance?.name ?? 'kháng cự'} ${money(p.resistance?.value ?? p.target)}, chỉ còn ${signed(p.gain)}`;
  if (r.status === 'wide') return `cắt lỗ ${money(p.stop)}, rủi ro ${fmt(p.risk)}% · R:R ${fmt(p.rr)}`;
  return `pivot ${money(p.pivot)} (${signed(p.toPivot)})`;
}

// ---- tiện ích ----------------------------------------------------------------------------------

function pct(from, to) {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const fmt = (value) => one.format(value);
const signed = (value) => `${value > 0 ? '+' : ''}${one.format(value)}%`;
const count = (value) => Math.round(value).toLocaleString('vi-VN');
