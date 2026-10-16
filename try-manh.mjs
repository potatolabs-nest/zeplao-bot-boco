// Thử bộ lọc `!manh` với dữ liệu thật, không cần bot, không cần token.
//
//   node try-manh.mjs              cả VN30 + VNMID, in đúng tin nhắn bot sẽ gửi
//   node try-manh.mjs --thongke    thêm bảng số mã đạt từng tiêu chí, để chỉnh ngưỡng
//   node try-manh.mjs --hientai    chấm cả nến phiên đang chạy, và so với bản cuối ngày
//   node try-manh.mjs fpt hpg      chấm chi tiết từng tiêu chí cho vài mã (vẫn xếp RS trong cả rổ)
//
// Ngưỡng chỉnh ở `DEFAULTS` trong market/strength.mjs.
import { FEED } from './market/vps.mjs';
import { CHART } from './market/dnse.mjs';
import { rowsFrom } from './market/technical.mjs';
import { HARD, QUALITY, SCORED, STATUS, changes, screenAll, strengthMessage, withToday } from './market/strength.mjs';

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
  for (let i = 0; i < items.length; i += PARALLEL) {
    out.push(...await Promise.all(items.slice(i, i + PARALLEL).map(work)));
  }
  return out;
}

const args = process.argv.slice(2);
const stats = args.includes('--thongke');
const live = args.includes('--hientai');
const asked = args.filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());

const [vn30, mid] = await Promise.all([json(`${FEED}/getlistckindex/VN30`), json(`${FEED}/getlistckindex/VNMID`)]);
const groupOf = (s) => (vn30.includes(s) ? 'VN30' : mid.includes(s) ? 'Mid' : '');
// RS là xếp hạng trong rổ, nên kể cả khi hỏi vài mã vẫn phải chấm cả rổ.
const universe = [...new Set([...vn30, ...mid, ...asked])];

const started = Date.now();
const index = await daily('VNINDEX', 'index');
const entries = await inBatches(universe, async (symbol) => ({ symbol, rows: await daily(symbol).catch(() => []) }));
let report = screenAll(entries, index);
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
    report = screenAll(liveEntries, today.rows, { at: null });
    now = { at, partial: today.partial, paced };
    diff = changes(eod, report, (r) => (r.leader ? STATUS[r.status] : null));
    diff.unshift('', `So với bản cuối ngày ${eod.day.split('-').reverse().join('/')}:`);
    if (diff.length === 2) diff.push('không khác gì.');
  }
}
console.error(`Chấm ${universe.length} mã trong ${((Date.now() - started) / 1000).toFixed(1)} giây.\n`);

if (asked.length) {
  for (const symbol of asked) {
    const r = report.results.find((x) => x.symbol === symbol);
    if (!r) { console.log(`${symbol}: bỏ qua — không có dữ liệu hoặc chưa đủ 260 phiên\n`); continue; }
    const head = r.leader ? `DẪN DẮT · ${STATUS[r.status]}` : 'chưa qua lọc cứng';
    console.log(`${r.symbol} (${groupOf(r.symbol) || '—'}) · ${head} · RS ${r.rsRank} · nền ${r.score}/${SCORED.length}`);
    console.log(`  ${r.liquidity.pass ? '✔' : '✘'} Thanh khoản: ${r.liquidity.text}`);
    console.log('  Tầng 1 — lọc cứng');
    for (const c of r.hard) console.log(`    ${c.pass ? '✔' : '✘'} ${c.name}: ${c.text}`);
    console.log('  Tầng 2 — chấm nền (* cộng điểm, còn lại để tham khảo)');
    for (const c of r.quality) console.log(`    ${c.pass ? "✔" : "✘"} ${c.scored ? "*" : " "}${c.name}: ${c.text}`);
    const p = r.plan;
    console.log('  Tầng 3 — điểm vào');
    console.log(`    pivot ${p.pivot} (giá ${p.toPivot >= 0 ? '+' : ''}${p.toPivot.toFixed(1)}%) · KL phiên cuối ${p.volumeRatio.toFixed(2)} lần TB20`);
    console.log(`    vào ${p.entry} · cắt lỗ ${p.stop} (rủi ro ${p.risk.toFixed(1)}%) · thoát khi đóng cửa dưới MA20\n`);
  }
} else {
  console.log(strengthMessage(report, { groupOf, now }));
  if (diff.length) console.log(diff.join('\n'));
}

if (stats) {
  const liquid = report.results.filter((r) => r.liquidity.pass);
  console.log('\n──────── thống kê ────────\n');
  console.log(`Chấm được ${report.results.length} mã · đủ thanh khoản ${liquid.length}${report.skipped.length ? ` · bỏ qua: ${report.skipped.join(', ')}` : ''}`);
  console.log('\nTầng 1 (trong các mã đủ thanh khoản):');
  for (const check of HARD) {
    const n = liquid.filter((r) => r.hard.find((c) => c.key === check.key)?.pass).length;
    console.log(`  ${check.name.padEnd(30)} ${String(n).padStart(3)}/${liquid.length}`);
  }
  const leaders = liquid.filter((r) => r.leader);
  console.log(`  → dẫn dắt: ${leaders.length}`);
  console.log('\nTầng 2 (trong các mã đủ thanh khoản):');
  for (const check of QUALITY) {
    const n = liquid.filter((r) => r.quality.find((c) => c.key === check.key).pass).length;
    console.log(`  ${check.name.padEnd(30)} ${String(n).padStart(3)}/${liquid.length}`);
  }
  console.log('\nTầng 3 (trong các mã dẫn dắt):');
  for (const [key, name] of Object.entries(STATUS)) {
    const list = leaders.filter((r) => r.status === key).map((r) => r.symbol);
    console.log(`  ${name.padEnd(14)} ${list.length}${list.length ? `: ${list.join(', ')}` : ''}`);
  }
}
