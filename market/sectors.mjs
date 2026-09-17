// Ngành của từng mã, lấy từ phân ngành ICB của VNDirect.
//
// Trước đây bảng ngành là một danh sách viết tay chừng trăm mã trong `heatmap.mjs`, và mọi mã ngoài
// danh sách rơi vào "Khác" — PVT, PVC, PVB, cả họ dầu khí, đều nằm chung một đống với ba trăm mã
// không liên quan. Một bảng viết tay thì luôn thiếu: thị trường có 1.523 mã và thêm mã mới hằng
// tháng, còn danh sách thì chỉ lớn lên khi có người nhớ ra.
//
// VNDirect trả về **cả danh sách mã của từng ngành** trong một lời gọi, nên bảng ngành dựng lại
// được mỗi ngày mà không ai phải gõ gì. Dùng cấp 2 chứ không cấp 1: ở cấp 1, chuẩn ICB nhét bất
// động sản vào chung Tài chính — đúng chuẩn quốc tế, nhưng một bảng điện Việt Nam mà VIC nằm trong
// nhóm ngân hàng thì không ai đọc được.

const VNDIRECT = 'https://api-finfo.vndirect.com.vn/v4/industry_classification';
const TIMEOUT_MS = 15000;
/// Ngành đổi vài lần một năm, không đổi trong phiên. Hỏi lại mỗi ngày là đủ rộng rãi với một API
/// miễn phí của người khác.
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Mã mà ICB xếp một đằng, bảng điện Việt Nam đọc một nẻo.
 *
 * ICB nhìn vào việc doanh nghiệp làm gì: PVT chở dầu bằng tàu biển nên thành "vận tải", GAS phân
 * phối khí nên thành "tiện ích". Người ngồi trước bảng giá thì nhìn vào họ nhà nào: cả hai là họ
 * dầu khí, và họ lên xuống cùng giá dầu chứ không cùng ngành vận tải hay điện nước.
 *
 * Danh sách này cố ý ngắn. Mỗi dòng ở đây là một lần cãi lại nguồn dữ liệu, nên phải đáng.
 */
const OVERRIDES = {
  PVT: 'Dầu khí',
  PVI: 'Dầu khí',
  GAS: 'Dầu khí',
  PLX: 'Dầu khí',
  POW: 'Dịch vụ tiện ích',
};

/**
 * Bảng ngành, có nhớ. `of(symbol)` trả về tên ngành hoặc `null`.
 *
 * Nguồn chết thì trả về bảng rỗng chứ không ném: bản đồ nhiệt vẽ được với mọi mã trong nhóm "Khác"
 * vẫn hơn là không vẽ gì. Ai gọi cũng nên có sẵn một bảng dự phòng cho trường hợp ấy.
 */
export function vndirectSectors({
  base = VNDIRECT, fetchImpl = fetch, timeout = TIMEOUT_MS, ttlMs = TTL_MS, now = () => Date.now(),
} = {}) {
  let kept = null;

  async function load() {
    const response = await fetchImpl(`${base}?q=industryLevel:2&size=60`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`VNDirect trả lời ${response.status}`);
    return sectorsOf((await response.json())?.data);
  }

  return {
    async map() {
      if (kept && now() - kept.at < ttlMs) return kept.sectors;
      try {
        const sectors = await load();
        if (sectors.size) kept = { sectors, at: now() };
        return kept?.sectors ?? sectors;
      } catch (problem) {
        console.error(`không lấy được bảng ngành: ${problem}`);
        return kept?.sectors ?? new Map();
      }
    },
  };
}

/**
 * Bản ghi ICB thành bảng `mã -> ngành`.
 *
 * Một mã chỉ thuộc đúng một ngành cấp 2, nhưng nếu nguồn có kể trùng thì lần đầu thắng — thứ tự
 * trong câu trả lời là thứ tự ICB, và cãi nhau về mã trùng bằng "ai đến sau thắng" là cách một mã
 * xây dựng biến thành mã tài chính mà không ai hiểu vì sao.
 */
export function sectorsOf(rows) {
  const sectors = new Map();
  for (const row of rows ?? []) {
    const name = String(row?.vietnameseName ?? '').trim();
    if (!name) continue;
    for (const code of String(row?.codeList ?? '').split(',')) {
      const symbol = code.trim().toUpperCase();
      if (symbol && !sectors.has(symbol)) sectors.set(symbol, name);
    }
  }
  for (const [symbol, name] of Object.entries(OVERRIDES)) {
    if (sectors.has(symbol)) sectors.set(symbol, name);
  }
  return sectors;
}
