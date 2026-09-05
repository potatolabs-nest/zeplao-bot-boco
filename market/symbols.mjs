// Cái gì là mã chứng khoán, và cái gì chỉ là một chữ có gạch chéo đằng trước.
//
// Đây là câu hỏi khó nhất trong con bot này, và nó không phải câu hỏi về giá.
//
// Trong một phòng có ba con bot, **mọi tin nhắn mở đầu bằng `/` đều tới cả ba**. Nghĩa là
// `/tienlen` của người khác cũng rơi vào đây. Một con bot giá cổ phiếu trả lời "không tìm thấy
// mã TIENLEN" mỗi lần ai đó gọi con bot bên cạnh là một con bot sẽ bị đá khỏi phòng trong tuần
// đầu tiên. Nên luật là: **không chắc thì im**.
//
// Chắc, ở đây, có ba mức:
//
//   1. Có trong danh sách niêm yết ba sàn → hỏi giá.
//   2. Không có trong danh sách nhưng đúng hình một mã → dò thử feed đúng **một lần**, rồi nhớ
//      câu trả lời. Đây là chỗ chứng chỉ quỹ như FUEVFVND đi vào, vì danh sách ba sàn chỉ có mã
//      cổ phiếu ba chữ, và cũng là chỗ `/tienlen` đi ra: dò một lần, không có, im mãi mãi.
//   3. Còn lại → im, không tốn một lượt gọi mạng nào.

/// Nhớ kết quả dò trong bao lâu. Nửa ngày: đủ để một lệnh của bot khác không bao giờ bị dò lại
/// trong một buổi, và đủ ngắn để một mã mới lên sàn không phải đợi tới lúc bot restart.
const PROBE_TTL_MS = 12 * 60 * 60 * 1000;

/// Danh sách niêm yết được tải lại mỗi ngày. Mã mới lên sàn là chuyện của tuần, không phải của
/// phút, nhưng một tiến trình chạy liên tục hàng tháng mà không tải lại thì sẽ có lúc sai.
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Hình dạng của một mã.
 *
 * Bắt đầu bằng chữ cái, ba tới chín ký tự, chỉ chữ và số. Cổ phiếu là ba chữ; chứng chỉ quỹ
 * (`FUEVFVND`, `E1VFVN30`) dài hơn và có số. Không bắt buộc phải đúng — đây chỉ là cái sàng để
 * khỏi dò mạng vì một từ tiếng Việt ai đó gõ nhầm.
 */
export function looksLikeCode(token) {
  return /^[A-Z][A-Z0-9]{2,8}$/.test(token);
}

/**
 * Những mã trong một câu.
 *
 * Tách theo mọi thứ không phải chữ và số, nên `vic, hpg` và `vic hpg` và `vic/hpg` là một. Giữ
 * nguyên thứ tự người ta hỏi, bỏ trùng — trả lời theo thứ tự bảng chữ cái là trả lời một câu
 * hỏi khác.
 */
export function tokensIn(text) {
  const words = String(text ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return [...new Set(words)];
}

/**
 * Cái sàng, có trí nhớ.
 *
 * Giữ danh sách niêm yết và những gì đã dò. Nhận `market` để tự đi lấy danh sách, `now` để bộ
 * test không phải đợi mười hai tiếng.
 */
export function makeGuard({ market, now = () => Date.now(), universeTtlMs = UNIVERSE_TTL_MS, probeTtlMs = PROBE_TTL_MS } = {}) {
  let listed = null;          // Set<string>, hoặc null khi chưa lấy được lần nào
  let listedAt = 0;
  let loading = null;
  const probed = new Map();   // mã -> { found, at }

  /**
   * Danh sách niêm yết, tải lại khi cũ.
   *
   * Hỏng thì trả về cái đang có — kể cả `null`. Một feed danh sách chết **không được** làm con
   * bot câm: khi không có danh sách, mọi thứ đúng hình mã đều được dò, và feed giá là trọng tài.
   * Chậm hơn, đúng như cũ.
   */
  async function universe() {
    if (listed && now() - listedAt < universeTtlMs) return listed;
    if (loading) return loading;

    loading = market.universe()
      .then((symbols) => {
        listed = new Set(symbols);
        listedAt = now();
        return listed;
      })
      .catch((problem) => {
        console.error(`không lấy được danh sách niêm yết: ${problem}`);
        return listed;
      })
      .finally(() => { loading = null; });

    return loading;
  }

  return {
    universe,

    /// Bao nhiêu mã đang biết. Chỉ để in ra lúc khởi động, cho người đọc log biết nó đã đứng dậy.
    get size() { return listed ? listed.size : 0; },

    /**
     * Trong đống chữ này, cái gì đáng hỏi giá.
     *
     * Trả về danh sách để hỏi. Rỗng nghĩa là **im lặng** — không phải "không tìm thấy".
     */
    async candidates(tokens) {
      const known = await universe();
      const time = now();

      return tokens.filter((token) => {
        if (known?.has(token)) return true;
        if (!looksLikeCode(token)) return false;

        const seen = probed.get(token);
        if (seen && time - seen.at < probeTtlMs) return seen.found;
        return true;   // chưa biết, và đúng hình: dò một lần
      });
    },

    /**
     * Ghi lại kết quả một lần dò.
     *
     * Cả hai chiều đều đáng nhớ: có thì lần sau khỏi phân vân, không có thì lần sau khỏi gọi
     * mạng vì một lệnh của con bot bên cạnh.
     */
    remember(symbol, found) {
      probed.set(symbol, { found, at: now() });
    },
  };
}
