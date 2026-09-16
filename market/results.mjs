// Kết quả kinh doanh theo cơ cấu doanh thu, dùng cho lệnh `!kq vic`.
//
// File này không biết gì về mạng: nó đọc kỳ người ta hỏi và dựng câu trả lời từ một báo cáo đã
// chuẩn hoá. Nguồn số liệu là một object có `segments(symbol, period)` — hiện là Vietcap
// (`market/vietcap.mjs`) — để bộ test thay bằng số giả và để đổi nguồn không phải sửa ở đây.
//
// Báo cáo chuẩn hoá:
//   { symbol, period: { year, quarter | null }, unit, measure, source,
//     segments: [{ name, value, previous | null }],
//     totals: [{ label, value, previous | null, margin }] }

import { money } from './quote.mjs';

/// Nhiều nhất chừng này dòng một câu trả lời; phần còn lại gộp thành "Khác".
export const MOST_SEGMENTS = 10;

const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/**
 * Kỳ người ta hỏi, từ phần sau mã: rỗng là quý gần nhất có số, `q2` là quý 2 gần nhất, `2025` là
 * cả năm 2025, `q2 2025` hay `q2/2025` là đúng quý ấy, `nam` / `năm` là năm gần nhất.
 * Trả `null` khi không đọc được.
 */
export function parseResultsPeriod(words = []) {
  const text = words.join(' ').toLowerCase().trim();
  if (!text) return { year: null, quarter: null, annual: false };
  if (/^(nam|năm|year|cả năm)$/.test(text)) return { year: null, quarter: null, annual: true };

  const quarterYear = /^q([1-4])(?:[\s/-]+(\d{4}))?$/.exec(text);
  if (quarterYear) return { year: quarterYear[2] ? Number(quarterYear[2]) : null, quarter: Number(quarterYear[1]), annual: false };

  const yearQuarter = /^(\d{4})[\s/-]+q([1-4])$/.exec(text);
  if (yearQuarter) return { year: Number(yearQuarter[1]), quarter: Number(yearQuarter[2]), annual: false };

  const year = /^(?:nam\s+|năm\s+)?(\d{4})$/.exec(text);
  if (year) return { year: Number(year[1]), quarter: null, annual: true };

  return null;
}

export function periodLabel(period) {
  if (!period?.year) return 'kỳ gần nhất';
  return period.quarter ? `Q${period.quarter}/${period.year}` : `năm ${period.year}`;
}

const pct = (value) => `${one.format(value)}%`;
const change = (value, previous) => {
  if (!Number.isFinite(value) || !Number.isFinite(previous) || previous <= 0) return null;
  const moved = ((value - previous) / previous) * 100;
  return `${moved > 0 ? '+' : moved < 0 ? '−' : ''}${one.format(Math.abs(moved))}% cùng kỳ`;
};
const amount = (value) => {
  const sign = value < 0 ? '−' : '';
  const size = Math.abs(value);
  return `${sign}${size >= 100 ? whole.format(size) : money(size)}`;
};

/**
 * Câu trả lời cho một báo cáo: mỗi dòng doanh thu một dòng, lớn trước, rồi một dòng tổng.
 *
 *   KQKD VIC · Q2/2026 · cơ cấu doanh thu (tỷ đồng)
 *   1. Doanh thu bán hàng — 100.202 (85,2%) · +12% cùng kỳ
 *   DT thuần 117.568 · LNG 29.496, biên 25,1% · LNST 15.294, biên 13%
 *
 * `DT`, `LNG`, `LNST`, `LNTT` là thuật ngữ trong từ điển, nên bấm vào được như mọi tin chữ khác.
 */
export function resultsMessage(report) {
  const segments = (report?.segments ?? []).filter((segment) => Number.isFinite(segment?.value) && segment.value !== 0);
  const totals = (report?.totals ?? []).filter((total) => Number.isFinite(total?.value));
  if (!segments.length && !totals.length) {
    return `${report?.symbol ?? ''} — chưa có số liệu báo cáo tài chính cho ${periodLabel(report?.period)}.`.trim();
  }

  const lines = [`KQKD ${report.symbol} · ${periodLabel(report.period)} · cơ cấu ${report.measure ?? 'doanh thu'}${report.unit ? ` (${report.unit})` : ''}`];

  if (segments.length) {
    const sorted = [...segments].sort((a, b) => b.value - a.value);
    const shown = sorted.slice(0, MOST_SEGMENTS);
    const rest = sorted.slice(MOST_SEGMENTS);
    if (rest.length) {
      const previous = rest.every((segment) => Number.isFinite(segment.previous)) ? rest.reduce((sum, segment) => sum + segment.previous, 0) : null;
      shown.push({ name: `Khác (${rest.length} dòng)`, value: rest.reduce((sum, segment) => sum + segment.value, 0), previous });
    }
    const base = segments.filter((segment) => segment.value > 0).reduce((sum, segment) => sum + segment.value, 0);
    shown.forEach((segment, index) => {
      const parts = [base > 0 && segment.value > 0 ? `${amount(segment.value)} (${pct((segment.value / base) * 100)})` : amount(segment.value)];
      const moved = change(segment.value, segment.previous);
      if (moved) parts.push(moved);
      lines.push(`${index + 1}. ${segment.name} — ${parts.join(' · ')}`);
    });
  } else {
    lines.push(`Kỳ này chưa có thuyết minh cơ cấu ${report.measure ?? 'doanh thu'}.`);
  }

  if (totals.length) {
    const head = totals[0];
    lines.push(totals.map((total) => {
      const margin = total.margin && head.value > 0 ? `, biên ${pct((total.value / head.value) * 100)}` : '';
      const moved = !total.margin ? change(total.value, total.previous) : null;
      return `${total.label} ${amount(total.value)}${margin}${moved ? ` (${moved})` : ''}`;
    }).join(' · '));
  }

  if (report.source) lines.push(`Nguồn: ${report.source}`);
  return lines.join('\n');
}

