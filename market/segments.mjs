// Doanh thu theo mảng kinh doanh, đọc từ phần "báo cáo bộ phận" trong PDF báo cáo tài chính.
//
// Không có nguồn miễn phí nào công bố số này dạng dữ liệu, nên phải đọc chữ của chính báo cáo.
// Mỗi công ty, mỗi hãng kiểm toán trình bày một kiểu, nên việc đọc là một dãy mẫu (`CASES`) thử
// lần lượt. Nhưng dò trúng mẫu chưa phải là đọc đúng: một bảng vỡ cột vẫn cho ra những con số
// trông rất hợp lý. Thứ quyết định là **đối chiếu**: tổng các mảng đọc được phải khớp doanh thu
// của báo cáo kết quả kinh doanh (lấy từ nguồn có cấu trúc), sai lệch không quá `TOLERANCE`. Không
// khớp thì là đọc sai, thử mẫu sau; hết mẫu thì trả `null` — thà nói chưa đọc được còn hơn đưa số sai.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/// Sai lệch tối đa giữa tổng các mảng và doanh thu báo cáo, tính theo tỷ lệ.
export const TOLERANCE = 0.03;

const BILLION = 1e9;

/**
 * Một số tiền trong báo cáo, sang số: `1.234.567` hay `1,234,567` là một triệu hai trăm…, `(1.234)`
 * là số âm, `-` hay `–` đứng một mình là không. `null` khi không phải số.
 */
export function parseAmount(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  if (/^[-–—]$/.test(text)) return 0;
  const negative = /^\(.*\)$/.test(text) || /^[-–−]/.test(text);
  text = text.replace(/^\(|\)$/g, '').replace(/^[-–−]\s*/, '');
  if (!/^\d{1,3}([.,\s]\d{3})*$|^\d+$/.test(text)) return null;
  const value = Number(text.replace(/[.,\s]/g, ''));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/**
 * Bao nhiêu đồng một đơn vị của bảng, đọc từ dòng "Đơn vị tính" gần nhất; mặc định là đồng.
 */
export function unitFactor(text) {
  const found = /đơn\s*vị(?:\s*tính)?\s*[:：]?\s*([^\n]{0,40})/iu.exec(String(text ?? ''));
  const unit = (found?.[1] ?? '').toLowerCase();
  if (/tỷ/u.test(unit)) return BILLION;
  if (/triệu/u.test(unit)) return 1e6;
  if (/nghìn|ngàn/u.test(unit)) return 1e3;
  return 1;
}

/** Tổng các mảng so với doanh thu báo cáo. */
export function crossCheck(segments, total, tolerance = TOLERANCE) {
  const sum = segments.reduce((all, segment) => all + (Number.isFinite(segment.value) ? segment.value : 0), 0);
  if (!Number.isFinite(total) || total <= 0) return { ok: false, sum, gap: null };
  const gap = Math.abs(sum - total) / total;
  return { ok: gap <= tolerance, sum, gap };
}

/**
 * Chạy các mẫu đọc lần lượt trên chữ của báo cáo; trả kết quả của mẫu đầu tiên mà tổng khớp.
 *
 * Mỗi mẫu là `{ name, read(text) }`, trả `[{ name, value }]` với `value` tính bằng tỷ đồng, hoặc
 * rỗng khi không nhận ra kiểu trình bày của mình. `total` cũng bằng tỷ đồng.
 */
export function readSegments(text, { total, cases = CASES, tolerance = TOLERANCE } = {}) {
  const tried = [];
  for (const reader of cases) {
    let found = [];
    try {
      found = reader.read(text) ?? [];
    } catch {
      found = [];
    }
    if (!found.length) continue;
    const check = crossCheck(found, total, tolerance);
    tried.push({ reader: reader.name, ...check });
    if (check.ok) return { segments: found, reader: reader.name, check, tried };
  }
  return { segments: null, reader: null, check: null, tried };
}

/// Các mẫu đọc, thêm dần theo từng kiểu trình bày gặp trong báo cáo thật.
export const CASES = [];

/**
 * Kết quả đã đọc, lưu theo mã và kỳ. Báo cáo tài chính đã công bố thì không đổi, nên mỗi báo cáo
 * chỉ phải tải và đọc một lần. Ghi vào file tạm rồi đổi tên, như file trạng thái của bot.
 */
export function segmentCache(path) {
  let memory = null;
  const load = () => {
    if (memory) return memory;
    try {
      memory = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      memory = {};
    }
    return memory;
  };
  const keyOf = (symbol, year, quarter) => `${String(symbol).toUpperCase()}:${year}:${quarter ?? 'Y'}`;

  return {
    get(symbol, year, quarter) {
      return load()[keyOf(symbol, year, quarter)] ?? null;
    },
    set(symbol, year, quarter, value) {
      const all = load();
      all[keyOf(symbol, year, quarter)] = value;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(`${path}.tmp`, JSON.stringify(all));
        renameSync(`${path}.tmp`, path);
      } catch (problem) {
        console.error(`không ghi được bộ nhớ báo cáo bộ phận: ${problem}`);
      }
    },
  };
}
