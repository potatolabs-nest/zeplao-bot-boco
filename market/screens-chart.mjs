// Hình cho ba bộ lọc cả rổ `!dongtien`, `!manh`, `!hoiphuc`, và tấm infographic của `!strategy`.
//
// Chữ của ba lệnh ấy vẫn đi kèm, trong cùng một tin. Hình làm việc mà chữ làm kém: `!dongtien` so
// hai chục ngành trên hai chiều một lúc — tỷ trọng và giá — mà chữ thì phải cắt còn vài ngành cho
// vừa một tin; `!manh` / `!hoiphuc` thì cho thấy ngay mã nào đang sát pivot, mã nào đã chạy xa, mã
// nào cắt lỗ sâu, điều mà một dãy con số bắt người đọc tự hình dung.
//
// Cùng bảng màu và cỡ chữ với hình `!ptkt`, và cùng một luật: màu không bao giờ là tín hiệu duy nhất.
// Thanh ngành đặc / sọc / nhạt, vạch giá liền / đứt — người mù màu đỏ-lục vẫn đọc được.
//
// File này không biết gì về mạng: vào là bài đã chấm, ra là chuỗi SVG.
import { formatDay } from './chart.mjs';
import { money } from './quote.mjs';
import { STATUS as STRONG } from './strength.mjs';
import { STATUS as REBOUND } from './rebound.mjs';
import { PHASES, exposureText, nowText, phaseOf, phaseReasons } from './strategy.mjs';

const W = 1000;
const SCALE = 2;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

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
const PALE = '#dcdad2';

// ---- !dongtien ----------------------------------------------------------------------------------

const FLOW = { name: 300, left: 320, right: 700, value: 724, row: 42, top: 236 };

/**
 * Mọi ngành xếp hạng, mỗi ngành một thanh: dài theo mức đổi tỷ trọng, sang phải là tiền vào.
 *
 * Ba kiểu thanh đúng ba nhóm trong tin chữ: đặc xanh là hút tiền (tỷ trọng tăng, giá tăng), sọc
 * cam là giao dịch tăng mà giá giảm — có thể đang bị bán ra, nhạt là rút tiền.
 */
