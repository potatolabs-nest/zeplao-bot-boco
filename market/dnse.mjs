// DNSE, cho những gì feed công khai không có.
//
// Feed ở `vps.mjs` phủ cổ phiếu ba sàn và chứng chỉ quỹ, và không phủ **chỉ số** với **phái
// sinh**: `/vnindex` và `/vn30f1m` gõ vào đó chỉ nhận về một mảng rỗng. File này lấp chỗ ấy, và
// đứng sau feed kia trong dây nguồn ở `chain.mjs` — cái gì nhanh và đủ thì hỏi trước.
//
// Hai tầng, và chúng độc lập với nhau:
//
//   1. **Chart** — công khai, không khoá. Nến ngày. Hai cây nến cuối cho ra giá hiện tại và giá
//      đóng cửa phiên trước, tức là đủ để nói tăng giảm bao nhiêu. Chạy được ngay, không cần
//      xin gì của ai.
//   2. **Secdef** — có khoá, tuỳ chọn. Trần, sàn và **giá tham chiếu chính thức**. Nó sửa đúng
//      một chỗ mà tầng trên sai: ngày chốt quyền, giá tham chiếu được điều chỉnh và không còn
//      bằng giá đóng cửa hôm trước, nên một cổ phiếu đứng giá sẽ hiện lên là giảm 5% — con số
//      sai duy nhất ở đây mà trông hoàn toàn hợp lý.
//
// Khoá đọc từ biến môi trường và **không có trong repo**: `DNSE_API_KEY` và `DNSE_API_SECRET`.
// Không có chúng thì tầng 2 không tồn tại và bot vẫn chạy, chỉ là không có trần sàn cho những mã
// phải đi đường này. Đó là mặc định, và mặc định ấy là thứ giữ cho repo này không có bí mật nào.
import { createHmac } from 'node:crypto';

import { quote } from './quote.mjs';

export const CHART = process.env.DNSE_CHART ?? 'https://services.entrade.com.vn/chart-api/v2/ohlcs';
export const OPENAPI = process.env.DNSE_API ?? 'https://openapi.dnse.com.vn';

const TIMEOUT_MS = 8000;

/// Đủ dài để bắc qua một kỳ nghỉ lễ. Cần đúng hai cây nến — hôm nay và phiên liền trước — nhưng
/// hỏi đúng hai ngày thì mùng sáu Tết sẽ không có cây nào.
const LOOKBACK_DAYS = 21;

const INDEXES = new Set(['VNINDEX', 'VN30', 'VN100', 'VNALLSHARE', 'VNXALL', 'UPCOM', 'HNX', 'HNX30']);

/**
 * Mã này là loại gì, vì đường lấy nến chia theo loại.
 *
 * Đoán từ chính cái mã chứ không tra ở đâu: phái sinh luôn là `VN30F` cộng kỳ hạn, chỉ số là
 * một danh sách ngắn và gần như không đổi, còn lại là cổ phiếu. Đoán sai thì nguồn trả về "mã
 * không hợp lệ", và mã ấy đi tiếp xuống nguồn sau trong dây — không ai mất gì ngoài một lượt gọi.
 */
export function kindOf(symbol) {
  const code = String(symbol).toUpperCase();
  if (/^VN30F/.test(code)) return 'derivative';
  if (INDEXES.has(code)) return 'index';
  return 'stock';
}

/**
 * Ngày giờ theo lối RFC 1123, đuôi `+0000` chứ không phải `GMT`.
 *
 * Hai cách viết ấy cùng chỉ một thời điểm và **chữ ký không quan tâm ai đúng**: nó băm đúng
 * chuỗi được gửi đi. Gửi `+0000` mà ký `GMT` là 401, và cái 401 ấy không nói vì sao.
 */
export function rfc1123(at = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value) => String(value).padStart(2, '0');
  return `${days[at.getUTCDay()]}, ${pad(at.getUTCDate())} ${months[at.getUTCMonth()]} `
    + `${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:`
    + `${pad(at.getUTCSeconds())} +0000`;
}

/**
 * Một chữ ký HTTP Signature, đúng hình DNSE đợi.
 *
 * Chuỗi được ký là hai dòng — dòng yêu cầu và dòng ngày — cộng dòng `nonce` khi có. Chỗ dễ sai:
 * `headers` khai báo **không** kể `nonce` dù `nonce` có trong chuỗi ký, và chữ ký base64 phải
 * được url-encode. Cả hai đều là im lặng khi làm sai: không có gì báo, chỉ có 401.
 */
