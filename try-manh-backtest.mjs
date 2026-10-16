// Backtest bộ lọc `!manh`: chạy lại nó cho từng phiên trong quá khứ, rồi xem mã được chọn đi đâu.
//
//   node try-manh-backtest.mjs                     5 năm, mỗi phiên một lần
//   node try-manh-backtest.mjs --step 5            mỗi 5 phiên một lần, nhanh hơn
//   node try-manh-backtest.mjs --set maxFromHigh=25 --set minRsRank=80    thử ngưỡng khác
//   node try-manh-backtest.mjs --cost 0.5          phí + thuế mỗi vòng mua bán, % (mặc định 0,35)
//   node try-manh-backtest.mjs --minscore 2        chỉ vào lệnh khi điểm nền từ 2
//
// Mỗi ngày chỉ nhìn dữ liệu tới hết ngày ấy — nến sau đó chỉ dùng để chấm kết quả. Đo ba thứ:
//
//   1. Lợi nhuận 5/10/20 phiên sau, trừ VN-Index cùng kỳ, của từng nhóm: cả rổ, dẫn dắt, vùng mua,
//      vượt nền. Nhóm sau không hơn nhóm trước thì tầng lọc ấy không giúp gì.
//   2. Giao dịch giả lập: vào lệnh theo đúng kế hoạch bot đưa ra, ra theo hai cách để so — chạm
//      mục tiêu 2R (tối đa 20 phiên), hoặc đóng cửa dưới MA20 (tối đa 60 phiên) — cả hai đều có cắt
//      lỗ. Kết quả tính bằng R — bội số của rủi ro đã chấp nhận — sau khi trừ phí.
//   3. Từng tiêu chí: mã đạt và mã trượt tiêu chí ấy, cái nào đi tốt hơn.
//
// Hai giới hạn phải nhớ khi đọc số: rổ là VN30 + VNMID **hôm nay**, nên mã đã bị loại khỏi rổ vì
// yếu đi không có mặt (survivorship bias — số sẽ đẹp hơn thật); và tín hiệu các ngày liền nhau
// chồng lên nhau, nên số mẫu trông lớn hơn số lần độc lập thật.
import { FEED } from './market/vps.mjs';
import { CHART } from './market/dnse.mjs';
import { rowsFrom, sma } from './market/technical.mjs';
import { DEFAULTS, MIN_SESSIONS, QUALITY, SCORED, indexDays, screenAll } from './market/strength.mjs';
import { tradingDay } from './market/chart.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const overrides = {};
args.forEach((arg, i) => {
  if (arg !== '--set') return;
  const [key, value] = String(args[i + 1]).split('=');
  if (!(key in DEFAULTS)) throw new Error(`không có ngưỡng ${key} trong DEFAULTS`);
  overrides[key] = Number(value);
});
const option = (key) => overrides[key] ?? DEFAULTS[key];
const STEP = Number(flag('--step', 1));
const YEARS = Number(flag('--years', 5));
const COST = Number(flag('--cost', 0.35));
const MIN_SCORE = Number(flag('--minscore', 0));
const HORIZONS = [5, 10, 20];
const HOLD = 20;
const HOLD_MA20 = 60;
const EXITS = { target: 'mục tiêu 2R', ma20: 'dưới MA20' };
const WINDOW = 300;
const PARALLEL = 8;

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}
async function daily(symbol, kind = 'stock') {
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.round((YEARS + 1.3) * 365) * 24 * 60 * 60;
  const rows = rowsFrom(await json(`${CHART}/${kind}?from=${from}&to=${to}&symbol=${symbol}&resolution=1D`));
  for (const row of rows) row.day = tradingDay(row.time);
  return rows;
}
async function inBatches(items, work) {
  const out = [];
  for (let i = 0; i < items.length; i += PARALLEL) out.push(...await Promise.all(items.slice(i, i + PARALLEL).map(work)));
  return out;
}

