// Lọc mã dẫn dắt và điểm mua swing, cho lệnh `!manh`.
//
// Ba tầng, theo đúng thứ tự một người swing trading đi qua mỗi tối:
//
//   1. Lọc cứng — không đạt là loại, không bàn thêm: đủ thanh khoản, ở kênh trên, gần đỉnh, và
//      nằm trong nhóm mạnh nhất rổ theo sức mạnh tương đối nhiều khung.
//   2. Chấm nền — mã đã qua lọc cứng được chấm sáu điểm về chất lượng nền giá: đường RS, giữ giá
//      khi thị trường giảm, biên độ co hẹp dần, nến chặt, cạn cung, và dòng tiền gom.
//   3. Điểm vào — pivot là đỉnh của nền; từ đó suy ra mã đang vượt nền, đang trong vùng mua, đã
//      chạy xa, hay nền chưa xong — kèm cắt lỗ và rủi ro. Không có điểm vào thì không có lệnh.
//
// Bối cảnh thị trường đứng trên cùng tin nhắn: lúc VN-Index điều chỉnh thì ít mã lọt là đúng, và
// câu trả lời phải nói điều đó ra thay vì cố tìm cho đủ danh sách.
//
// File này không biết gì về mạng: vào là nến ngày, ra là con số và câu chữ. Mọi ngưỡng nằm trong
// `DEFAULTS` để chỉnh một chỗ, và để `try-manh-backtest.mjs` thử nhiều bộ ngưỡng trên cùng dữ liệu.
import { floorTick, roundTick, sma } from './technical.mjs';
import { formatDay, tradingDay } from './chart.mjs';
import { money, vietnamNow } from './quote.mjs';
import { pulseLines, pulseOf } from './pulse.mjs';
import { phaseLines } from './strategy.mjs';

export const DEFAULTS = {
  // ---- Tầng 1: lọc cứng ----
  /// Thanh khoản: KL TB20 từ chừng này cổ, hoặc giá trị TB20 từ chừng này đồng.
  minVolume20: 300_000,
  minValue20: 10e9,
  /// Kênh trên: giá > MA50 > MA200; MA50 (10 phiên) và MA200 (20 phiên) không dốc xuống quá ngưỡng (%).
  ma50MinSlope: -0.5,
  ma200MinSlope: 0,
  /// Cách đỉnh 52 tuần không quá chừng này (%).
  maxFromHigh: 15,
  /// Xếp hạng RS trong rổ (1–99) từ chừng này trở lên — tức top 10%. Backtest 5 năm: nhóm RS 70–89
  /// đi ngang trung bình rổ, chỉ nhóm 90–99 thật sự hơn.
  minRsRank: 90,

  // ---- Tầng 2: chấm nền ----
  /// Đường RS (giá mã / VN-Index) cách đỉnh 52 tuần của chính nó không quá chừng này (%).
  rsLineFromHigh: 5,
  /// Trong `captureSessions` phiên, mức giảm của mã trong các phiên VN-Index giảm không quá
  /// `maxCapture` lần mức giảm của Index.
  captureSessions: 50,
  maxCapture: 0.5,
  /// Biên độ co hẹp dần: `contractionSessions` phiên chia làm ba đoạn, độ sâu đoạn sau nhỏ hơn đoạn trước.
  contractionSessions: 30,
  /// Nến chặt: biên độ trung bình 5 phiên không quá `tightRatio` lần biên độ thường ngày của mã (50 phiên).
  tightRatio: 0.7,
  /// Cạn cung: KL phiên gần nhất ≤ `vsaRatio` × TB20, hoặc TB5 ≤ `dryRatio` × TB20 — và phiên gần
  /// nhất vẫn từ `vsaMinVolume` cổ.
  vsaRatio: 0.6,
  dryRatio: 0.7,
  vsaMinVolume: 100_000,
  /// Dòng tiền gom: tổng KL phiên tăng / tổng KL phiên giảm trong `udSessions` phiên, từ `minUdRatio`.
  udSessions: 50,
  minUdRatio: 1,

  // ---- Tầng 3: điểm vào ----
  /// Pivot là đỉnh cao nhất của `baseSessions` phiên trước phiên gần nhất.
  baseSessions: 20,
  /// Vùng mua: từ dưới pivot `buyBelow`% tới trên pivot `buyAbove`%.
  buyBelow: 5,
  buyAbove: 5,
  /// Vượt nền: đóng cửa vượt pivot với KL từ chừng này lần TB20.
  breakoutVolume: 1.5,
  /// Cắt lỗ ở đáy `stopSessions` phiên gần nhất; rủi ro quá `maxRisk`% là nền quá rộng để vào.
  stopSessions: 10,
  maxRisk: 8,
  /// Mục tiêu tính bằng bội số rủi ro.
  targetR: 2,
  /// Thị trường điều chỉnh (VN-Index dưới MA50, MA20 dưới MA50) thì có mua không. Backtest: mua lúc
  /// ấy thắng 21%, -0,38R mỗi lệnh — nên mặc định là không, vùng mua chỉ còn để theo dõi.
  buyInDownMarket: 0,

  // ---- Danh sách theo dõi ----
  /// Mã thiếu đúng một điều kiện dẫn dắt được đưa vào theo dõi nếu RS từ chừng này, tối đa `watchListed` mã.
  watchMinRs: 70,
  watchListed: 6,
};

