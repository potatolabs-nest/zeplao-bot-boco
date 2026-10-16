// Backtest bộ lọc `!hoiphuc`: chạy lại nó cho từng phiên trong quá khứ, rồi giả lập lệnh.
//
//   node try-hoiphuc-backtest.mjs                          5 năm, mỗi phiên một lần
//   node try-hoiphuc-backtest.mjs --set minRR=2 --set minGain=6    thử ngưỡng khác
//   node try-hoiphuc-backtest.mjs --cost 0.5               phí + thuế mỗi vòng, % (mặc định 0,35)
//
// Mục tiêu của lệnh này là một nhịp 8–10% trong downtrend, nên câu hỏi chính là: vào theo kế
// hoạch bot đưa ra thì bao nhiêu lệnh chạm mục tiêu, bao nhiêu chạm cắt lỗ, và trung bình lãi bao
// nhiêu % mỗi lệnh sau phí. Đo thêm:
//
//   - Hai cách bán: chốt ở mục tiêu trước kháng cự (tối đa 20 phiên), hoặc giữ tới khi đóng cửa
//     dưới MA20 (tối đa 60 phiên). Cả hai đều có cắt lỗ.
//   - Từng dấu hiệu tham khảo: lệnh có dấu hiệu ấy và lệnh không có, bên nào lãi hơn.
//   - Lợi nhuận 10/20 phiên sau, trừ VN-Index, của mã downtrend nói chung so với mã đã xác nhận
//     đáy — để biết bước xác nhận có đáng không.
//
// Giới hạn như backtest `!manh`: rổ là VN30 + VNMID hôm nay (mã đã rớt rổ không có mặt), và tín
// hiệu ngày liền nhau chồng lên nhau.
import { FEED } from './market/vps.mjs';
import { CHART } from './market/dnse.mjs';
import { rowsFrom, sma } from './market/technical.mjs';
import { DEFAULTS, MIN_SESSIONS, SIGNS, reboundAll } from './market/rebound.mjs';
import { indexDays } from './market/strength.mjs';
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
const YEARS = Number(flag('--years', 5));
const COST = Number(flag('--cost', 0.35));
const HOLD = 20;
const HOLD_MA20 = 60;
const EXITS = { target: 'chốt ở mục tiêu', ma20: 'giữ tới dưới MA20' };
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
console.error(`Chạy ${lastDay - firstDay + 1} phiên, từ ${index[firstDay].day} tới ${index[lastDay].day}…`);

const forward = { downtrend: [], confirmed: [], setup: [], breakout: [] };
const trades = Object.fromEntries(['breakout', 'setup'].map((k) => [k, { target: [], ma20: [] }]));
const busyUntil = { target: new Map(), ma20: new Map() };
const statusCount = {};

const started = Date.now();
for (let d = firstDay; d <= lastDay; d++) {
  const day = index[d].day;
  const entries = [];
  const positions = new Map();
  for (const s of stocks) {
    const i = s.at.get(day);
    if (i === undefined || i < MIN_SESSIONS - 1) continue;
    positions.set(s.symbol, { s, i });
    entries.push({ symbol: s.symbol, rows: s.rows.slice(Math.max(0, i + 1 - WINDOW), i + 1) });
  }
  const report = reboundAll(entries, index.slice(Math.max(0, d + 1 - WINDOW), d + 1), { at: null, index: allIndexDays, ...overrides });

  for (const r of report.results) {
    if (!r.liquidity.pass || !r.bottom[0].pass) continue;
    const { s, i } = positions.get(r.symbol);
    const excess = { 10: forwardExcess(s.rows, i, d, 10), 20: forwardExcess(s.rows, i, d, 20) };
    if (excess[10] == null) continue;
    forward.downtrend.push(excess);
    if (!r.candidate) continue;
    forward.confirmed.push(excess);
    statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
    if (r.status !== 'breakout' && r.status !== 'setup') continue;
    forward[r.status].push(excess);

    for (const exit of Object.keys(EXITS)) {
      if ((busyUntil[exit].get(r.symbol) ?? -1) >= i) continue;
      const trade = r.status === 'breakout'
        ? walk(s, i + 1, s.rows[i].close, r.plan, exit)
        : setupTrade(s, i, r.plan, exit);
      if (trade) {
        trades[r.status][exit].push({ ...trade, symbol: r.symbol, day, regime: report.market?.regime, signs: r.signs });
        busyUntil[exit].set(r.symbol, trade.exitAt);
      }
    }
  }
}
console.error(`Xong trong ${((Date.now() - started) / 1000).toFixed(1)} giây.\n`);

// ---- giả lập lệnh ----

/// Sát pivot: đặt lệnh chờ mua ở pivot trong 5 phiên tới; mở cửa vượt pivot thì khớp giá mở cửa.
/// Mục tiêu và cắt lỗ giữ nguyên mức giá của kế hoạch — khớp cao hơn pivot thì chỗ lãi hẹp lại.
function setupTrade(s, i, plan, exit) {
  const { rows } = s;
  for (let j = i + 1; j <= Math.min(i + 5, rows.length - 1); j++) {
    if (rows[j].high > plan.pivot) {
      const entry = Math.max(rows[j].open, plan.pivot);
      if (entry <= plan.stop || entry >= plan.target) return null;
      return walk(s, j + 1, entry, plan, exit);
    }
  }
  return null;
}

