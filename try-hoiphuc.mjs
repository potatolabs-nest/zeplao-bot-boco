// Thử bộ lọc `!hoiphuc` với dữ liệu thật, không cần bot, không cần token.
//
//   node try-hoiphuc.mjs              cả VN30 + VNMID, in đúng tin nhắn bot sẽ gửi
//   node try-hoiphuc.mjs --thongke    thêm bảng số mã đạt từng tiêu chí
//   node try-hoiphuc.mjs --hientai    chấm cả nến phiên đang chạy, và so với bản cuối ngày
//   node try-hoiphuc.mjs anv vhm      chấm chi tiết từng tiêu chí cho vài mã
//
// Ngưỡng chỉnh ở `DEFAULTS` trong market/rebound.mjs.
import { FEED } from './market/vps.mjs';
import { CHART } from './market/dnse.mjs';
import { rowsFrom } from './market/technical.mjs';
import { changes, withToday } from './market/strength.mjs';
import { BOTTOM, SIGNS, STATUS, reboundAll, reboundMessage } from './market/rebound.mjs';

const LOOKBACK_DAYS = 450;
const PARALLEL = 8;

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function daily(symbol, kind = 'stock') {
  const to = Math.floor(Date.now() / 1000);
  const from = to - LOOKBACK_DAYS * 24 * 60 * 60;
  return rowsFrom(await json(`${CHART}/${kind}?from=${from}&to=${to}&symbol=${symbol}&resolution=1D`));
}

/// Nến 5 phút của hôm nay và khoảng 25 phiên trước — đủ dựng nhịp khối lượng cùng giờ 20 phiên.
async function minutes(symbol, kind = 'stock') {
  const to = Math.floor(Date.now() / 1000);
  return rowsFrom(await json(`${CHART}/${kind}?from=${to - 35 * 24 * 60 * 60}&to=${to}&symbol=${symbol}&resolution=5`));
}

async function inBatches(items, work) {
  const out = [];
  for (let i = 0; i < items.length; i += PARALLEL) out.push(...await Promise.all(items.slice(i, i + PARALLEL).map(work)));
  return out;
}

const args = process.argv.slice(2);
const stats = args.includes('--thongke');
const live = args.includes('--hientai');
const asked = args.filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());

const [vn30, mid] = await Promise.all([json(`${FEED}/getlistckindex/VN30`), json(`${FEED}/getlistckindex/VNMID`)]);
const groupOf = (s) => (vn30.includes(s) ? 'VN30' : mid.includes(s) ? 'Mid' : '');
const universe = asked.length ? asked : [...new Set([...vn30, ...mid])];

const started = Date.now();
const index = await daily('VNINDEX', 'index');
const entries = await inBatches(universe, async (symbol) => ({ symbol, rows: await daily(symbol).catch(() => []) }));
let report = reboundAll(entries, index);
let now = null;
let diff = [];
if (live) {
  // Bản "hiện tại": thêm nến phiên đang chạy rồi chấm lại, giữ bản cuối ngày để so.
  const at = new Date();
  const today = withToday(index, await minutes('VNINDEX', 'index'), at);
  let paced = false;
  const liveEntries = await inBatches(entries, async ({ symbol, rows }) => {
    const live = withToday(rows, await minutes(symbol).catch(() => []), at);
    paced ||= live.paced;
    return { symbol, rows: live.rows };
  });
  if (today.partial == null) {
    console.error('Hôm nay chưa có phiên — in bản cuối ngày.\n');
  } else {
    const eod = report;
    report = reboundAll(liveEntries, today.rows, { at: null });
    now = { at, partial: today.partial, paced };
    diff = changes(eod, report, (r) => (r.candidate ? STATUS[r.status] : null));
    diff.unshift('', `So với bản cuối ngày ${eod.day.split('-').reverse().join('/')}:`);
    if (diff.length === 2) diff.push('không khác gì.');
  }
}
console.error(`Chấm ${universe.length} mã trong ${((Date.now() - started) / 1000).toFixed(1)} giây.\n`);

const mark = (pass) => (pass ? '✔' : '✘');

if (asked.length) {
  for (const symbol of asked) {
    const r = report.results.find((x) => x.symbol === symbol);
    if (!r) { console.log(`${symbol}: bỏ qua — không có dữ liệu hoặc chưa đủ 250 phiên\n`); continue; }
    const head = r.candidate ? `ĐÃ XÁC NHẬN ĐÁY · ${STATUS[r.status]}` : 'chưa xác nhận đáy';
    console.log(`${r.symbol} (${groupOf(r.symbol) || '—'}) · ${head} · dấu hiệu ${r.score}/${SIGNS.length}`);
    console.log(`  ${mark(r.liquidity.pass)} Thanh khoản: ${r.liquidity.text}`);
    console.log('  Xác nhận đáy — phải đạt cả bốn');
    for (const c of r.bottom) console.log(`    ${mark(c.pass)} ${c.name}: ${c.text}`);
    console.log('  Dấu hiệu tham khảo');
    for (const c of r.signs) console.log(`    ${mark(c.pass)} ${c.name}: ${c.text}`);
    const p = r.plan;
    console.log('  Điểm mua, bán');
    console.log(`    pivot ${p.pivot} (giá ${p.toPivot >= 0 ? '+' : ''}${p.toPivot.toFixed(1)}%) · KL phiên cuối ${p.volumeRatio.toFixed(2)} lần TB20`);
    console.log(`    vào ${p.entry} · cắt lỗ ${p.stop} (rủi ro ${p.risk.toFixed(1)}%)`);
    console.log(`    kháng cự gần nhất: ${p.resistance ? `${p.resistance.name} ${p.resistance.value.toFixed(2)}` : 'không có trong 1 năm'}`);
    console.log(`    bán ${p.target} (+${p.gain.toFixed(1)}%) · R:R ${p.rr.toFixed(2)}\n`);
  }
} else {
  console.log(reboundMessage(report, { groupOf, now }));
  if (diff.length) console.log(diff.join('\n'));
}

if (stats) {
  const liquid = report.results.filter((r) => r.liquidity.pass);
  console.log('\n──────── thống kê ────────\n');
  console.log(`Chấm được ${report.results.length} mã · đủ thanh khoản ${liquid.length}${report.skipped.length ? ` · bỏ qua: ${report.skipped.join(', ')}` : ''}`);
  console.log('\nXác nhận đáy (trong các mã đủ thanh khoản):');
  for (const check of BOTTOM) {
    const n = liquid.filter((r) => r.bottom.find((c) => c.key === check.key).pass).length;
    console.log(`  ${check.name.padEnd(30)} ${String(n).padStart(3)}/${liquid.length}`);
  }
  const candidates = liquid.filter((r) => r.candidate);
  console.log(`  → đã xác nhận đáy: ${candidates.length}`);
  console.log('\nTrạng thái (trong các mã đã xác nhận đáy):');
  for (const [key, name] of Object.entries(STATUS)) {
    const list = candidates.filter((r) => r.status === key).map((r) => r.symbol);
    console.log(`  ${name.padEnd(18)} ${list.length}${list.length ? `: ${list.join(', ')}` : ''}`);
  }
}