/// Đủ cho hiệu suất 12 tháng và đỉnh 52 tuần của đường RS.
export const MIN_SESSIONS = 260;

export const HARD = [
  { key: 'trend', name: 'Giá > MA50 > MA200', short: 'kênh trên' },
  { key: 'slope', name: 'MA50, MA200 không dốc xuống', short: 'MA đi lên' },
  { key: 'high', name: 'Gần đỉnh 52 tuần', short: 'gần đỉnh' },
  { key: 'rs', name: 'Top RS trong rổ', short: 'RS' },
];

/**
 * Tiêu chí nền. Chỉ những tiêu chí `scored` được cộng vào điểm nền và dùng để xếp hạng.
 *
 * Backtest 5 năm trên VN30 + VNMID: "giữ giá khi VN-Index giảm" là tiêu chí phân biệt rõ nhất
 * (+0,97% so với +0,28% hơn VN-Index sau 20 phiên), đường RS sát đỉnh hơn ở 5–10 phiên. Còn co
 * hẹp, nến chặt, cạn cung — ba dấu hiệu kinh điển của nền VCP — thì mã **đạt** lại đi kém mã trượt,
 * và dòng tiền gom thì gần như mã dẫn dắt nào cũng đạt. Bốn tiêu chí ấy vẫn được đo và in ra để
 * người đọc tự cân, nhưng không cộng điểm.
 */
export const QUALITY = [
  { key: 'capture', name: 'Giữ giá khi VN-Index giảm', short: 'giữ giá', scored: true },
  { key: 'rsLine', name: 'Đường RS sát đỉnh', short: 'đường RS', scored: true },
  { key: 'contraction', name: 'Biên độ co hẹp dần', short: 'co hẹp', scored: false },
  { key: 'tight', name: 'Nến chặt', short: 'nến chặt', scored: false },
  { key: 'dry', name: 'Cạn cung', short: 'cạn cung', scored: false },
  { key: 'accumulation', name: 'Dòng tiền gom', short: 'tiền gom', scored: false },
];

export const SCORED = QUALITY.filter((check) => check.scored);

export const STATUS = {
  breakout: 'vượt nền',
  setup: 'vùng mua',
  extended: 'đã chạy xa',
  building: 'nền chưa xong',
  wide: 'nền rộng',
};

/** Bản đồ ngày → giá đóng cửa VN-Index, dựng một lần cho cả rổ. */
export function indexDays(indexRows) {
  return new Map(indexRows.map((row) => [dayOf(row), row.close]));
}

/**
 * Chấm một mã, trừ xếp hạng RS — thứ cần cả rổ mới tính được, ở `screenAll`.
 *
 * `index` là `indexDays(...)`. `at` để bỏ cây nến của phiên đang chạy: khối lượng nửa phiên so với
 * cả phiên thì luôn trông như cạn cung. `at: null` thì không bỏ gì — cho backtest.
 * `null` khi chưa đủ phiên.
 */