// ---- dữ liệu ----
const [vn30, mid] = await Promise.all([json(`${FEED}/getlistckindex/VN30`), json(`${FEED}/getlistckindex/VNMID`)]);
const universe = [...new Set([...vn30, ...mid])];
console.error(`Tải ${YEARS + 1} năm nến cho ${universe.length} mã…`);
const index = await daily('VNINDEX', 'index');
const stocks = (await inBatches(universe, async (symbol) => ({ symbol, rows: await daily(symbol).catch(() => []) })))
  .filter((s) => s.rows.length);
for (const s of stocks) {
  s.at = new Map(s.rows.map((row, i) => [row.day, i]));
  s.ma20 = sma(s.rows.map((row) => row.close), 20);
}
const indexAt = new Map(index.map((row, i) => [row.day, i]));
const allIndexDays = indexDays(index);

// ---- chạy ----
const firstDay = Math.max(MIN_SESSIONS + 10, index.length - YEARS * 250);
const lastDay = index.length - 1 - HOLD;
const days = [];
for (let d = firstDay; d <= lastDay; d += STEP) days.push(d);
console.error(`Chạy ${days.length} phiên, từ ${index[firstDay].day} tới ${index[lastDay].day}…`);

const groups = { liquid: [], leader: [], setup: [], breakout: [] };
const byRegime = { up: [], mixed: [], down: [] };
const byCheck = Object.fromEntries(QUALITY.map((c) => [c.key, { pass: [], fail: [] }]));
const byScore = Object.fromEntries(Array.from({ length: SCORED.length + 1 }, (_, k) => [k, []]));
const byRank = { '1–49': [], '50–69': [], '70–89': [], '90–99': [] };
const byRs20 = { 'hơn VNI ≥ 3 điểm': [], 'còn lại': [] };
const trades = { breakout: { target: [], ma20: [] }, setup: { target: [], ma20: [] } };
// mã → phiên cuối của lệnh đang giữ, để không vào chồng lệnh; mỗi cách thoát một sổ riêng.
const busyUntil = { target: new Map(), ma20: new Map() };
let skippedDown = 0;

const started = Date.now();
for (const d of days) {
  const day = index[d].day;
  const entries = [];
  const positions = new Map();
  for (const s of stocks) {
    const i = s.at.get(day);
    if (i === undefined || i < MIN_SESSIONS - 1) continue;
    positions.set(s.symbol, { s, i });
    entries.push({ symbol: s.symbol, rows: s.rows.slice(Math.max(0, i + 1 - WINDOW), i + 1) });
  }
  const report = screenAll(entries, index.slice(Math.max(0, d + 1 - WINDOW), d + 1), { at: null, index: allIndexDays, ...overrides });

  for (const r of report.results) {
    if (!r.liquidity.pass) continue;
    const { s, i } = positions.get(r.symbol);
    const excess = Object.fromEntries(HORIZONS.map((k) => [k, forwardExcess(s.rows, i, d, k)]));
    if (excess[10] == null) continue;

    groups.liquid.push(excess);
    byRank[r.rsRank < 50 ? '1–49' : r.rsRank < 70 ? '50–69' : r.rsRank < 90 ? '70–89' : '90–99'].push(excess);
    const rs20 = change(s.rows[i - 20].close, s.rows[i].close) - change(index[d - 20].close, index[d].close);
    byRs20[rs20 >= 3 ? 'hơn VNI ≥ 3 điểm' : 'còn lại'].push(excess);

    if (!r.leader) continue;
    groups.leader.push(excess);
    if (report.market) byRegime[report.market.regime].push(excess);
    for (const c of r.quality) byCheck[c.key][c.pass ? 'pass' : 'fail'].push(excess);
    byScore[r.score].push(excess);

    if (r.status !== 'breakout' && r.status !== 'setup') continue;
    groups[r.status].push(excess);
    if (report.market?.regime === 'down' && !option('buyInDownMarket')) { skippedDown++; continue; }
    if (r.score < MIN_SCORE) continue;
    for (const exit of Object.keys(EXITS)) {
      if ((busyUntil[exit].get(r.symbol) ?? -1) >= i) continue;
      const trade = r.status === 'breakout' ? breakoutTrade(s, i, r.plan, exit) : setupTrade(s, i, r.plan, exit);
      if (trade) {
        trades[r.status][exit].push({ ...trade, regime: report.market?.regime });
        busyUntil[exit].set(r.symbol, trade.exitAt);
      }
    }
  }
}
console.error(`Xong trong ${((Date.now() - started) / 1000).toFixed(1)} giây.\n`);