// ---- hình ----------------------------------------------------------------------------------------
//
// Thanh ngang, lớn trên cùng: so được các dòng sát nhau, điều mà một cái bánh tròn không làm được.
// Sau mỗi thanh là một thanh xám mờ của cùng kỳ năm trước, để tăng hay giảm nhìn là thấy, và ba ô
// số tổng ở trên. Một màu cho kỳ này — một chuỗi số, không phải tám thứ cần phân biệt.

const W = 1000;
const PAD = 40;
const SCALE = 2;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const INK = '#0b0b0b';
const SECONDARY = '#52514e';
const MUTED = '#898781';
const LINE = '#e1e0d9';
const SURFACE = '#fcfcfb';
const TILE = '#f4f4f1';
const BAR = '#2a78d6';
const GHOST = '#d9d7cf';
const UP = '#0b6b2f';
const DOWN = '#f0605d';

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clip = (text, most) => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);

function moved(value, previous) {
  if (!Number.isFinite(value) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((value - previous) / previous) * 100;
}

function delta(x, y, value, anchor = 'start') {
  if (!Number.isFinite(value)) return '';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '▬';
  const color = value > 0 ? UP : value < 0 ? DOWN : MUTED;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="18" fill="${SECONDARY}"><tspan fill="${color}">${arrow}</tspan> ${sign}${one.format(Math.abs(value))}% cùng kỳ</text>`;
}

/** Hình cho một báo cáo, hoặc `null` khi không có dòng nào để vẽ. */
export function resultsSvg(report) {
  const segments = (report?.segments ?? []).filter((segment) => Number.isFinite(segment?.value) && segment.value !== 0);
  const totals = (report?.totals ?? []).filter((total) => Number.isFinite(total?.value)).slice(0, 3);
  if (!segments.length && !totals.length) return null;

  const sorted = [...segments].sort((a, b) => b.value - a.value);
  const rows = sorted.slice(0, MOST_SEGMENTS);
  const rest = sorted.slice(MOST_SEGMENTS);
  if (rest.length) {
    const previous = rest.every((segment) => Number.isFinite(segment.previous)) ? rest.reduce((sum, segment) => sum + segment.previous, 0) : null;
    rows.push({ name: `Khác (${rest.length} dòng)`, value: rest.reduce((sum, segment) => sum + segment.value, 0), previous });
  }
  const base = segments.filter((segment) => segment.value > 0).reduce((sum, segment) => sum + segment.value, 0);

  const tilesTop = 132;
  const tilesHeight = totals.length ? 132 : 0;
  const legendY = tilesTop + tilesHeight + (totals.length ? 44 : 20);
  const rowsTop = legendY + 26;
  const rowHeight = 76;
  const footer = 56;
  const H = rowsTop + Math.max(rows.length, 1) * rowHeight + footer;

  const header = `<text x="${PAD}" y="66" font-size="38" font-weight="800" fill="${INK}">KQKD ${escapeXml(report.symbol)} · ${escapeXml(periodLabel(report.period))}</text>
  <text x="${PAD}" y="104" font-size="22" fill="${SECONDARY}">Cơ cấu ${escapeXml(report.measure ?? 'doanh thu')}${report.unit ? ` · ${escapeXml(report.unit)}` : ''}</text>`;

  const gap = 16;
  const tileWidth = totals.length ? (W - PAD * 2 - gap * (totals.length - 1)) / totals.length : 0;
  const head = totals[0];
  const tiles = totals.map((total, index) => {
    const x = PAD + index * (tileWidth + gap);
    const note = total.margin && head?.value > 0
      ? `<text x="${x + 20}" y="${tilesTop + 110}" font-size="18" fill="${SECONDARY}">biên ${one.format((total.value / head.value) * 100)}%</text>`
      : delta(x + 20, tilesTop + 110, moved(total.value, total.previous));
    return `<rect x="${x}" y="${tilesTop}" width="${tileWidth}" height="${tilesHeight}" rx="14" fill="${TILE}"/>
    <text x="${x + 20}" y="${tilesTop + 36}" font-size="20" fill="${SECONDARY}">${escapeXml(total.label)}</text>
    <text x="${x + 20}" y="${tilesTop + 78}" font-size="34" font-weight="700" fill="${INK}">${escapeXml(amount(total.value))}</text>
    ${note}`;
  }).join('');

  const hasPrevious = rows.some((row) => Number.isFinite(row.previous) && row.previous > 0);
  const legend = rows.length ? `<rect x="${PAD}" y="${legendY - 14}" width="18" height="14" rx="3" fill="${BAR}"/>
  <text x="${PAD + 26}" y="${legendY}" font-size="18" fill="${SECONDARY}">${escapeXml(periodLabel(report.period))}</text>
  ${hasPrevious ? `<rect x="${PAD + 150}" y="${legendY - 14}" width="18" height="14" rx="3" fill="${GHOST}"/>
  <text x="${PAD + 176}" y="${legendY}" font-size="18" fill="${SECONDARY}">Cùng kỳ năm trước</text>` : ''}` : '';

  // Chỗ bên phải thanh dài nhất cho con số, tỷ lệ và mũi tên cùng kỳ — thiếu thì chữ bị cắt ở mép hình.
  const labelSpace = 420;
  const plotWidth = W - PAD * 2 - labelSpace;
  const highest = Math.max(1, ...rows.flatMap((row) => [row.value, Number.isFinite(row.previous) ? row.previous : 0]));
  const width = (value) => (value > 0 ? Math.max(3, (value / highest) * plotWidth) : 0);

  const bars = rows.length ? rows.map((row, index) => {
    const y = rowsTop + index * rowHeight;
    const current = width(row.value);
    const ghost = Number.isFinite(row.previous) ? width(row.previous) : 0;
    const end = PAD + Math.max(current, ghost) + 12;
    const share = base > 0 && row.value > 0 ? ` (${one.format((row.value / base) * 100)}%)` : '';
    return `<text x="${PAD}" y="${y + 22}" font-size="21" fill="${INK}">${escapeXml(clip(row.name, 70))}</text>
    ${ghost ? `<rect x="${PAD}" y="${y + 34}" width="${ghost.toFixed(1)}" height="26" rx="4" fill="${GHOST}"/>` : ''}
    ${current ? `<rect x="${PAD}" y="${y + 38}" width="${current.toFixed(1)}" height="18" rx="4" fill="${BAR}"/>` : ''}
    <text x="${end.toFixed(1)}" y="${y + 54}" font-size="20" font-weight="600" fill="${INK}">${escapeXml(amount(row.value))}${escapeXml(share)}</text>
    ${delta((end + 12 + (amount(row.value).length + share.length) * 11).toFixed(1), y + 54, moved(row.value, row.previous))}`;
  }).join('') : `<text x="${PAD}" y="${rowsTop + 30}" font-size="20" fill="${SECONDARY}">Kỳ này chưa có thuyết minh cơ cấu ${escapeXml(report.measure ?? 'doanh thu')}.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  ${header}
  ${tiles}
  ${legend}
  ${bars}
  <line x1="${PAD}" y1="${H - footer + 8}" x2="${W - PAD}" y2="${H - footer + 8}" stroke="${LINE}" stroke-width="1"/>
  <text x="${PAD}" y="${H - 20}" font-size="17" fill="${MUTED}">${escapeXml(report.source ? `Nguồn: ${report.source}` : '')}</text>
</svg>`;
}

/**
 * Tin nhắn cho `!kq`: hình, và vài dòng chữ đi kèm — tiêu đề, dòng tổng, nguồn. Danh sách từng dòng
 * đã nằm trên hình nên không nhắc lại bằng chữ. Không vẽ được thì là cả câu trả lời bằng chữ.
 */
export function resultsRich(report) {
  const svg = resultsSvg(report);
  if (!svg) return resultsMessage(report);
  const lines = resultsMessage(report).split('\n');
  const text = [lines[0], ...lines.filter((line) => !/^\d+\. /.test(line)).slice(1)].join('\n');
  const period = report.period?.quarter ? `q${report.period.quarter}-${report.period.year}` : `${report.period?.year ?? ''}`;
  return {
    text,
    image: { fileName: `kq-${String(report.symbol).toLowerCase()}-${period}.svg`, svg },
    // Chữ ở đây là một bài để đọc, không phải chú thích của hình: có `rich` thì `say` gửi hình
    // riêng một tin để các thuật ngữ — DT, LNG, LNST — còn bấm mở được.
    rich: { blocks: [{ type: 'paragraph', text }] },
  };
}