export function screen(symbol, rows, index, { at = new Date(), ...options } = {}) {
  const o = { ...DEFAULTS, ...options };
  const own = at === null ? rows : settled(rows, at);
  if (own.length < MIN_SESSIONS) return null;

  const last = own.length - 1;
  const closes = own.map((row) => row.close);
  const volumes = own.map((row) => row.volume);
  const close = closes[last];
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const vol20 = mean(volumes.slice(-20));
  const hard = {};
  const quality = {};

  // ---- Thanh khoản ----
  const value20 = vol20 * close * 1000; // giá tính bằng nghìn đồng
  const liquidity = {
    pass: vol20 >= o.minVolume20 || value20 >= o.minValue20,
    text: `KL TB20 ${count(vol20)} cổ · ${fmt(value20 / 1e9)} tỷ/phiên`,
  };

  // ---- Tầng 1 ----
  hard.trend = {
    pass: close > ma50[last] && ma50[last] > ma200[last],
    text: `giá ${money(close)} · MA50 ${money(ma50[last])} · MA200 ${money(ma200[last])}`,
  };

  const slope50 = pct(ma50[last - 10], ma50[last]);
  const slope200 = pct(ma200[last - 20], ma200[last]);
  hard.slope = {
    pass: slope50 >= o.ma50MinSlope && slope200 >= o.ma200MinSlope,
    text: `MA50 ${signed(slope50)} 10 phiên · MA200 ${signed(slope200)} 20 phiên`,
  };

  const year = own.slice(-250);
  const high = Math.max(...year.map((row) => row.high));
  const fromHigh = pct(high, close);
  hard.high = { pass: fromHigh >= -o.maxFromHigh, text: `cách đỉnh ${money(high)} ${signed(fromHigh)}` };

  /// Kiểu IBD: quý gần nhất nặng gấp đôi ba quý trước, để mã mới khoẻ lên được xếp trên mã khoẻ từ lâu.
  const rsScore = 0.4 * changeOver(closes, 63) + 0.2 * changeOver(closes, 126)
    + 0.2 * changeOver(closes, 189) + 0.2 * changeOver(closes, 252);
  // `rs` được điền ở `screenAll`, khi đã có cả rổ để xếp hạng.

  // ---- Tầng 2 ----
  const line = [];
  for (const row of year) {
    const market = index.get(dayOf(row));
    if (market > 0) line.push(row.close / market);
  }
  if (line.length >= 20) {
    const fromLineHigh = pct(Math.max(...line), line.at(-1));
    quality.rsLine = {
      pass: fromLineHigh >= -o.rsLineFromHigh,
      text: fromLineHigh === 0 ? 'đường RS đang ở đỉnh 52 tuần' : `đường RS cách đỉnh 52 tuần ${signed(fromLineHigh)}`,
    };
  } else {
    quality.rsLine = { pass: false, text: 'thiếu dữ liệu VN-Index' };
  }

  let ownDown = 0;
  let marketDown = 0;
  let downDays = 0;
  for (let i = Math.max(1, own.length - o.captureSessions); i < own.length; i++) {
    const today = index.get(dayOf(own[i]));
    const before = index.get(dayOf(own[i - 1]));
    if (!(today > 0 && before > 0) || today >= before) continue;
    downDays++;
    marketDown += pct(before, today);
    ownDown += pct(own[i - 1].close, own[i].close);
  }
  const capture = marketDown < 0 ? ownDown / marketDown : null;
  quality.capture = capture == null
    ? { pass: false, text: 'không có phiên VN-Index giảm để đo' }
    : {
      pass: capture <= o.maxCapture,
      text: capture <= 0
        ? `${downDays} phiên VN-Index giảm, mã vẫn tăng (${signed(ownDown / downDays)}/phiên)`
        : `chịu ${fmt(capture * 100)}% mức giảm của VN-Index qua ${downDays} phiên giảm`,
    };

  const segment = Math.floor(o.contractionSessions / 3);
  const depths = [0, 1, 2].map((k) => {
    const part = own.slice(own.length - (3 - k) * segment, own.length - (2 - k) * segment || undefined);
    const top = Math.max(...part.map((row) => row.high));
    return ((top - Math.min(...part.map((row) => row.low))) / top) * 100;
  });
  quality.contraction = {
    pass: depths[0] > depths[1] && depths[1] > depths[2],
    text: `độ sâu ${segment} phiên một: ${depths.map((d) => `${fmt(d)}%`).join(' → ')}`,
  };

  const ranges = own.map((row, i) => (i ? ((row.high - row.low) / own[i - 1].close) * 100 : 0));
  const recentRange = mean(ranges.slice(-5));
  const usualRange = mean(ranges.slice(-55, -5));
  quality.tight = {
    pass: usualRange > 0 && recentRange <= o.tightRatio * usualRange,
    text: `biên độ 5 phiên ${fmt(recentRange)}%/ngày · thường ngày ${fmt(usualRange)}%`,
  };

  const volume = volumes[last];
  const vol5 = mean(volumes.slice(-5));
  quality.dry = {
    pass: volume >= o.vsaMinVolume && (volume <= o.vsaRatio * vol20 || vol5 <= o.dryRatio * vol20),
    text: `KL phiên cuối ${count(volume)} = ${fmt(share(volume, vol20))}% TB20 · TB5 = ${fmt(share(vol5, vol20))}% TB20`,
  };

  let upVolume = 0;
  let downVolume = 0;
  for (let i = Math.max(1, own.length - o.udSessions); i < own.length; i++) {
    if (own[i].close > own[i - 1].close) upVolume += own[i].volume;
    else if (own[i].close < own[i - 1].close) downVolume += own[i].volume;
  }
  const udRatio = downVolume > 0 ? upVolume / downVolume : Infinity;
  quality.accumulation = {
    pass: udRatio >= o.minUdRatio,
    text: `KL phiên tăng / phiên giảm ${o.udSessions} phiên: ${Number.isFinite(udRatio) ? fmt(udRatio) : '∞'}`,
  };

  // ---- Tầng 3 ----
  const base = own.slice(-1 - o.baseSessions, -1);
  const pivot = Math.max(...base.map((row) => row.high));
  const toPivot = pct(pivot, close);
  const before20 = mean(volumes.slice(-21, -1));
  const volumeRatio = before20 > 0 ? volume / before20 : 0;
  const entry = Math.max(close, pivot);
  const stop = floorTick(Math.min(...own.slice(-o.stopSessions).map((row) => row.low)));
  const risk = ((entry - stop) / entry) * 100;
  const target = roundTick(entry + o.targetR * (entry - stop));

  const crossed = closes[last - 1] <= pivot && close > pivot;
  const status = toPivot > o.buyAbove ? 'extended'
    : toPivot < -o.buyBelow ? 'building'
      : risk > o.maxRisk ? 'wide'
        : crossed && volumeRatio >= o.breakoutVolume ? 'breakout'
          : 'setup';

  // Mã đã chạy xa hoặc nền quá rộng: chỗ mua hợp lý là nhịp về MA10–MA20, lúc cắt lỗ ở đáy 10 phiên
  // chỉ còn cách vài %. Chỉ để theo dõi — chưa backtest, không ảnh hưởng `status` hay `leader`.
  const ma10 = sma(closes, 10)[last];
  const ma20 = sma(closes, 20)[last];
  const pullbackRisk = ((ma20 - stop) / ma20) * 100;
  const pullback = close > ma20 && stop < ma20 && pullbackRisk <= o.maxRisk
    ? { low: roundTick(Math.min(ma10, ma20)), high: roundTick(Math.max(ma10, ma20)), entry: roundTick(ma20), risk: pullbackRisk }
    : null;

  const quality_ = QUALITY.map((check) => ({ ...check, ...quality[check.key] }));
  return {
    symbol: String(symbol).toUpperCase(),
    day: dayOf(own[last]),
    close,
    change: pct(closes[last - 1], close),
    liquidity,
    hard: HARD.filter((check) => hard[check.key]).map((check) => ({ ...check, ...hard[check.key] })),
    quality: quality_,
    score: quality_.filter((check) => check.scored && check.pass).length,
    rsScore,
    fromHigh,
    ma20,
    plan: { pivot: roundTick(pivot), toPivot, entry: roundTick(entry), stop, risk, target, volumeRatio, pullback },
    status,
  };
}