/// Cắt lỗ trước (kể cả mở cửa dưới cắt lỗ); cùng một phiên chạm cả cắt lỗ lẫn mục tiêu thì tính lỗ.
function walk({ rows, ma20 }, from, entry, { stop, target }, exit) {
  const risk = entry - stop;
  if (!(risk > 0)) return null;
  const done = (price, j, how) => {
    const net = price - entry - (entry * COST) / 100;
    return { r: net / risk, pct: (net / entry) * 100, held: j - from + 1, exitAt: j, how };
  };
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
  if (i + k >= rows.length) return null;
  const j = indexAt.get(rows[i + k].day);
  if (j === undefined) return null;
  return change(rows[i].close, rows[i + k].close) - change(index[d].close, index[j].close);
}

function change(from, to) {
  return ((to - from) / from) * 100;
}

// ---- in ----
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const f2 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const REGIME = { up: 'thuận lợi', mixed: 'giằng co', down: 'điều chỉnh' };

function summary(list) {
  const wins = list.filter((t) => t.r > 0);
  const losses = list.filter((t) => t.r <= 0);
  return `${lpad(list.length, 4)} lệnh · thắng ${lpad(percent(wins.length, list.length), 2)}% · TB ${f2(avg(list.map((t) => t.pct)))}%/lệnh (${f2(avg(list.map((t) => t.r)))}R) · lãi TB ${f2(avg(wins.map((t) => t.pct)))}%, lỗ TB ${f2(avg(losses.map((t) => t.pct)))}%`;
}

console.log(`BACKTEST !hoiphuc · ${index[firstDay].day} → ${index[lastDay].day} · ${stocks.length} mã · đã trừ phí ${COST}%/vòng`);
if (Object.keys(overrides).length) console.log(`Ngưỡng đổi: ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(', ')}`);

console.log('\n1. Bước xác nhận đáy có giúp không — lợi nhuận trừ VN-Index, trung bình (và % mẫu hơn VN-Index)');
for (const [key, label] of [['downtrend', 'Mã downtrend nói chung'], ['confirmed', 'Đã xác nhận đáy'], ['setup', '  … sát pivot'], ['breakout', '  … vượt pivot']]) {
  const list = forward[key];
  const cell = (k) => {
    const xs = list.map((e) => e[k]).filter((x) => x != null);
    return `${lpad(f2(avg(xs)), 6)}% (${lpad(percent(xs.filter((x) => x > 0).length, xs.length), 2)}%)`;
  };
  console.log(`  ${pad(label, 24)} ${lpad(list.length, 7)} mẫu · 10 phiên ${cell(10)} · 20 phiên ${cell(20)}`);
}
console.log(`  Trạng thái của mã đã xác nhận đáy: ${Object.entries(statusCount).map(([k, n]) => `${k} ${n}`).join(', ')}`);

console.log('\n2. Giao dịch giả lập');
for (const [status, label] of [['breakout', 'Vượt pivot'], ['setup', 'Sát pivot']]) {
  for (const [exit, exitLabel] of Object.entries(EXITS)) {
    const list = trades[status][exit];
    const name = `${label}, ${exitLabel}`;
    if (!list.length) { console.log(`  ${pad(name, 32)} không có lệnh nào`); continue; }
    const how = (h) => percent(list.filter((t) => t.how === h).length, list.length);
    console.log(`  ${pad(name, 32)} ${summary(list)}`);
    console.log(`  ${pad('', 32)}   ra vì: cắt lỗ ${how('stop')}% · ${exit === 'target' ? `chạm mục tiêu ${how('target')}%` : `dưới MA20 ${how('ma20')}%`} · hết giờ ${how('time')}% · giữ TB ${Math.round(avg(list.map((t) => t.held)))} phiên`);
    for (const [key, regime] of Object.entries(REGIME)) {
      const part = list.filter((t) => t.regime === key);
      if (part.length) console.log(`  ${pad('', 32)}   thị trường ${pad(regime, 10)} ${summary(part)}`);
    }
  }
}

console.log('\n3. Dấu hiệu tham khảo — mọi lệnh "chốt ở mục tiêu", có dấu hiệu so với không có');
const all = [...trades.breakout.target, ...trades.setup.target];
for (const sign of SIGNS) {
  const yes = all.filter((t) => t.signs.find((s) => s.key === sign.key).pass);
  const no = all.filter((t) => !t.signs.find((s) => s.key === sign.key).pass);
  console.log(`  ${pad(sign.name, 28)} có: ${summary(yes)}`);
  console.log(`  ${pad('', 28)} không: ${summary(no)}`);
}

console.log('\n4. Mười lệnh gần nhất (sát pivot + vượt pivot, chốt ở mục tiêu) — để soi lại trên chart');
for (const t of all.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 10)) {
  console.log(`  ${t.day} ${pad(t.symbol, 4)} ${pad(t.how, 6)} ${lpad(f2(t.pct), 7)}% sau ${t.held} phiên`);
}
console.log('\nGiới hạn: rổ là thành phần VN30 + VNMID hôm nay, và tín hiệu các ngày liền nhau chồng lên nhau.');