export function signature({ method, path, key, secret, date, nonce }) {
  let signing = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${date}`;
  if (nonce) signing += `\nnonce: ${nonce}`;

  const digest = createHmac('sha256', secret).update(signing, 'utf8').digest('base64');
  const header = `Signature keyId="${key}",algorithm="hmac-sha256",`
    + `headers="(request-target) date",signature="${encodeURIComponent(digest)}"`;
  return nonce ? `${header},nonce="${nonce}"` : header;
}

/**
 * Nến ngày, không cần khoá.
 *
 * `t o h l c v` là sáu mảng song song, cũ nhất trước. Cây cuối là phiên đang chạy (hoặc phiên
 * gần nhất nếu sàn đã đóng), cây áp cuối là phiên trước — và đó là tất cả những gì cần để nói
 * một mã hôm nay lên hay xuống.
 */
export function dnseChart({ base = CHART, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  async function candles(symbol) {
    const to = Math.floor(now() / 1000);
    const from = to - LOOKBACK_DAYS * 24 * 60 * 60;
    const url = `${base}/${kindOf(symbol)}?from=${from}&to=${to}&symbol=${symbol}&resolution=1D`;

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;

    const data = await response.json();
    // Mã không hợp lệ trả về một thân lỗi có mã 200 ở tầng vận chuyển ở vài đường; không có `c`
    // thì không có nến, và không có nến thì mã này không phải của nguồn này.
    if (!Array.isArray(data?.c) || !data.c.length) return null;
    return data;
  }

  return {
    name: 'dnse-chart',

    /// Nguồn này không có danh sách niêm yết nào để đưa ra — nó là chỗ để **dò tới**, không phải
    /// chỗ để tra. Rỗng, và `chain.mjs` bỏ qua.
    async universe() { return []; },

    async quotes(symbols) {
      const asked = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
      const got = await Promise.all(asked.map(async (symbol) => {
        try {
          const data = await candles(symbol);
          if (!data) return null;
          const last = data.c.length - 1;
          return quote({
            symbol,
            price: data.c[last],
            // Giá đóng cửa phiên trước làm tham chiếu. Đúng mọi ngày trừ ngày chốt quyền — xem
            // `withDefinitions` ở dưới, phần vá chỗ đó bằng số chính thức.
            reference: last > 0 ? data.c[last - 1] : 0,
            open: data.o?.[last] ?? 0,
            high: data.h?.[last] ?? 0,
            low: data.l?.[last] ?? 0,
            volume: data.v?.[last] ?? 0,
          });
        } catch {
          return null;
        }
      }));
      return got.filter(Boolean);
    },
  };
}

/**
 * Trần, sàn, tham chiếu — từ API có khoá.
 *
 * Trả về `null` cho mọi mã khi chưa cấp khoá, và đó là đường đi bình thường: bot chạy được mà
 * không có khoá nào, chỉ là những mã đi qua DNSE sẽ không có trần sàn. Khoá đặt bằng biến môi
 * trường, không bao giờ ghi vào file trong repo.
 */
export function dnseSecdef({
  base = OPENAPI,
  key = process.env.DNSE_API_KEY,
  secret = process.env.DNSE_API_SECRET,
  fetchImpl = fetch,
  timeout = TIMEOUT_MS,
  at = () => new Date(),
  nonce = () => randomHex(),
} = {}) {
  const enabled = Boolean(key && secret);

  async function definition(symbol) {
    if (!enabled) return null;
    const path = `/price/${symbol}/secdef`;
    const date = rfc1123(at());
    const stamp = nonce();

    const response = await fetchImpl(`${base}${path}`, {
      headers: {
        Date: date,
        'X-Signature': signature({ method: 'get', path, key, secret, date, nonce: stamp }),
        'x-api-key': key,
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`secdef ${symbol} trả về ${response.status}`);

    const boards = await response.json();
    if (!Array.isArray(boards) || !boards.length) return null;
    // `G1` là bảng khớp lệnh liên tục — bảng người ta nhìn. Các bảng còn lại là thoả thuận, lô
    // lẻ, và chúng có biên độ riêng.
    const board = boards.find((one) => one.boardId === 'G1') ?? boards[0];
    return {
      reference: Number(board.basicPrice ?? board.BasicPrice ?? 0),
      ceiling: Number(board.ceilingPrice ?? board.CeilingPrice ?? 0),
      floor: Number(board.floorPrice ?? board.FloorPrice ?? 0),
    };
  }

  return { enabled, definition };
}

function randomHex() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Nến, có trần sàn khi có khoá.
 *
 * Một mã hỏng ở tầng secdef không làm hỏng cái giá: giá vẫn là giá, chỉ là thiếu trần sàn. Nên
 * mọi lỗi ở đây bị nuốt có chủ ý — thứ tệ hơn một câu trả lời thiếu một dòng là không có câu
 * trả lời nào.
 */
export function dnse(options = {}) {
  const chart = dnseChart(options);
  const secdef = dnseSecdef(options);
  if (!secdef.enabled) return { ...chart, name: 'dnse' };

  return {
    name: 'dnse',
    universe: chart.universe,
    async quotes(symbols) {
      const quotes = await chart.quotes(symbols);
      return Promise.all(quotes.map(async (one) => {
        try {
          const board = await secdef.definition(one.symbol);
          if (!board?.reference) return one;
          // Dựng lại thay vì gán đè: đổi giá tham chiếu là đổi cả mức tăng giảm, và hai con số
          // ấy chỉ được tính ở một chỗ.
          return quote({ ...one, ...board, price: one.traded ? one.price : 0 });
        } catch (problem) {
          console.error(String(problem));
          return one;
        }
      }));
    },
  };
}