/**
 * Chấm cả rổ: từng mã, rồi xếp hạng RS trong rổ, rồi bối cảnh thị trường.
 *
 * `entries` là `[{ symbol, rows }]`. Mã chưa đủ phiên bị bỏ ra `skipped`, không làm hỏng cả bài.
 */
export function screenAll(entries, indexRows, { at = new Date(), index = indexDays(indexRows), ...options } = {}) {
  const o = { ...DEFAULTS, ...options };
  const results = [];
  const skipped = [];
  for (const { symbol, rows } of entries) {
    const result = rows?.length ? screen(symbol, rows, index, { at, ...options }) : null;
    if (result) results.push(result);
    else skipped.push(String(symbol).toUpperCase());
  }

  // Xếp hạng 1–99 như IBD: mã đứng trên 85% rổ thì RS 85. Thang chỉ dựng từ mã đủ thanh khoản —
  // để mã mỏng vào thang thì chúng kéo lệch RS của mã giao dịch được. Mã mỏng
  // vẫn được chấm trên cùng thang đó để in ra cho biết.
  const pool = results.filter((r) => r.liquidity.pass).map((r) => r.rsScore).sort((a, b) => a - b);
  results.forEach((result) => {
    const below = pool.filter((score) => score < result.rsScore).length;
    const ties = pool.filter((score) => score === result.rsScore).length;
    const i = result.liquidity.pass ? below + ties - 1 : below;
    result.rsRank = pool.length > 1 ? Math.max(1, Math.min(99, Math.round((i / (pool.length - 1)) * 98) + 1)) : 99;
    result.hard.push({
      ...HARD.find((check) => check.key === 'rs'),
      pass: result.rsRank >= o.minRsRank,
      text: `RS ${result.rsRank}/99 trong rổ`,
    });
    result.leader = result.liquidity.pass && result.hard.every((check) => check.pass);
  });

  const settledIndex = at === null ? indexRows : settled(indexRows, at);
  return {
    results, skipped, market: marketOf(settledIndex), pulse: pulseOf(settledIndex), day: results.map((r) => r.day).sort().at(-1),
  };
}

