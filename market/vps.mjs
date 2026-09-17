// Nguồn giá, và chỗ duy nhất trong repo biết nó nằm ở đâu.
//
// Một feed công khai: không khoá, không tài khoản, không hạn mức phải xin. Bot gọi thẳng như
// bất cứ ai mở trình duyệt gọi — nghĩa là repo này không giữ bí mật nào, và ai clone về cũng
// chạy được ngay mà không phải đi xin quyền ở đâu.
//
// Cả file gói lại thành **một cái hình**: `quotes(mã)` và `universe()`. Bot ở tầng trên không
// biết feed này tồn tại; đổi sang nguồn khác là viết một file khác cùng hai hàm ấy và truyền
// vào `run`. Đó là lý do lớp này tách ra chứ không phải vì gọn: một nguồn giá miễn phí là thứ
// có thể đổi đường dẫn hoặc biến mất vào bất cứ sáng thứ Hai nào.
import { normalize } from './quote.mjs';

export const FEED = process.env.BOCO_FEED ?? 'https://bgapidatafeed.vps.com.vn';

/// Ba sàn. Bộ mã hợp lệ là hợp của ba danh sách này — xem `symbols.mjs` để biết nó dùng làm gì.
const BOARDS = ['hose', 'hnx', 'upcom'];

/**
 * Bao lâu thì bỏ cuộc.
 *
 * Ngắn, và cố ý ngắn. Người vừa gõ `/vic` trong một nhóm đang nói chuyện sẽ hỏi lại sau năm
 * giây chứ không đợi ba mươi; một câu trả lời tới muộn hơn thế thì đằng nào cũng đã trôi khỏi
 * màn hình.
 */
const TIMEOUT_MS = 8000;

/// Bao nhiêu mã một lượt. Đo chứ không đoán: 400 mã là một URL 1.649 ký tự và 465ms, còn cả sàn
/// trong một URL là thứ không nên thử ở nơi mình không sở hữu.
const CHUNK = 400;
/// Danh sách niêm yết đổi nhiều nhất một lần một ngày; nhớ vài phút là đủ và vẫn bắt kịp mã mới.
const UNIVERSE_TTL_MS = 10 * 60 * 1000;

export function publicFeed({ feed = FEED, fetchImpl = fetch, timeout = TIMEOUT_MS } = {}) {
  async function get(path) {
    const response = await fetchImpl(`${feed}${path}`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`${path} trả về ${response.status}`);
    return response.json();
  }

  return {
    name: 'vps',

    /**
     * Giá của nhiều mã, ít lượt gọi nhất có thể.
     *
     * Feed nhận cả danh sách ngăn cách bằng dấu phẩy, nên ba mã cũng chỉ là một lượt đi về. Mã
     * không tồn tại thì đơn giản là không có trong mảng trả về — không lỗi, không chỗ trống —
     * và đó chính là thứ để phân biệt "mã lạ" với "feed hỏng": feed hỏng thì ném.
     *
     * Chia lô vì có một chỗ hỏi cả sàn cùng lúc: việc xếp hạng thanh khoản để chọn lệnh đăng ký
     * lúc khởi động. Một câu hỏi trong nhóm nhiều nhất mười mã nên không bao giờ chạm tới đây;
     * 1.522 mã thì thành bốn lượt đi về song song thay vì một cái URL không ai nhận.
     */
    async quotes(symbols) {
      const wanted = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
      if (!wanted.length) return [];

      const lots = [];
      for (let from = 0; from < wanted.length; from += CHUNK) {
        lots.push(wanted.slice(from, from + CHUNK));
      }

      const answers = await Promise.all(lots.map((lot) => get(`/getliststockdata/${lot.join(',')}`)));
      return answers.flat()
        .filter((raw) => raw && typeof raw === 'object')
        .map(normalize)
        .filter(Boolean);
    },

    /**
     * Mọi mã đang niêm yết trên ba sàn.
     *
     * Ba lần gọi, song song, và chỉ một lần một ngày (`symbols.mjs` giữ kết quả). Danh sách này
     * **không có** chứng chỉ quỹ, chứng quyền hay phái sinh — nó chỉ là mã cổ phiếu ba chữ. Chỗ
     * hụt ấy được vá bằng cách dò thử, ở `symbols.mjs`, chứ không bằng cách viết tay thêm mã
     * vào đây: một danh sách viết tay là một danh sách sẽ cũ.
     */
    async universe() {
      const lists = await Promise.all(BOARDS.map((board) => get(`/getlistckindex/${board}`)));
      return lists.flat().filter((symbol) => typeof symbol === 'string').map((s) => s.toUpperCase());
    },
  };
}

/**
 * Một nguồn giá, nhớ câu trả lời trong vài giây.
 *
 * Trong một nhóm đang bàn về một mã, cùng một câu hỏi tới ba lần trong mười giây là chuyện
 * thường. Bộ nhớ này không phải để tiết kiệm cho mình — nó để **không nện vào một feed miễn phí
 * của người khác** một cách vô cớ, thứ duy nhất có thể khiến nguồn này đóng cửa với bot.
 *
 * Vài giây, không hơn: một cái giá cũ hơn thế, gửi vào lúc đang khớp lệnh, là một câu trả lời
 * sai — và sai theo kiểu không ai phát hiện ra.
 */
export function withCache(market, { ttlMs = 5000, universeTtlMs = UNIVERSE_TTL_MS, now = () => Date.now() } = {}) {
  const fresh = new Map();   // mã -> { quote, at }
  let listing = null;        // { symbols, at } — danh sách niêm yết
  let asking = null;         // lời gọi đang bay, để hai người hỏi cùng lúc chỉ thành một lượt

  return {
    ...market,

    /**
     * Danh sách niêm yết, nhớ vài phút.
     *
     * Ba sàn đổi danh sách nhiều nhất một lần một ngày, mà bảng nhiệt sống hỏi lại nó **mỗi nhịp
     * đẩy** — ba request mỗi ba giây, cả nghìn request một giờ, để nhận về đúng một danh sách y
     * nguyên. Và mỗi lần hỏi là thêm một phần tư giây vào quãng chờ của người vừa bấm vào một ô.
     */
    async universe() {
      if (listing && now() - listing.at < universeTtlMs) return listing.symbols;
      if (!asking) {
        asking = market.universe()
          .then((symbols) => {
            // Danh sách rỗng không được nhớ: đó là nguồn đang hỏng, và nhớ nó là giữ cái hỏng ấy
            // lại thêm mười phút nữa.
            if (symbols?.length) listing = { symbols, at: now() };
            return symbols;
          })
          .finally(() => { asking = null; });
      }
      return asking;
    },

    async quotes(symbols) {
      const wanted = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
      const time = now();
      const kept = [];
      const missing = [];

      for (const symbol of wanted) {
        const held = fresh.get(symbol);
        if (held && time - held.at < ttlMs) kept.push(held.quote);
        else missing.push(symbol);
      }

      if (!missing.length) return kept;

      const fetched = await market.quotes(missing);
      for (const quote of fetched) fresh.set(quote.symbol, { quote, at: time });
      return [...kept, ...fetched];
    },
  };
}
