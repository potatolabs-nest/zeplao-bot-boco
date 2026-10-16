// Ba bộ lọc cả rổ cho bot: `!manh`, `!hoiphuc`, `!dongtien`.
//
// `strength.mjs`, `rebound.mjs`, `flow.mjs` không biết gì về mạng; file này là phần mạng của chúng,
// đúng như các `try-*.mjs` đi lấy dữ liệu, nhưng có trí nhớ. Một lần chấm là vài trăm lượt hỏi nến
// — 110 mã VN30 + VNMID cho `!manh`, cả HOSE cho `!dongtien` — nên:
//
//   - nến ngày của một mã được giữ lại một lúc và dùng chung cho cả ba lệnh;
//   - bài đã chấm được giữ lại: bản cuối ngày giữ lâu (nến đã đóng thì không đổi), bản "hiện tại"
//     giữ vài phút;
//   - hai người cùng hỏi một lúc thì chờ chung một lần chấm, không chấm hai lần.
import { FEED } from './vps.mjs';
import { CHART } from './dnse.mjs';
import { rowsFrom } from './technical.mjs';
import { vndirectSectors } from './sectors.mjs';
import { STATUS as STRONG, changes, screenAll, settled, strengthMessage, withToday } from './strength.mjs';
import { STATUS as REBOUND, reboundAll, reboundMessage } from './rebound.mjs';
import { flowMessage, sectorFlows, stockFlow } from './flow.mjs';
import { pulseOf } from './pulse.mjs';
import { money } from './quote.mjs';

const TIMEOUT_MS = 10000;
const LOOKBACK_DAYS = 450;
/// Nến 5 phút của hôm nay và khoảng 25 phiên trước — đủ dựng nhịp khối lượng cùng giờ 20 phiên.
const INTRADAY_LOOKBACK_DAYS = 35;
const PARALLEL = 8;
const DAILY_TTL_MS = 30 * 60 * 1000;
const SETTLED_TTL_MS = 30 * 60 * 1000;
const LIVE_TTL_MS = 3 * 60 * 1000;
const INDEX = 'VNINDEX';