/// VN-Index so với MA20, MA50: thị trường thuận lợi, giằng co, hay điều chỉnh.
export function marketOf(indexRows) {
  if (indexRows.length < 50) return null;
  const closes = indexRows.map((row) => row.close);
  const last = closes.length - 1;
  const close = closes[last];
  const ma20 = sma(closes, 20)[last];
  const ma50 = sma(closes, 50)[last];
  const regime = close > ma50 && ma20 > ma50 ? 'up' : close < ma50 && ma20 < ma50 ? 'down' : 'mixed';
  return { close, ma20, ma50, change20: changeOver(closes, 20), regime };
}

const REGIME = {
  up: 'trên MA50, thị trường thuận lợi',
  mixed: 'quanh MA50, thị trường giằng co, vào lệnh nhỏ',
  down: 'dưới MA50, thị trường điều chỉnh, ưu tiên quan sát',
};

/// Mỗi danh sách trong tin nhắn liệt kê tối đa chừng này mã. Tin dài hơn thì không ai đọc hết.
export const MOST_LISTED = 8;

/**
 * Tin nhắn cho `!manh`, theo thứ tự người ta cần: vượt nền hôm nay, rồi vùng mua, rồi mã dẫn dắt
 * chưa vào được. Không có mã dẫn dắt nào thì nói mã nào gần nhất và thiếu gì.
 *
 * `report` là kết quả `screenAll`; `groupOf(mã)` trả về tên rổ để in cạnh mã.
 */
