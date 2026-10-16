// Dòng tiền theo ngành, cho lệnh `!dongtien`.
//
// Câu hỏi là "tiền đang chảy vào đâu", nên thước đo là **tỷ trọng** giá trị giao dịch chứ không
// phải giá trị tuyệt đối: cả sàn sôi lên thì ngành nào cũng giao dịch nhiều hơn, và một ngành
// "tăng 30% giá trị" giữa lúc cả sàn tăng 50% thực ra là đang bị rút tiền. Ngành hút tiền là ngành
// mà phần của nó trong tổng giá trị 5 phiên gần nhất lớn hơn phần của nó trong 60 phiên trước đó.
//
// Tiền vào mà giá không lên thì chưa phải tiền vào — có thể là người cầm hàng đang bán cho người
// mua. Nên tin nhắn tách hai trường hợp đó ra, và chỉ gọi là "hút tiền" khi giá cũng đi lên.
//
// File này không biết gì về mạng: vào là nến ngày và bảng ngành, ra là con số và câu chữ.
import { formatDay } from './chart.mjs';
import { money } from './quote.mjs';
import { clock, dayOf } from './strength.mjs';
import { pulseLines } from './pulse.mjs';

export const DEFAULTS = {
  /// Số phiên gần nhất, và số phiên trước đó làm nền để so.
  recent: 5,
  base: 60,
  /// Mã có giá trị giao dịch TB nền dưới chừng này đồng không tính — vài trăm triệu một phiên thì
  /// một lệnh lớn là đủ làm méo cả ngành nhỏ.
  minValue: 1e9,
  /// Ngành ít hơn chừng này mã đủ thanh khoản thì không xếp hạng.
  minMembers: 3,
  /// Mã đáng kể tên trong ngành: giá trị TB 5 phiên từ chừng này đồng — đủ để vào ra được.
  tradableValue: 10e9,
};

/** Dòng tiền của một mã: giá trị giao dịch gần đây so với nền, và giá đi đâu. `null` khi thiếu phiên. */
export function stockFlow(symbol, rows, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (rows.length < o.recent + o.base + 1) return null;
  const value = (row) => row.close * row.volume * 1000; // giá tính bằng nghìn đồng
  const recent = rows.slice(-o.recent);
  const base = rows.slice(-o.recent - o.base, -o.recent);
  const value5 = mean(recent.map(value));
  const valueBase = mean(base.map(value));
  const close = rows.at(-1).close;
  return {
    symbol: String(symbol).toUpperCase(),
    day: dayOf(rows.at(-1)),
    close,
    value5,
    valueBase,
    ratio: valueBase > 0 ? value5 / valueBase : 0,
    ret5: pct(rows.at(-1 - o.recent).close, close),
    ret20: pct(rows.at(-21).close, close),
  };
}

/**
 * Gom theo ngành. `sectorOf(mã)` trả về tên ngành hoặc rỗng. Trả về các ngành xếp theo độ dịch
 * tỷ trọng, cùng tổng của cả sàn.
 */
export function sectorFlows(flows, sectorOf, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const liquid = flows.filter((f) => f && f.valueBase >= o.minValue);
  const total5 = sum(liquid.map((f) => f.value5));
  const totalBase = sum(liquid.map((f) => f.valueBase));
  const groups = new Map();
  for (const f of liquid) {
    const name = sectorOf(f.symbol);
    if (!name) continue;
    (groups.get(name) ?? groups.set(name, []).get(name)).push(f);
  }

  const sectors = [];
  for (const [name, members] of groups) {
    if (members.length < o.minMembers) continue;
    const value5 = sum(members.map((f) => f.value5));
    const valueBase = sum(members.map((f) => f.valueBase));
    const share5 = (value5 / total5) * 100;
    const shareBase = (valueBase / totalBase) * 100;
    sectors.push({
      name,
      members: members.sort((a, b) => (b.value5 - b.valueBase) - (a.value5 - a.valueBase)),
      value5,
      share5,
      shift: share5 - shareBase,
      ratio: value5 / valueBase,
      // Giá của ngành: trung bình theo giá trị giao dịch, để mã nhỏ không kéo lệch.
      ret5: sum(members.map((f) => f.ret5 * f.value5)) / value5,
      ret20: sum(members.map((f) => f.ret20 * f.value5)) / value5,
      breadth: (members.filter((f) => f.ret5 > 0).length / members.length) * 100,
    });
  }
  sectors.sort((a, b) => b.shift - a.shift);
  const day = liquid.map((f) => f.day).sort().at(-1);
  return { sectors, total5, totalBase, count: liquid.length, day };
}

/**
 * Tin nhắn cho `!dongtien`. `label(mã)` là trạng thái của mã trong `!manh` / `!hoiphuc` (hoặc
 * rỗng) — chỗ nối dòng tiền ngành với danh sách mã giao dịch.
 *
 * `now` là `{ at, partial, paced }` cho bản "hiện tại": `report` đã được chấm với nến phiên đang
 * chạy và `recent: 1`, tức so riêng hôm nay với nền; GTGD hôm nay là ước cả phiên.
 */