// ---- giả lập lệnh ----

/// Vượt nền: mua giá đóng cửa phiên vượt, cắt lỗ theo kế hoạch.
function breakoutTrade(s, i, plan, exit) {
  return walk(s, i + 1, s.rows[i].close, plan.stop, exit);
}

/// Vùng mua: đặt lệnh chờ mua ở pivot trong 5 phiên tới. Mở cửa vượt pivot thì khớp ở giá mở cửa.
/// Phiên khớp không xét cắt lỗ — không biết giá chạm đáy trước hay sau lúc khớp.
function setupTrade(s, i, plan, exit) {
  const { rows } = s;
  for (let j = i + 1; j <= Math.min(i + 5, rows.length - 1); j++) {
    if (rows[j].high > plan.pivot) {
      const entry = Math.max(rows[j].open, plan.pivot);
      if (entry <= plan.stop) return null;
      return walk(s, j + 1, entry, plan.stop, exit);
    }
  }
  return null;
}

/// Chạm cắt lỗ trước (kể cả mở cửa dưới cắt lỗ), rồi mới tới cách thoát còn lại — cùng một phiên
/// chạm cả hai thì tính là lỗ, cho chắc.
///
///   target: chạm mục tiêu 2R thì chốt; giữ tối đa HOLD phiên.
///   ma20:   đóng cửa dưới MA20 thì bán ở giá mở cửa phiên sau; giữ tối đa HOLD_MA20 phiên.
function walk({ rows, ma20 }, from, entry, stop, exit) {
  const risk = entry - stop;
  if (!(risk > 0)) return null;
  const done = (price, j, how) => ({ r: (price - entry - (entry * COST) / 100) / risk, held: j - from + 1, exitAt: j, how });
  const target = entry + option('targetR') * risk;
  const end = Math.min(from + (exit === 'target' ? HOLD : HOLD_MA20) - 1, rows.length - 1);
  if (from > end) return null;
  for (let j = from; j <= end; j++) {
    const row = rows[j];
    if (row.open <= stop) return done(row.open, j, 'stop');
    if (row.low <= stop) return done(stop, j, 'stop');
    if (exit === 'target') {
      if (row.open >= target) return done(row.open, j, 'target');
      if (row.high >= target) return done(target, j, 'target');
    } else if (ma20[j] != null && row.close < ma20[j]) {
      return j + 1 < rows.length ? done(rows[j + 1].open, j + 1, 'ma20') : done(row.close, j, 'ma20');
    }
  }
  return done(rows[end].close, end, 'time');
}

function forwardExcess(rows, i, d, k) {
  if (i + k >= rows.length || d + k >= index.length) return null;
  // Mã nghỉ giao dịch vài phiên thì phiên thứ k của nó không trùng ngày với Index; so theo ngày.
  const j = indexAt.get(rows[i + k].day);
  if (j === undefined) return null;
  return change(rows[i].close, rows[i + k].close) - change(index[d].close, index[j].close);
}

function change(from, to) {
  return ((to - from) / from) * 100;
}

// ---- in ----
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const f1 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const percent = (part, whole) => Math.round((part / whole) * 100);

function row(name, list) {
  if (!list.length) return `  ${pad(name, 28)} ${lpad(0, 7)}   —`;
  const cells = HORIZONS.map((k) => {
    const xs = list.map((e) => e[k]).filter((x) => x != null);
    return `${lpad(f1(avg(xs)), 7)}% ${lpad(percent(xs.filter((x) => x > 0).length, xs.length), 3)}%`;
  });
  return `  ${pad(name, 28)} ${lpad(list.length, 7)}   ${cells.join('   ')}`;
}
const header = (title) => {
  console.log(`\n${title}`);
  console.log(`  ${pad('', 28)} ${lpad('mẫu', 7)}   ${HORIZONS.map((k) => `${lpad(`${k} phiên`, 8)} thắng`).join('   ')}`);
};
const REGIME = { up: 'thuận lợi', mixed: 'giằng co', down: 'điều chỉnh' };