export function strengthMessage(report, { groupOf = () => '', limit = MOST_LISTED, now = null, ...options } = {}) {
  const { results, market } = report;
  const liquid = results.filter((r) => r.liquidity.pass);
  const leaders = liquid.filter((r) => r.leader);
  const tag = (r) => (groupOf(r.symbol) ? `${r.symbol} (${groupOf(r.symbol)})` : r.symbol);
  const byQuality = (a, b) => b.score - a.score || b.rsRank - a.rsRank;

  const lines = heading('MẠNH', report, now);
  if (market) lines.push(`VN-Index ${signed(market.change20)} 20 phiên · ${REGIME[market.regime]}`);
  lines.push(...pulseLines(report.pulse, { estimated: Boolean(now) }));
  lines.push(...phaseLines(market, report.pulse));
  lines.push(`${liquid.length}/${results.length} mã đủ thanh khoản · ${leaders.length} mã dẫn dắt`);

  const o = { ...DEFAULTS, ...options };
  const watchOnly = market?.regime === 'down' && !o.buyInDownMarket;
  const breakouts = leaders.filter((r) => r.status === 'breakout').sort(byQuality);
  if (breakouts.length) {
    lines.push('', watchOnly ? 'Vượt nền hôm nay — chỉ theo dõi, thị trường đang điều chỉnh:' : 'Vượt nền hôm nay:');
    breakouts.slice(0, limit).forEach((r, i) => {
      lines.push(`${i + 1}. ${tag(r)} ${money(r.close)} vượt ${money(r.plan.pivot)} · KL ${fmt(r.plan.volumeRatio)} lần TB20 · RS ${r.rsRank} · nền ${r.score}/${SCORED.length}`);
      lines.push(`   cắt lỗ ${money(r.plan.stop)} (${signed(-r.plan.risk)}) · ${EXIT}${notes(r)}`);
    });
  }

  const setups = leaders.filter((r) => r.status === 'setup').sort(byQuality);
  if (setups.length) {
    lines.push('', watchOnly
      ? 'Vùng mua — chỉ theo dõi, thị trường đang điều chỉnh:'
      : `Vùng mua — mua khi đóng cửa trên pivot với KL từ ${fmt(o.breakoutVolume)} lần TB20:`);
    setups.slice(0, limit).forEach((r, i) => {
      lines.push(`${i + 1}. ${tag(r)} ${money(r.close)} · pivot ${money(r.plan.pivot)} (${signed(r.plan.toPivot)}) · ${volumeNote(r, o, now)} · RS ${r.rsRank} · nền ${r.score}/${SCORED.length}`);
      lines.push(`   cắt lỗ ${money(r.plan.stop)} (${signed(-r.plan.risk)} từ ${money(r.plan.entry)})${notes(r)}`);
    });
  }

  const waiting = leaders.filter((r) => r.status !== 'breakout' && r.status !== 'setup').sort((a, b) => b.rsRank - a.rsRank);
  if (waiting.length) {
    lines.push('', 'Dẫn dắt nhưng chưa có điểm vào:');
    // Nhóm theo lý do — mỗi lý do một tiêu đề, mỗi mã một dòng.
    for (const status of Object.keys(STATUS)) {
      const group = waiting.slice(0, limit).filter((r) => r.status === status);
      if (!group.length) continue;
      lines.push(`• ${STATUS[status].charAt(0).toUpperCase()}${STATUS[status].slice(1)}:`);
      for (const r of group) lines.push(`   ${tag(r)} ${money(r.close)} · RS ${r.rsRank} · ${waitingNote(r)}${spikeTag(r)}`);
    }
  }

  if (!breakouts.length && !setups.length) {
    lines.push('', 'Chưa có mã nào ở điểm mua.');
  }

  // Danh sách theo dõi: mã thiếu đúng một điều kiện dẫn dắt, RS chưa quá thấp, nền chưa chạy khỏi
  // pivot. Luôn in — mã đã dẫn dắt thường đã chạy, còn điểm mua kế tiếp hay đến từ nhóm này. Mã
  // thiếu kênh trên mà giá dưới cả MA20 là mã vừa rơi khỏi kênh — đang yếu đi, không phải mạnh lên.
  const near = liquid
    .filter((r) => !r.leader && r.rsRank >= o.watchMinRs && r.plan.toPivot <= o.buyAbove
      && r.hard.filter((c) => !c.pass).length === 1
      && !(r.hard.find((c) => !c.pass).key === 'trend' && r.close < r.ma20))
    .sort((a, b) => b.rsRank - a.rsRank || b.plan.toPivot - a.plan.toPivot)
    .slice(0, Math.min(o.watchListed, limit));
  if (near.length) {
    lines.push('', 'Theo dõi — gần thành dẫn dắt, thiếu một điều kiện:');
    near.forEach((r, i) => {
      const miss = r.hard.find((c) => !c.pass);
      lines.push(`${i + 1}. ${tag(r)} ${money(r.close)} · RS ${r.rsRank} · pivot ${money(r.plan.pivot)} (${signed(r.plan.toPivot)}) · thiếu ${miss.short} (${miss.text})`);
    });
  }

  lines.push('', 'Tín hiệu tự động, không phải khuyến nghị đầu tư.');
  return lines.join('\n');
}

/**
 * KL của mã ở vùng mua, nói luôn nó đã đủ để mua chưa. Mã đã đóng cửa trên pivot mà vẫn nằm ở
 * vùng mua là vì thiếu KL — chỗ đó dễ bị hiểu nhầm là đã vượt, nên gọi tên ra.
 */
export function volumeNote(r, o, now) {
  const ratio = `KL ${now ? 'ước ' : ''}${fmt(r.plan.volumeRatio)} lần TB20${r.plan.volumeRatio >= SPIKE_VOLUME ? ' (đột biến)' : ''}`;
  return r.close > r.plan.pivot && r.plan.volumeRatio < o.breakoutVolume ? `${ratio}, trên pivot nhưng thiếu KL` : ratio;
}

/// Cách thoát lệnh in trong tin nhắn — xem `exit` trong backtest.
const EXIT = 'thoát khi đóng cửa dưới MA20';

/// Điểm nền còn thiếu gì, rồi những tiêu chí tham khảo đang đạt.
function notes(r) {
  const missing = r.quality.filter((c) => c.scored && !c.pass).map((c) => c.short);
  const extra = r.quality.filter((c) => !c.scored && c.pass).map((c) => c.short);
  return [
    missing.length && ` · thiếu: ${missing.join(', ')}`,
    extra.length && ` · có thêm: ${extra.join(', ')}`,
  ].filter(Boolean).join('');
}

