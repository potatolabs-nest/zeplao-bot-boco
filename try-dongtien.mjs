// Thử lệnh `!dongtien` với dữ liệu thật, không cần bot, không cần token.
//
//   node try-dongtien.mjs              ngành nào đang hút tiền trên HOSE, in đúng tin nhắn bot sẽ gửi
//   node try-dongtien.mjs --hientai    riêng hôm nay so với 60 phiên, GTGD hôm nay ước cả phiên
//   node try-dongtien.mjs ngân hàng    mọi mã đủ thanh khoản của một ngành (gõ một phần tên)
//
// Mã trong VN30 + VNMID được ghi kèm trạng thái `!manh` / `!hoiphuc`, để nối ngành hút tiền với
// mã có thể giao dịch. Ngưỡng chỉnh ở `DEFAULTS` trong market/flow.mjs.
import { FEED } from './market/vps.mjs';
import { CHART } from './market/dnse.mjs';
import { rowsFrom } from './market/technical.mjs';
import { vndirectSectors } from './market/sectors.mjs';
import { STATUS as STRONG, screenAll, settled, withToday } from './market/strength.mjs';
import { STATUS as REBOUND, reboundAll } from './market/rebound.mjs';
import { flowMessage, sectorFlows, stockFlow } from './market/flow.mjs';
import { pulseOf } from './market/pulse.mjs';

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
const live = args.includes('--hientai');
const asked = args.filter((a) => !a.startsWith('--')).join(' ').trim().toLowerCase();

const started = Date.now();
const [hose, vn30, mid, sectors] = await Promise.all([
  json(`${FEED}/getlistckindex/hose`),
  json(`${FEED}/getlistckindex/VN30`),
  json(`${FEED}/getlistckindex/VNMID`),
  vndirectSectors().map(),
]);
const at = new Date();
let index = await daily('VNINDEX', 'index');
let entries = await inBatches(hose, async (symbol) => ({ symbol, rows: settled(await daily(symbol).catch(() => []), at) }));

// Bản "hiện tại": thêm nến phiên đang chạy cho mọi mã, rồi so riêng hôm nay với nền.
let now = null;
const options = {};
if (live) {
  const today = withToday(index, await minutes('VNINDEX', 'index'), at);
  if (today.partial == null) {
    console.error('Hôm nay chưa có phiên — in bản cuối ngày.\n');
  } else {
    let paced = false;
    entries = await inBatches(entries, async ({ symbol, rows }) => {
      const one = withToday(rows, await minutes(symbol).catch(() => []), at);
      paced ||= one.paced;
      return { symbol, rows: one.rows };
    });
    index = today.rows;
    now = { at, partial: today.partial, paced };
    options.recent = 1;
  }
}
const report = sectorFlows(entries.map(({ symbol, rows }) => stockFlow(symbol, rows, options)), (symbol) => sectors.get(symbol), options);

// Trạng thái trong `!manh` / `!hoiphuc` của các mã VN30 + VNMID.
const tradable = new Set([...vn30, ...mid]);
const basket = entries.filter((e) => tradable.has(e.symbol));
const strong = screenAll(basket, index, { at: now ? null : at });
const rebound = reboundAll(basket, index, { at: now ? null : at });
const labels = new Map();
for (const r of strong.results) if (r.leader) labels.set(r.symbol, `mạnh: ${STRONG[r.status]}`);
for (const r of rebound.results) if (r.candidate && !labels.has(r.symbol)) labels.set(r.symbol, `hồi phục: ${REBOUND[r.status]}`);
const label = (symbol) => labels.get(symbol) ?? (tradable.has(symbol) ? '' : 'ngoài VN100');
console.error(`Chấm ${hose.length} mã trong ${((Date.now() - started) / 1000).toFixed(1)} giây.\n`);

if (asked) {
  const sector = report.sectors.find((s) => s.name.toLowerCase().includes(asked));
  if (!sector) {
    console.log(`Không có ngành nào khớp "${asked}". Các ngành: ${report.sectors.map((s) => s.name).join(', ')}`);
  } else {
    const period = options.recent === 1 ? 'hôm nay' : '5 phiên';
    const pc = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    console.log(sector.name);
    console.log(`Tỷ trọng ${sector.share5.toFixed(1)}% (${sector.shift >= 0 ? '+' : ''}${sector.shift.toFixed(1)} điểm) · GTGD ${sector.ratio.toFixed(2)} lần TB60 · giá ${pc(sector.ret5)} ${period}\n`);
    console.log(`  ${'mã'.padEnd(5)} ${'giá'.padStart(7)} ${period.padStart(8)} ${'20 phiên'.padStart(8)} ${'GTGD tỷ'.padStart(8)} ${'lần TB60'.padStart(8)}  trạng thái`);
    for (const f of sector.members) {
      console.log(`  ${f.symbol.padEnd(5)} ${String(f.close).padStart(7)} ${pc(f.ret5).padStart(8)} ${pc(f.ret20).padStart(8)} ${(f.value5 / 1e9).toFixed(1).padStart(8)} ${f.ratio.toFixed(2).padStart(8)}  ${label(f.symbol)}`);
    }
  }
} else {
  console.log(flowMessage(report, { label, now, pulse: pulseOf(now ? index : settled(index, at)), ...options }));
}
