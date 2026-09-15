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