function waitingNote(r) {
  const base = r.status === 'wide'
    ? `cắt lỗ ${money(r.plan.stop)}, rủi ro ${fmt(r.plan.risk)}%`
    : `pivot ${money(r.plan.pivot)} (${signed(r.plan.toPivot)})`;
  const pull = r.plan.pullback;
  if (!pull || (r.status !== 'wide' && r.status !== 'extended')) return base;
  return `${base} · chờ về MA10–MA20 ${money(pull.low)}–${money(pull.high)}, cắt lỗ ${money(r.plan.stop)} (${signed(-pull.risk)} từ ${money(pull.entry)})`;
}

// ---- tiện ích ----------------------------------------------------------------------------------

/**
 * Dòng đầu tin nhắn. `now` là `{ at, partial }` khi chấm trên nến phiên đang chạy (bản "hiện
 * tại"); `null` là bản cuối ngày, chỉ dùng nến đã đóng.
 */
export function heading(name, report, now) {
  if (!now) return [`${name} · VN30 + Midcap · phiên ${formatDay(report.day)}`];
  const head = [`${name} HIỆN TẠI · VN30 + Midcap · ${clock(now.at)} ngày ${formatDay(report.day)}`];
  if (now.partial != null && now.partial < 1) {
    const how = now.paced ? 'theo nhịp cùng giờ 20 phiên trước' : 'chia đều theo thời gian';
    head.push(`Phiên mới qua ${Math.round(now.partial * 100)}% · KL hôm nay ước cả phiên ${how} · tín hiệu chỉ chắc khi đóng cửa`);
  }
  return head;
}

/**
 * KL phiên từ chừng này lần TB20 trở lên là đột biến. Chỉ gắn nhãn cho mã đã lọt bộ lọc: backtest
 * 5 năm, đột biến đứng một mình gần như không hơn VN-Index (mua mở cửa phiên sau còn thua), còn
 * đột biến ở mã dẫn dắt thì hơn rõ — nó là lý do để chú ý thêm, không phải để tìm mã mới.
 */
export const SPIKE_VOLUME = 2;

/// Nhãn đột biến KL cạnh một mã trong danh sách, hoặc rỗng.
export function spikeTag(r) {
  if (r.plan.volumeRatio < SPIKE_VOLUME) return '';
  const move = r.change <= -2 ? ', giá giảm — bán mạnh' : '';
  return ` · đột biến KL ${fmt(r.plan.volumeRatio)} lần TB20${move}`;
}

/// Phút giao dịch của một phiên: sáng 9:00–11:30, chiều 13:00–14:45 (gồm ATC).
const SESSION = [[9 * 60, 11 * 60 + 30], [13 * 60, 14 * 60 + 45]];
const SESSION_MINUTES = SESSION.reduce((sum, [from, to]) => sum + to - from, 0);
/// Ước khối lượng cả phiên như thể đã qua ít nhất chừng này phút — nhân lên từ vài phút đầu là nhân nhiễu.
const MIN_ELAPSED = 15;

/// Phần phiên đã trôi qua lúc `at`, từ 0 tới 1.
export function sessionShare(at) {
  const { minutes } = vietnamNow(at);
  const elapsed = SESSION.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(minutes, to) - from), 0);
  return elapsed / SESSION_MINUTES;
}

/// Bao nhiêu phiên trước dùng để dựng nhịp khối lượng trong ngày, và ít nhất bao nhiêu phiên thì tin.
const PROFILE_SESSIONS = 20;
const MIN_PROFILE_SESSIONS = 5;

/// Giờ Việt Nam không đổi theo mùa, nên ngày và phút trong ngày tính thẳng từ UTC+7 — nhanh hơn
/// `Intl` cả trăm lần, mà ở đây phải tính cho vài chục nghìn nến 5 phút.
const vnDay = (seconds) => Math.floor((seconds + 7 * 3600) / 86400);
const vnMinute = (seconds) => Math.floor(((seconds + 7 * 3600) % 86400) / 60);

/**
 * Nến ngày của phiên đang chạy, dựng từ nến trong phiên (1 hoặc 5 phút) — nguồn nến ngày chỉ có
 * nến hôm nay sau khi đóng cửa.
 *
 * Khối lượng được ước cho cả phiên để so được với TB20. Có nến trong phiên của các phiên trước
 * thì ước theo **nhịp cùng giờ**: 20 phiên qua, tới giờ này thường đã khớp 40% cả phiên, thì hôm
 * nay khớp bao nhiêu chia 40%. Khớp dồn đầu phiên và ATC đã nằm sẵn trong nhịp đó, nên không bị
 * ước cao lúc 9:30 hay ước thấp lúc 14:20 như khi chia đều theo thời gian. Không đủ phiên trước
 * thì mới chia đều.
 *
 * Trả về `rows` có thêm (hoặc thay) cây nến hôm nay; `partial` là phần phiên đã qua (`1` khi hết
 * phiên); `paced` cho biết đã ước theo nhịp cùng giờ hay chia đều. Hôm nay chưa khớp gì thì trả
 * về nguyên `rows`.
 */