export function flowMessage(report, { label = () => '', limit = 4, perSector = 3, now = null, pulse = null, ...options } = {}) {
  const o = { ...DEFAULTS, ...options };
  const { sectors } = report;
  const period = o.recent === 1 ? 'hôm nay' : `${o.recent} phiên`;
  const lines = now
    ? [`DÒNG TIỀN HIỆN TẠI · HOSE · ${clock(now.at)} ngày ${formatDay(report.day)} · hôm nay so với ${o.base} phiên trước`]
    : [`DÒNG TIỀN · HOSE · ${period} tới ${formatDay(report.day)} so với ${o.base} phiên trước`];
  if (now?.partial != null && now.partial < 1) {
    const how = now.paced ? 'theo nhịp cùng giờ 20 phiên trước' : 'chia đều theo thời gian';
    lines.push(`Phiên mới qua ${Math.round(now.partial * 100)}% · GTGD hôm nay ước cả phiên ${how}`);
  }
  lines.push(`Cả sàn: ${billions(report.total5)} tỷ/phiên${now ? ' (ước)' : ''} · ${fmt(report.total5 / report.totalBase)} lần TB${o.base} · ${report.count} mã từ ${fmt(o.minValue / 1e9)} tỷ/phiên`);
  lines.push(...pulseLines(pulse, { estimated: Boolean(now) }));

  // Mỗi ngành vài dòng ngắn, mỗi mã một dòng: trong khung chat trên điện thoại, một dòng dài
  // chừng hai trăm ký tự gãy thành một khối chữ không ai dò được con số nào của ngành nào.
  const sectorLines = (s, i) => [
    `${i + 1}. ${s.name}`,
    `   Tỷ trọng ${fmt(s.share5)}% (${signedPoints(s.shift)}) · GTGD ${fmt(s.ratio)} lần TB${o.base}`,
    `   Giá ${signed(s.ret5)} ${period} · ${signed(s.ret20)} 20 phiên · ${Math.round(s.breadth)}% mã tăng`,
  ];
  const memberLines = (s, pick) => s.members
    .filter(pick)
    .filter((f) => f.value5 >= o.tradableValue)
    .slice(0, perSector)
    .map((f) => {
      const state = label(f.symbol);
      return `   • ${f.symbol} ${money(f.close)} ${signed(f.ret5)} · GTGD ${fmt(f.ratio)} lần${state ? ` · ${state}` : ''}`;
    });

  const inflow = sectors.filter((s) => s.shift > 0 && s.ret5 > 0).slice(0, limit);
  lines.push('', 'Hút tiền — tỷ trọng tăng, giá tăng:');
  if (!inflow.length) lines.push('   Không ngành nào — tiền không dồn về đâu rõ rệt.');
  inflow.forEach((s, i) => lines.push(...(i ? [''] : []), ...sectorLines(s, i), ...memberLines(s, (f) => f.ret5 > 0)));

  const selling = sectors.filter((s) => s.shift > 0 && s.ret5 <= 0).slice(0, limit);
  if (selling.length) {
    lines.push('', 'Giao dịch tăng nhưng giá giảm — có thể đang bị bán ra:');
    selling.forEach((s, i) => lines.push(...(i ? [''] : []), ...sectorLines(s, i), ...memberLines(s, (f) => f.ret5 <= 0)));
  }

  const outflow = sectors.filter((s) => s.shift < 0).reverse().slice(0, Math.min(3, limit));
  if (outflow.length) {
    lines.push('', 'Rút tiền — tỷ trọng giảm nhiều nhất:');
    outflow.forEach((s, i) => lines.push(`${i + 1}. ${s.name} · tỷ trọng ${fmt(s.share5)}% (${signedPoints(s.shift)}) · giá ${signed(s.ret5)} ${period}`));
  }

  lines.push('', `Tỷ trọng: phần của ngành trong GTGD cả sàn, (±) là đổi so với ${o.base} phiên trước.`);
  lines.push(`Mã kể tên: GTGD từ ${fmt(o.tradableValue / 1e9)} tỷ/phiên, xếp theo tiền tăng thêm.`);
  lines.push('Thông tin dòng tiền, chưa backtest — không phải khuyến nghị đầu tư.');
  return lines.join('\n');
}

// ---- tiện ích ----------------------------------------------------------------------------------

function pct(from, to) {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}
const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const fmt = (value) => one.format(value);
const signed = (value) => `${value > 0 ? '+' : ''}${one.format(value)}%`;
const signedPoints = (value) => `${value > 0 ? '+' : ''}${one.format(value)} điểm`;
const billions = (value) => Math.round(value / 1e9).toLocaleString('vi-VN');