export function flowSvg(report, { now = null, recent = 5, base = 60 } = {}) {
  const sectors = report.sectors;
  if (!sectors.length) return null;
  const H = FLOW.top + sectors.length * FLOW.row + 96;

  const shifts = sectors.map((s) => s.shift);
  const low = Math.min(0, ...shifts);
  const high = Math.max(0, ...shifts);
  const span = high - low || 1;
  const x = (value) => FLOW.left + ((value - low) / span) * (FLOW.right - FLOW.left);
  const zero = x(0);

  const period = recent === 1 ? 'hôm nay' : `${recent} phiên`;
  const when = now
    ? `Hôm nay so với ${base} phiên trước · ${formatDay(report.day)}, GTGD ước cả phiên`
    : `${period} tới ${formatDay(report.day)} so với ${base} phiên trước`;
  const total = `Cả sàn ${Math.round(report.total5 / 1e9).toLocaleString('vi-VN')} tỷ/phiên${now ? ' (ước)' : ''} · ${fmt(report.total5 / report.totalBase)} lần TB${base} · ${report.count} mã`;

  const rows = sectors.map((s, i) => {
    const y = FLOW.top + i * FLOW.row;
    const kind = s.shift > 0 ? (s.ret5 > 0 ? 'in' : 'sold') : 'out';
    const from = Math.min(zero, x(s.shift));
    const width = Math.max(2, Math.abs(x(s.shift) - zero));
    const fill = kind === 'in' ? UP : kind === 'sold' ? 'url(#sold)' : PALE;
    const stroke = kind === 'sold' ? CAUTION : kind === 'out' ? MUTED : UP;
    const band = i % 2 ? '' : `<rect x="24" y="${y}" width="${W - 48}" height="${FLOW.row}" fill="#f3f2ee"/>`;
    return `${band}
  <text x="${FLOW.name}" y="${y + 28}" text-anchor="end" font-size="21" fill="${INK}">${escapeXml(short(s.name, 26))}</text>
  <rect x="${r(from)}" y="${y + 9}" width="${r(width)}" height="${FLOW.row - 18}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
  <text x="${FLOW.value}" y="${y + 28}" font-size="21" fill="${INK}"><tspan font-weight="700">${signed(s.shift, '')}</tspan><tspan fill="${s.ret5 > 0 ? UP : s.ret5 < 0 ? DOWN : SECONDARY}" dx="12">${s.ret5 > 0 ? '▲' : s.ret5 < 0 ? '▼' : '▬'}</tspan><tspan fill="${SECONDARY}" dx="4">${signed(s.ret5, '%')}</tspan></text>`;
  }).join('');

  const bottom = FLOW.top + sectors.length * FLOW.row;
  const axis = ticks(low, high, 4).map((value) => `<line x1="${r(x(value))}" y1="${FLOW.top}" x2="${r(x(value))}" y2="${bottom}" stroke="${value === 0 ? AXIS : GRID}" stroke-width="${value === 0 ? 2 : 1}"/>
  <text x="${r(x(value))}" y="${bottom + 28}" text-anchor="middle" font-size="18" fill="${MUTED}">${signed(value, '')}</text>`).join('');

  const key = (x0, swatch, text) => `${swatch(x0)}<text x="${x0 + 34}" y="${FLOW.top - 42}" font-size="19" fill="${SECONDARY}">${text}</text>`;
  const legend = [
    key(36, (at) => `<rect x="${at}" y="${FLOW.top - 60}" width="24" height="22" fill="${UP}"/>`, 'Hút tiền: tỷ trọng tăng, giá tăng'),
    key(386, (at) => `<rect x="${at}" y="${FLOW.top - 60}" width="24" height="22" fill="url(#sold)" stroke="${CAUTION}" stroke-width="1.5"/>`, 'Tăng giao dịch, giá giảm'),
    key(676, (at) => `<rect x="${at}" y="${FLOW.top - 60}" width="24" height="22" fill="${PALE}" stroke="${MUTED}" stroke-width="1.5"/>`, 'Rút tiền'),
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs><pattern id="sold" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#fbe3d8"/><rect width="5" height="10" fill="${CAUTION}"/></pattern></defs>
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="36" y="66" font-size="42" font-weight="800" fill="${INK}">Dòng tiền theo ngành · HOSE</text>
  <text x="36" y="104" font-size="22" fill="${SECONDARY}">${escapeXml(when)}</text>
  <text x="36" y="136" font-size="22" fill="${SECONDARY}">${escapeXml(total)}</text>
  ${legend}
  <text x="${FLOW.left}" y="${FLOW.top - 12}" font-size="18" fill="${MUTED}">Đổi tỷ trọng trong GTGD cả sàn (điểm %)</text>
  <text x="${FLOW.value}" y="${FLOW.top - 12}" font-size="18" fill="${MUTED}">Điểm % · giá ${period}</text>
  ${rows}
  ${axis}
  <text x="36" y="${H - 26}" font-size="18" fill="${MUTED}">Thông tin dòng tiền, chưa backtest — không phải khuyến nghị đầu tư.</text>
</svg>`;
}

// ---- !manh, !hoiphuc ----------------------------------------------------------------------------

/// Nhiều nhất chừng này ô: hai cột, bốn hàng — trên điện thoại một ô còn rộng chừng nửa màn hình.
export const MOST_CELLS = 8;
/// Số phiên vẽ trong mỗi ô: đủ thấy nền giá và đáy, không đủ để nến dính vào nhau.
const CELL_SESSIONS = 60;
const CELL = { width: 466, height: 318, gap: 20, left: 24, top: 168 };

/**
 * Lưới chart nhỏ, mỗi mã một ô: giá 60 phiên, vạch pivot (đứt đen), cắt lỗ (liền đỏ), và với
 * `!hoiphuc` thêm vạch bán (đứt xanh). Cùng thứ tự với tin chữ — mua được trước, rồi tới mã đang chờ.
 *
 * `rowsOf(mã)` trả nến ngày đã dùng để chấm. `null` khi không có mã nào để vẽ: khi ấy tin chữ một
 * mình đã nói hết ("chưa có mã nào ở điểm mua"), và một khung trống không nói thêm được gì.
 */
export function basketSvg(kind, report, rowsOf, { groupOf = () => '', now = null } = {}) {
  const picked = (kind === 'strong' ? strongPicks(report) : reboundPicks(report)).slice(0, MOST_CELLS);
  const cells = picked
    .map((result) => ({ result, rows: (rowsOf(result.symbol) ?? []).slice(-CELL_SESSIONS) }))
    .filter(({ rows }) => rows.length >= 2);
  if (!cells.length) return null;

  const rowsCount = Math.ceil(cells.length / 2);
  const H = CELL.top + rowsCount * (CELL.height + CELL.gap) + 60;
  const name = kind === 'strong' ? 'Mạnh' : 'Hồi phục';
  const day = `${now ? 'đang giao dịch · ' : 'phiên '}${formatDay(report.day)}`;

  const legend = [
    `<line x1="36" y1="132" x2="70" y2="132" stroke="${INK}" stroke-width="2.5" stroke-dasharray="8 5"/><text x="80" y="139" font-size="19" fill="${SECONDARY}">Pivot — điểm mua</text>`,
    `<line x1="270" y1="132" x2="304" y2="132" stroke="${DOWN}" stroke-width="3"/><text x="314" y="139" font-size="19" fill="${SECONDARY}">Cắt lỗ</text>`,
    kind === 'rebound' ? `<line x1="410" y1="132" x2="444" y2="132" stroke="${UP}" stroke-width="3" stroke-dasharray="3 4"/><text x="454" y="139" font-size="19" fill="${SECONDARY}">Bán</text>` : '',
  ].join('');

  const drawn = cells.map(({ result, rows }, i) => cellSvg(kind, result, rows, groupOf(result.symbol), {
    x: CELL.left + (i % 2) * (CELL.width + CELL.gap),
    y: CELL.top + Math.floor(i / 2) * (CELL.height + CELL.gap),
  })).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="36" y="66" font-size="42" font-weight="800" fill="${INK}">${name} · VN30 + Midcap</text>
  <text x="36" y="102" font-size="22" fill="${SECONDARY}">${escapeXml(`${day} · ${CELL_SESSIONS} phiên gần nhất, giá đóng cửa`)}</text>
  ${legend}
  ${drawn}
  <text x="36" y="${H - 26}" font-size="18" fill="${MUTED}">Tín hiệu tự động, không phải khuyến nghị đầu tư.</text>
</svg>`;
}

/// Mã dẫn dắt theo đúng thứ tự tin `!manh`: vượt nền, vùng mua, rồi mã chưa có điểm vào.
function strongPicks(report) {
  const leaders = report.results.filter((r) => r.leader);
  const byQuality = (a, b) => b.score - a.score || b.rsRank - a.rsRank;
  return [
    ...leaders.filter((r) => r.status === 'breakout').sort(byQuality),
    ...leaders.filter((r) => r.status === 'setup').sort(byQuality),
    ...leaders.filter((r) => r.status !== 'breakout' && r.status !== 'setup').sort((a, b) => b.rsRank - a.rsRank),
  ];
}

/// Mã đã xác nhận đáy theo đúng thứ tự tin `!hoiphuc`.
function reboundPicks(report) {
  const candidates = report.results.filter((r) => r.candidate);
  const byQuality = (a, b) => b.plan.rr - a.plan.rr || b.score - a.score;
  return [
    ...candidates.filter((r) => r.status === 'breakout').sort(byQuality),
    ...candidates.filter((r) => r.status === 'setup').sort(byQuality),
    ...candidates.filter((r) => r.status !== 'breakout' && r.status !== 'setup').sort(byQuality),
  ];
}

function cellSvg(kind, result, rows, group, { x, y }) {
  const p = result.plan;
  const status = (kind === 'strong' ? STRONG : REBOUND)[result.status];
  // Mua được, chờ vượt pivot, hay chưa có điểm vào — nhãn đặc, viền, hay xám.
  const badge = result.status === 'breakout' ? { fill: UP, ink: '#ffffff', stroke: UP }
    : result.status === 'setup' ? { fill: SURFACE, ink: FAST, stroke: FAST }
      : { fill: '#eeede8', ink: SECONDARY, stroke: AXIS };

  const plot = { left: x + 16, right: x + CELL.width - 92, top: y + 92, bottom: y + CELL.height - 52 };
  const closes = rows.map((row) => row.close);
  const marks = [
    { value: p.pivot, color: INK, dash: '8 5', width: 2.5, label: 'pivot' },
    { value: p.stop, color: DOWN, dash: '', width: 3, label: 'cắt lỗ' },
    ...(kind === 'rebound' ? [{ value: p.target, color: UP, dash: '3 4', width: 3, label: 'bán' }] : []),
  ].filter((mark) => Number.isFinite(mark.value) && mark.value > 0);
  const [low, high] = padded(Math.min(...closes, ...marks.map((m) => m.value)), Math.max(...closes, ...marks.map((m) => m.value)));
  const py = (value) => plot.bottom - ((value - low) / (high - low)) * (plot.bottom - plot.top);
  const px = (i) => plot.left + (i / (closes.length - 1)) * (plot.right - plot.left);

  const line = closes.map((value, i) => `${i ? 'L' : 'M'}${r(px(i))},${r(py(value))}`).join('');
  const area = `${line}L${r(px(closes.length - 1))},${plot.bottom}L${plot.left},${plot.bottom}Z`;
  // Nhãn vạch nằm ngoài khung bên phải; hai vạch sát nhau thì đẩy nhãn ra cho khỏi đè.
  const labels = marks.map((mark) => ({ ...mark, at: py(mark.value) })).sort((a, b) => a.at - b.at);
  for (let i = 1; i < labels.length; i++) labels[i].at = Math.max(labels[i].at, labels[i - 1].at + 22);

  const arrow = result.change > 0 ? '▲' : result.change < 0 ? '▼' : '▬';
  const arrowColor = result.change > 0 ? UP : result.change < 0 ? DOWN : MUTED;
  const statusWidth = Math.round(status.length * 11 + 28);
  const foot = kind === 'strong'
    ? `vào ${money(p.entry)} · cắt lỗ ${money(p.stop)} (${signed(-p.risk, '%')})`
    : `vào ${money(p.entry)} · cắt lỗ ${money(p.stop)} · bán ${money(p.target)} (${signed(p.gain, '%')})`;

  return `<g>
  <rect x="${x}" y="${y}" width="${CELL.width}" height="${CELL.height}" rx="12" fill="#ffffff" stroke="${GRID}" stroke-width="1.5"/>
  <text x="${x + 16}" y="${y + 40}" fill="${INK}"><tspan font-size="30" font-weight="800">${escapeXml(result.symbol)}</tspan>${group ? `<tspan dx="8" font-size="18" fill="${MUTED}">${escapeXml(group)}</tspan>` : ''}</text>
  <rect x="${x + CELL.width - 16 - statusWidth}" y="${y + 16}" width="${statusWidth}" height="32" rx="16" fill="${badge.fill}" stroke="${badge.stroke}" stroke-width="1.5"/>
  <text x="${x + CELL.width - 16 - statusWidth / 2}" y="${y + 38}" text-anchor="middle" font-size="18" font-weight="700" fill="${badge.ink}">${escapeXml(status)}</text>
  <text x="${x + 16}" y="${y + 72}" font-size="22" fill="${INK}"><tspan font-weight="600">${money(result.close)}</tspan><tspan dx="8" fill="${arrowColor}" font-size="18">${arrow}</tspan><tspan dx="4" fill="${SECONDARY}">${signed(result.change, '%')}</tspan><tspan dx="10" fill="${SECONDARY}" font-size="19">· pivot ${signed(p.toPivot, '%')}</tspan></text>
  <path d="${area}" fill="#eef3f9"/>
  <path d="${line}" fill="none" stroke="${FAST}" stroke-width="2.5" stroke-linejoin="round"/>
  ${marks.map((mark) => `<line x1="${plot.left}" y1="${r(py(mark.value))}" x2="${plot.right}" y2="${r(py(mark.value))}" stroke="${mark.color}" stroke-width="${mark.width}"${mark.dash ? ` stroke-dasharray="${mark.dash}"` : ''}/>`).join('')}
  ${labels.map((mark) => `<text x="${plot.right + 8}" y="${r(mark.at + 6)}" font-size="17" fill="${mark.color === INK ? SECONDARY : mark.color}">${money(mark.value)}</text>`).join('')}
  <circle cx="${r(px(closes.length - 1))}" cy="${r(py(closes.at(-1)))}" r="5" fill="${FAST}"/>
  <text x="${x + 16}" y="${y + CELL.height - 18}" font-size="19" fill="${SECONDARY}">${escapeXml(foot)}</text>
</g>`;
}

// ---- !strategy ----------------------------------------------------------------------------------

/// Màu của từng pha. Không bao giờ đứng một mình: pha hiện tại còn được tô đặc, chữ trắng, có mũi tên.
const PHASE_COLOR = { down: DOWN, sideways: CAUTION, up: UP };
const TONE = {
  up: { mark: '▲', color: UP },
  down: { mark: '▼', color: DOWN },
  flat: { mark: '●', color: CAUTION },
};

/**
 * Một tấm infographic cho pha hiện tại: thanh ba pha có pha hiện tại tô đặc, lý do, thước tỷ trọng
 * cổ phiếu, sáu ô hành động, điểm mua / chốt lời, và điều kiện chuyển pha. `null` khi không xác
 * định được pha — tin chữ khi ấy đã nói ra lý do.
 */
export function strategySvg(market, pulse, { day = '' } = {}) {
  const phase = phaseOf(market, pulse);
  if (!phase) return null;
  const p = PHASES[phase];
  const color = PHASE_COLOR[phase];
  const parts = [];
  let y = 0;

  // Thanh ba pha, trái sang phải từ xấu tới tốt.
  const order = ['down', 'sideways', 'up'];
  const segment = { top: 150, height: 64, gap: 14, width: (W - 72 - 2 * 14) / 3 };
  order.forEach((key, i) => {
    const x = 36 + i * (segment.width + segment.gap);
    const current = key === phase;
    parts.push(`<rect x="${r(x)}" y="${segment.top}" width="${r(segment.width)}" height="${segment.height}" rx="12" fill="${current ? PHASE_COLOR[key] : '#eeede8'}" stroke="${current ? PHASE_COLOR[key] : AXIS}" stroke-width="1.5"/>`);
    parts.push(`<text x="${r(x + segment.width / 2)}" y="${segment.top + 42}" text-anchor="middle" font-size="${current ? 28 : 22}" font-weight="${current ? 800 : 600}" fill="${current ? '#ffffff' : MUTED}">${escapeXml(PHASES[key].name)}</text>`);
    if (current) {
      const cx = x + segment.width / 2;
      parts.push(`<path d="M${r(cx - 12)},${segment.top - 22}L${r(cx + 12)},${segment.top - 22}L${r(cx)},${segment.top - 6}Z" fill="${INK}"/>`);
      parts.push(`<text x="${r(cx + 20)}" y="${segment.top - 8}" font-size="18" font-weight="700" fill="${INK}">hiện tại</text>`);
    }
  });
  y = segment.top + segment.height + 40;
  parts.push(`<text x="36" y="${y}" font-size="22" fill="${SECONDARY}">Mục tiêu: <tspan font-weight="700" fill="${INK}">${escapeXml(p.goal)}</tspan></text>`);

  // Lý do: mỗi tiêu chí một nhãn, có ký hiệu chiều chứ không chỉ có màu.
  y += 24;
  let chipX = 36;
  for (const reason of phaseReasons(market, pulse)) {
    const tone = TONE[reason.tone];
    const width = Math.round(reason.text.length * 9.6 + 54);
    if (chipX + width > W - 36) { chipX = 36; y += 48; }
    parts.push(`<rect x="${chipX}" y="${y}" width="${width}" height="38" rx="19" fill="#ffffff" stroke="${GRID}" stroke-width="1.5"/>`);
    parts.push(`<text x="${chipX + 16}" y="${y + 26}" font-size="19" fill="${INK}"><tspan fill="${tone.color}" font-weight="700">${tone.mark}</tspan><tspan dx="8">${escapeXml(reason.text)}</tspan></text>`);
    chipX += width + 12;
  }
  y += 38 + 56;

  // Thước tỷ trọng cổ phiếu 0–100%, khoảng nên giữ tô theo màu pha.
  const [low, high] = p.exposure;
  const bar = { left: 36, right: W - 36, height: 40 };
  const bx = (value) => bar.left + (value / 100) * (bar.right - bar.left);
  parts.push(`<text x="36" y="${y}" font-size="24" font-weight="700" fill="${INK}">Tỷ trọng cổ phiếu</text>`);
  parts.push(`<text x="${W - 36}" y="${y + 4}" text-anchor="end" font-size="40" font-weight="800" fill="${color}">${exposureText(phase)}</text>`);
  y += 22;
  parts.push(`<rect x="${bar.left}" y="${y}" width="${bar.right - bar.left}" height="${bar.height}" rx="8" fill="#f3f2ee" stroke="${GRID}" stroke-width="1.5"/>`);
  parts.push(`<rect x="${r(bx(low))}" y="${y}" width="${r(Math.max(6, bx(high) - bx(low)))}" height="${bar.height}" rx="8" fill="${color}"/>`);
  for (const tick of [0, 20, 40, 60, 80, 100]) {
    parts.push(`<line x1="${r(bx(tick))}" y1="${y + bar.height}" x2="${r(bx(tick))}" y2="${y + bar.height + 8}" stroke="${AXIS}" stroke-width="1.5"/>`);
    parts.push(`<text x="${r(bx(tick))}" y="${y + bar.height + 30}" text-anchor="${tick === 0 ? 'start' : tick === 100 ? 'end' : 'middle'}" font-size="17" fill="${MUTED}">${tick}%</text>`);
  }
  y += bar.height + 66;
  parts.push(`<text x="36" y="${y}" font-size="19" fill="${SECONDARY}">Phần còn lại giữ tiền mặt: <tspan font-weight="700" fill="${INK}">${100 - high}–${100 - low}%</tspan></text>`);
  y += 28;

  // Sáu ô hành động, ba cột.
  const box = { width: (W - 72 - 2 * 18) / 3, height: 124, gap: 18 };
  p.cards.forEach((item, i) => {
    const x = 36 + (i % 3) * (box.width + box.gap);
    const top = y + Math.floor(i / 3) * (box.height + box.gap);
    parts.push(`<rect x="${r(x)}" y="${top}" width="${r(box.width)}" height="${box.height}" rx="12" fill="#ffffff" stroke="${GRID}" stroke-width="1.5"/>`);
    parts.push(`<rect x="${r(x)}" y="${top}" width="6" height="${box.height}" rx="3" fill="${color}"/>`);
    parts.push(`<text x="${r(x + 22)}" y="${top + 34}" font-size="19" fill="${SECONDARY}">${escapeXml(item.label)}</text>`);
    parts.push(`<text x="${r(x + 22)}" y="${top + 80}" font-size="36" font-weight="800" fill="${INK}">${escapeXml(item.value)}</text>`);
    if (item.note) parts.push(`<text x="${r(x + 22)}" y="${top + 108}" font-size="17" fill="${MUTED}">${escapeXml(item.note)}</text>`);
  });
  y += 2 * box.height + box.gap + 52;

  // Điểm mua, chốt lời, và việc lúc này — chữ dài, xuống dòng theo bề ngang.
  const paragraph = (title, text, accent = INK) => {
    parts.push(`<text x="36" y="${y}" font-size="22" font-weight="700" fill="${accent}">${escapeXml(title)}</text>`);
    y += 34;
    for (const line of wrapped(text, 82)) {
      parts.push(`<text x="36" y="${y}" font-size="21" fill="${INK}">${escapeXml(line)}</text>`);
      y += 30;
    }
    y += 18;
  };
  paragraph('Điểm mua ưu tiên', p.entry);
  paragraph('Chốt lời', p.exit);

  const now = nowText(phase, pulse);
  if (now) {
    const lines = wrapped(now, 80);
    const height = 50 + lines.length * 30;
    parts.push(`<rect x="24" y="${y - 6}" width="${W - 48}" height="${height}" rx="12" fill="#eef3f9" stroke="${FAST}" stroke-width="2"/>`);
    y += 26;
    parts.push(`<text x="44" y="${y}" font-size="22" font-weight="700" fill="${FAST}">Lúc này</text>`);
    y += 32;
    for (const line of lines) {
      parts.push(`<text x="44" y="${y}" font-size="21" fill="${INK}">${escapeXml(line)}</text>`);
      y += 30;
    }
    y += 30;
  }

  parts.push(`<text x="36" y="${y}" font-size="22" font-weight="700" fill="${INK}">Chuyển pha khi</text>`);
  y += 34;
  for (const item of p.next) {
    const lines = wrapped(item, 80);
    lines.forEach((line, i) => {
      parts.push(`<text x="${i ? 62 : 36}" y="${y}" font-size="20" fill="${SECONDARY}">${i ? '' : '→  '}${escapeXml(line)}</text>`);
      y += 29;
    });
    y += 6;
  }

  const H = y + 50;
  const when = `${day ? `phiên ${formatDay(day)}` : ''}${market ? ` · VN-Index ${money(market.close)}` : ''}`.replace(/^ · /, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="36" y="66" font-size="42" font-weight="800" fill="${INK}">Chiến lược theo pha thị trường</text>
  <text x="36" y="102" font-size="22" fill="${SECONDARY}">${escapeXml(when)}</text>
  ${parts.join('\n  ')}
  <text x="36" y="${H - 22}" font-size="18" fill="${MUTED}">Quy tắc quản lý vốn chưa backtest — không phải khuyến nghị đầu tư.</text>
</svg>`;
}

/// Chia chữ thành dòng không quá `most` ký tự, ngắt ở khoảng trắng.
function wrapped(text, most) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > most) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---- tiện ích ----------------------------------------------------------------------------------

function padded(min, max) {
  const pad = (max - min) * 0.08 || max * 0.02 || 1;
  return [min - pad, max + pad];
}

function ticks(min, max, count = 5) {
  const raw = (max - min) / count || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  const out = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) out.push(Number(value.toFixed(6)));
  return out;
}

function short(text, most) {
  const value = String(text ?? '');
  return value.length > most ? `${value.slice(0, most - 1).trimEnd()}…` : value;
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

const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const fmt = (value) => one.format(value);
/// Có dấu, một chữ số lẻ. Làm tròn trước rồi mới xét dấu: `+0` và `-0` là hai cách nói sai một số không.
const signed = (value, unit) => {
  const shown = Math.round(value * 10) / 10 || 0;
  return `${shown > 0 ? '+' : ''}${one.format(shown)}${unit}`;
};