export function withToday(rows, intraday, at) {
  const day = tradingDay(at.getTime() / 1000);
  const todayKey = vnDay(at.getTime() / 1000);
  const byDay = new Map();
  for (const bar of intraday) {
    const key = vnDay(bar.time);
    (byDay.get(key) ?? byDay.set(key, []).get(key)).push(bar);
  }
  const today = byDay.get(todayKey) ?? [];
  if (!today.length) return { rows, partial: null, paced: false };

  const share = sessionShare(at);
  const traded = today.reduce((sum, bar) => sum + bar.volume, 0);
  let volume = traded;
  let paced = false;
  if (share < 1) {
    const now = vnMinute(at.getTime() / 1000);
    const past = [...byDay.keys()].filter((key) => key < todayKey).sort((a, b) => a - b).slice(-PROFILE_SESSIONS);
    let soFar = 0;
    let whole = 0;
    for (const key of past) {
      for (const bar of byDay.get(key)) {
        whole += bar.volume;
        if (vnMinute(bar.time) < now) soFar += bar.volume;
      }
    }
    if (past.length >= MIN_PROFILE_SESSIONS && soFar > 0 && whole > 0) {
      volume = traded / Math.min(1, soFar / whole);
      paced = true;
    } else {
      volume = traded / Math.max(share, MIN_ELAPSED / SESSION_MINUTES);
    }
  }

  const candle = {
    time: today[0].time,
    open: today[0].open,
    high: Math.max(...today.map((bar) => bar.high)),
    low: Math.min(...today.map((bar) => bar.low)),
    close: today.at(-1).close,
    volume,
  };
  const before = rows.length && dayOf(rows.at(-1)) === day ? rows.slice(0, -1) : rows;
  return { rows: [...before, candle], partial: share, paced };
}

/// Giờ Việt Nam dạng `10:32`.
export function clock(at) {
  const { minutes } = vietnamNow(at);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * So bản hiện tại với bản cuối ngày: mã nào mới lọt, mã nào rớt, mã nào đổi trạng thái.
 * `label(r)` trả về trạng thái để in (vd. "vùng mua"), hoặc `null` nếu mã không được liệt kê.
 */
export function changes(before, now, label) {
  const was = new Map(before.results.map((r) => [r.symbol, label(r)]));
  const lines = [];
  for (const r of now.results) {
    const from = was.get(r.symbol) ?? null;
    const to = label(r);
    if (from === to) continue;
    if (!from) lines.push(`+ ${r.symbol}: ${to}`);
    else if (!to) lines.push(`− ${r.symbol}: rớt khỏi ${from}`);
    else lines.push(`~ ${r.symbol}: ${from} → ${to}`);
  }
  for (const [symbol, from] of was) {
    if (from && !now.results.some((r) => r.symbol === symbol)) lines.push(`− ${symbol}: rớt khỏi ${from}`);
  }
  return lines;
}

/// Ngày giao dịch của một cây nến, nhớ lại trên chính cây nến: `tradingDay` dựng một bộ định dạng
/// ngày mỗi lần gọi, và backtest gọi nó hàng chục triệu lần.
export function dayOf(row) {
  if (row.day === undefined) row.day = tradingDay(row.time);
  return row.day;
}

/// Bỏ cây nến của phiên đang chạy, nếu có.
export function settled(rows, at) {
  if (!rows.length) return rows;
  const { weekday, minutes } = vietnamNow(at);
  const open = weekday !== 'Sat' && weekday !== 'Sun' && minutes >= 9 * 60 && minutes < 15 * 60;
  return open && dayOf(rows.at(-1)) === tradingDay(at.getTime() / 1000) ? rows.slice(0, -1) : rows;
}

function changeOver(closes, sessions) {
  return pct(closes[Math.max(0, closes.length - 1 - sessions)], closes.at(-1));
}

function pct(from, to) {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

function share(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const fmt = (value) => one.format(value);
const signed = (value) => `${value > 0 ? '+' : ''}${one.format(value)}%`;
const count = (value) => Math.round(value).toLocaleString('vi-VN');