console.log(`BACKTEST !manh · ${days.length} phiên · ${index[firstDay].day} → ${index[lastDay].day} · ${stocks.length} mã`);
if (Object.keys(overrides).length) console.log(`Ngưỡng đổi: ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log('Số là lợi nhuận TRỪ VN-Index cùng kỳ, trung bình; "thắng" là % mẫu hơn VN-Index.');

header('1. Từng tầng lọc — tầng sau phải hơn tầng trước');
console.log(row('Cả rổ (đủ thanh khoản)', groups.liquid));
console.log(row('Dẫn dắt (qua tầng 1)', groups.leader));
console.log(row('  … ở vùng mua', groups.setup));
console.log(row('  … vượt nền', groups.breakout));

header('2. RS: xếp hạng nhiều khung và RS 20 phiên, trong cả rổ');
for (const [name, list] of Object.entries(byRank)) console.log(row(`RS ${name}`, list));
for (const [name, list] of Object.entries(byRs20)) console.log(row(`RS20 ${name}`, list));

header('3. Từng tiêu chí nền, trong các mã dẫn dắt — đạt phải hơn trượt (* là tiêu chí cộng điểm)');
for (const c of QUALITY) {
  console.log(row(`${c.scored ? '*' : ' '}${c.name} ✔`, byCheck[c.key].pass));
  console.log(row(` ${c.name} ✘`, byCheck[c.key].fail));
}
header('   Theo điểm nền');
for (const [name, list] of Object.entries(byScore)) console.log(row(`nền ${name}/${SCORED.length}`, list));

header('4. Mã dẫn dắt theo bối cảnh thị trường');
for (const [key, list] of Object.entries(byRegime)) console.log(row(REGIME[key], list));

console.log(`\n5. Giao dịch giả lập — đã trừ phí ${COST}%/vòng${option('buyInDownMarket') ? '' : ` · bỏ ${skippedDown} tín hiệu lúc thị trường điều chỉnh`}`);
for (const [status, label] of [['breakout', 'Vượt nền'], ['setup', 'Vùng mua']]) {
  for (const [exit, exitLabel] of Object.entries(EXITS)) {
    const list = trades[status][exit];
    const name = `${label}, thoát ${exitLabel}`;
    if (!list.length) { console.log(`  ${pad(name, 28)} không có lệnh nào`); continue; }
    const rs = list.map((t) => t.r);
    const how = (h) => percent(list.filter((t) => t.how === h).length, list.length);
    const wins = rs.filter((r) => r > 0);
    const losses = rs.filter((r) => r <= 0);
    console.log(`  ${pad(name, 28)} ${lpad(list.length, 4)} lệnh · thắng ${lpad(percent(wins.length, list.length), 2)}% · kỳ vọng ${f1(avg(rs))}R · lãi TB ${f1(avg(wins))}R, lỗ TB ${f1(avg(losses))}R · giữ TB ${Math.round(avg(list.map((t) => t.held)))} phiên`);
    console.log(`  ${pad('', 28)}   ra vì: cắt lỗ ${how('stop')}% · ${exit === 'target' ? `mục tiêu ${how('target')}%` : `MA20 ${how('ma20')}%`} · hết giờ ${how('time')}%`);
    for (const [key, regime] of Object.entries(REGIME)) {
      const part = list.filter((t) => t.regime === key).map((t) => t.r);
      if (part.length) console.log(`  ${pad('', 28)}   thị trường ${pad(regime, 10)} ${lpad(part.length, 4)} lệnh · thắng ${lpad(percent(part.filter((r) => r > 0).length, part.length), 2)}% · ${f1(avg(part))}R`);
    }
  }
}
console.log('\nGiới hạn: rổ là thành phần VN30 + VNMID hôm nay (mã đã rớt rổ không có mặt), và tín hiệu các ngày liền nhau chồng lên nhau.');