export function marketScreens({
  base = CHART,
  feed = FEED,
  fetchImpl = fetch,
  timeout = TIMEOUT_MS,
  now = () => Date.now(),
  sectors = vndirectSectors(),
} = {}) {
  async function json(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`${url} trả lời ${response.status}`);
    return response.json();
  }

  const remembered = new Map();
  /// Giữ kết quả của `work` trong `ttl` mili giây; lần hỏi trong lúc đang làm thì chờ chung.
  function kept(key, ttl, work) {
    const hit = remembered.get(key);
    if (hit && hit.until > now()) return hit.value;
    const value = work();
    remembered.set(key, { until: now() + ttl, value });
    // Hỏng thì quên ngay, để lần hỏi sau đi lấy lại thay vì nhận lại cái lỗi cũ suốt nửa giờ.
    value.catch(() => remembered.get(key)?.value === value && remembered.delete(key));
    return value;
  }

  function daily(symbol, kind = 'stock') {
    return kept(`1D:${symbol}`, DAILY_TTL_MS, async () => {
      const to = Math.floor(now() / 1000);
      const from = to - LOOKBACK_DAYS * 24 * 60 * 60;
      const response = await fetchImpl(`${base}/${kind}?from=${from}&to=${to}&symbol=${symbol}&resolution=1D`, { signal: AbortSignal.timeout(timeout) });
      // Mã không có thật trả về 4xx: đó là "không có dữ liệu", không phải nguồn chết.
      if (response.status >= 400 && response.status < 500) return [];
      if (!response.ok) throw new Error(`nến ${symbol} trả lời ${response.status}`);
      return rowsFrom(await response.json());
    });
  }

  /// Nến 5 phút, chỉ để dựng cây nến phiên đang chạy — hỏng thì coi như không có.
  async function minutes(symbol, kind = 'stock') {
    const to = Math.floor(now() / 1000);
    try {
      return rowsFrom(await json(`${base}/${kind}?from=${to - INTRADAY_LOOKBACK_DAYS * 24 * 60 * 60}&to=${to}&symbol=${symbol}&resolution=5`));
    } catch {
      return [];
    }
  }

  async function inBatches(items, work) {
    const out = [];
    for (let i = 0; i < items.length; i += PARALLEL) out.push(...await Promise.all(items.slice(i, i + PARALLEL).map(work)));
    return out;
  }

  const list = (name) => kept(`list:${name}`, DAILY_TTL_MS, () => json(`${feed}/getlistckindex/${name}`));

  async function basket() {
    const [vn30, mid] = await Promise.all([list('VN30'), list('VNMID')]);
    return { vn30, mid, groupOf: (s) => (vn30.includes(s) ? 'VN30' : mid.includes(s) ? 'Mid' : '') };
  }

  async function entriesOf(symbols) {
    return inBatches(symbols, async (symbol) => ({ symbol, rows: await daily(symbol).catch(() => []) }));
  }

  /// Thêm nến phiên đang chạy cho chỉ số và mọi mã. `null` khi hôm nay chưa có phiên.
  async function live(index, entries, at) {
    const today = withToday(index, await minutes(INDEX, 'index'), at);
    if (today.partial == null) return null;
    let paced = false;
    const rows = await inBatches(entries, async ({ symbol, rows }) => {
      const one = withToday(rows, await minutes(symbol), at);
      paced ||= one.paced;
      return { symbol, rows: one.rows };
    });
    return { index: today.rows, entries: rows, now: { at, partial: today.partial, paced } };
  }

  const NO_SESSION = 'Hôm nay chưa có phiên — đây là bản cuối ngày.';

  /// Một bộ lọc rổ VN30 + VNMID: bản cuối ngày, hoặc bản hiện tại kèm so với bản cuối ngày.
  function basketScreen(name, screenOf, messageOf, shown) {
    return ({ live: wantsLive = false } = {}) => kept(`${name}:${wantsLive}`, wantsLive ? LIVE_TTL_MS : SETTLED_TTL_MS, async () => {
      const at = new Date(now());
      const { vn30, mid, groupOf } = await basket();
      const [index, entries] = await Promise.all([daily(INDEX, 'index'), entriesOf([...new Set([...vn30, ...mid])])]);
      if (!index.length) throw new Error('không có nến VN-Index');
      const eod = screenOf(entries, index, { at });
      if (!wantsLive) return messageOf(eod, { groupOf });

      const today = await live(index, entries, at);
      if (!today) return `${NO_SESSION}\n\n${messageOf(eod, { groupOf })}`;
      const report = screenOf(today.entries, today.index, { at: null });
      const diff = changes(eod, report, shown);
      const day = eod.day.split('-').reverse().join('/');
      return [
        messageOf(report, { groupOf, now: today.now }),
        '',
        `So với bản cuối ngày ${day}:`,
        ...(diff.length ? diff : ['không khác gì.']),
      ].join('\n');
    });
  }

  const strong = basketScreen('manh', screenAll, strengthMessage, (r) => (r.leader ? STRONG[r.status] : null));
  const rebound = basketScreen('hoiphuc', reboundAll, reboundMessage, (r) => (r.candidate ? REBOUND[r.status] : null));

  /// Dòng tiền cả HOSE, kèm trạng thái `!manh` / `!hoiphuc` của các mã VN30 + VNMID.
  function flowReport(wantsLive) {
    return kept(`dongtien:${wantsLive}`, wantsLive ? LIVE_TTL_MS : SETTLED_TTL_MS, async () => {
      const at = new Date(now());
      const [hose, { vn30, mid }, sectorOf] = await Promise.all([list('hose'), basket(), sectors.map()]);
      let index = await daily(INDEX, 'index');
      if (!index.length) throw new Error('không có nến VN-Index');
      let entries = (await entriesOf(hose)).map(({ symbol, rows }) => ({ symbol, rows: settled(rows, at) }));

      let current = null;
      const options = {};
      if (wantsLive) {
        const today = await live(index, entries, at);
        if (today) {
          ({ index, entries } = today);
          current = today.now;
          options.recent = 1;
        }
      }
      const report = sectorFlows(entries.map(({ symbol, rows }) => stockFlow(symbol, rows, options)), (symbol) => sectorOf.get(symbol), options);

      const tradable = new Set([...vn30, ...mid]);
      const held = entries.filter((e) => tradable.has(e.symbol));
      const labels = new Map();
      for (const r of screenAll(held, index, { at: current ? null : at }).results) if (r.leader) labels.set(r.symbol, `mạnh: ${STRONG[r.status]}`);
      for (const r of reboundAll(held, index, { at: current ? null : at }).results) if (r.candidate && !labels.has(r.symbol)) labels.set(r.symbol, `hồi phục: ${REBOUND[r.status]}`);
      const label = (symbol) => labels.get(symbol) ?? (tradable.has(symbol) ? '' : 'ngoài VN100');

      return {
        report, label, options, now: current,
        pulse: pulseOf(current ? index : settled(index, at)),
        lateNote: wantsLive && !current ? NO_SESSION : '',
      };
    });
  }

  return {
    /// `!manh` — mã dẫn dắt và điểm mua swing trong VN30 + VNMID.
    strong,
    /// `!hoiphuc` — mã vừa xác nhận đáy trong VN30 + VNMID.
    rebound,
    /// `!dongtien` — ngành nào đang hút tiền trên HOSE; có `sector` thì kể mọi mã của ngành ấy.
    async flow({ live: wantsLive = false, sector = '' } = {}) {
      const { report, label, options, now: current, pulse, lateNote } = await flowReport(wantsLive);
      const text = sector
        ? sectorMessage(report, sector, { label, options })
        : flowMessage(report, { label, now: current, pulse, ...options });
      return lateNote ? `${lateNote}\n\n${text}` : text;
    },
  };
}

