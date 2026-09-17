// Khối ngoại mua bán gì trong từng phiên.
//
// Bảng mười phiên trên trang chi tiết có cột khối lượng và giá trị của cả thị trường; hai cột này
// tách riêng phần của nhà đầu tư nước ngoài. Đó là thứ người ta soi kỹ nhất trong một bảng lịch sử:
// cả thị trường khớp bao nhiêu thì nói lên độ sôi động, còn khối ngoại mua hay bán ròng lại là một
// dòng tiền có hướng, và hướng ấy thường kéo dài nhiều phiên.
//
// Nguồn là VNDirect finfo — cùng host với bảng phân ngành, và nó trả về sẵn cả khối lượng lẫn giá
// trị của hai chiều mua bán, nên không phải tự nhân giá với khối lượng rồi đoán.

const VNDIRECT = 'https://api-finfo.vndirect.com.vn/v4/foreigns';
const TIMEOUT_MS = 8000;
/// Số của một phiên đã đóng thì không đổi nữa; phiên đang chạy thì mười phút một lần là đủ mới.
const TTL_MS = 10 * 60 * 1000;
const ROWS = 12;

/**
 * Khối ngoại theo phiên, mới nhất trước, khoá theo ngày `YYYY-MM-DD`.
 *
 * Trả về `Map` rỗng khi nguồn không trả lời — bảng mười phiên vẫn dựng được, chỉ thiếu hai cột.
 * Một cái bảng thiếu hai cột còn dùng được; một trang chi tiết không mở ra được thì không.
 */
export function vndirectForeign({
  base = VNDIRECT, fetchImpl = fetch, timeout = TIMEOUT_MS, ttlMs = TTL_MS, now = () => Date.now(),
} = {}) {
  const kept = new Map();

  return {
    async rows(symbol, want = ROWS) {
      const code = String(symbol ?? '').toUpperCase();
      const held = kept.get(code);
      if (held && now() - held.at < ttlMs) return held.rows;

      const url = `${base}?q=code:${code}&sort=tradingDate:desc&size=${want}`;
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error(`khối ngoại trả lời ${response.status}`);

      const rows = foreignOf((await response.json())?.data);
      kept.set(code, { rows, at: now() });
      return rows;
    },
  };
}

/// Bản ghi thô thành `Map` ngày → hai chiều mua bán. Bản ghi thiếu ngày thì bỏ: một dòng không biết
/// thuộc phiên nào là một dòng không ghép được vào đâu.
export function foreignOf(data) {
  const found = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    const day = String(row?.tradingDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || found.has(day)) continue;
    found.set(day, {
      buyVolume: num(row.buyVol),
      sellVolume: num(row.sellVol),
      // Giá trị nguồn trả bằng **đồng**, còn cả bot nói chuyện bằng nghìn đồng — đổi ngay ở đây,
      // chỗ duy nhất biết đơn vị của nguồn này.
      buyValue: num(row.buyVal) / 1000,
      sellValue: num(row.sellVal) / 1000,
    });
  }
  return found;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