/**
 * Mọi mã đủ thanh khoản của một ngành, mỗi mã một dòng. `asked` là một phần tên ngành, không dấu
 * hay có dấu đều được.
 */
export function sectorMessage(report, asked, { label = () => '', options = {} } = {}) {
  const wanted = plain(asked);
  const sector = report.sectors.find((s) => plain(s.name).includes(wanted));
  if (!sector) return `Không có ngành nào khớp "${asked}". Các ngành: ${report.sectors.map((s) => s.name).join(', ')}.`;

  const period = options.recent === 1 ? 'hôm nay' : '5 phiên';
  const lines = [
    sector.name,
    `Tỷ trọng ${fmt(sector.share5)}% (${sector.shift >= 0 ? '+' : ''}${fmt(sector.shift)} điểm) · GTGD ${fmt(sector.ratio)} lần TB60 · giá ${signed(sector.ret5)} ${period}`,
    '',
  ];
  for (const f of sector.members) {
    const state = label(f.symbol);
    lines.push(`• ${f.symbol} ${money(f.close)} ${signed(f.ret5)} ${period} · ${signed(f.ret20)} 20 phiên · GTGD ${fmt(f.value5 / 1e9)} tỷ, ${fmt(f.ratio)} lần TB60${state ? ` · ${state}` : ''}`);
  }
  lines.push('', 'Thông tin dòng tiền, chưa backtest — không phải khuyến nghị đầu tư.');
  return lines.join('\n');
}

/// Chữ thường, bỏ dấu, để `ngan hang` khớp với "Ngân hàng".
function plain(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
}
const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const fmt = (value) => one.format(value);
const signed = (value) => `${value > 0 ? '+' : ''}${one.format(value)}%`;
