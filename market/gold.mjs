// Kim loại quý, cho `!vang`, `!bac` và `!tg`.
//
// Hai thị trường, ba nguồn, và chúng không liên quan gì tới dây nguồn cổ phiếu ở `chain.mjs`: XAU,
// XAG với DXY là chỉ số thế giới, còn vàng bạc trong nước là giá niêm yết của một tiệm, không phải
// một cái mã có sàn. Nên chúng vào bằng lệnh riêng chứ không đi qua `askedFor` — nhét `XAU` vào đó
// thì bộ đọc mã sẽ đem nó đi hỏi DNSE, và câu trả lời là "không có dữ liệu".
//
// **Vàng trong nước của Mi Hồng, bạc trong nước của BTMC.** Không phải tuỳ tiện: Mi Hồng trả về
// một lượt gọn gàng và có cả nhẫn lẫn SJC, nhưng nó **không có bạc** — `market=silver` trả `400`,
// và danh sách `goldCode` hợp lệ chỉ có mười mã vàng. BTMC thì có bạc, và bạc của họ ghi đơn vị
// ngay trong tên sản phẩm.
//
// **Mi Hồng** trả vàng trong nước: một lượt gọi, không khoá, không header. Giá của họ tính bằng
// **đồng một chỉ**, không phải một lượng — chỗ này là chỗ dễ sai nhất, vì `14050000` đọc lên y như
// một cái giá một lượng rẻ mạt. Đối chiếu: SJC 1 chỉ 14.200.000 ở Mi Hồng, và BTMC cũng niêm yết
// SJC đúng 14.200.000 cho sản phẩm "0.1" của họ — tức một phần mười lượng. Một lượng là **mười
// chỉ**, nên SJC bán ra 142.000.000 đồng một lượng. Trên thế giới vàng lúc ấy $4.030 một ounce,
// một lượng là 1,2056 ounce, tỷ giá 25.831 — ra 125,5 triệu, cộng chênh lệch SJC quen thuộc là
// vừa khớp. Ba nguồn cùng chỉ một chỗ, nên phép nhân mười ở đây là phép nhân đúng.
//
// **Yahoo** trả XAU với DXY. Hai điều bắt buộc phải nhớ:
//
//   1. Không có `User-Agent` thì nó trả `429` — không phải chặn theo hạn mức, chỉ là cửa trước
//      không mở cho một request trần trụi.
//   2. Không có ký hiệu spot `XAUUSD=X` trên Yahoo; vàng thế giới đi bằng hợp đồng tương lai COMEX
//      `GC=F`, và chỉ số đô la đi bằng `DX-Y.NYB`. Đó là hai cái tên duy nhất trả lời.
import { money } from './quote.mjs';

export const MIHONG = process.env.MIHONG_GOLD ?? 'https://api.mihong.com/v1/gold-prices';
export const BTMC = process.env.BTMC_GOLD ?? 'https://api.btmc.vn/api/BTMCAPI/getpricebtmc';
export const YAHOO = process.env.YAHOO_CHART ?? 'https://query1.finance.yahoo.com/v8/finance/chart';

/// Khoá của BTMC: đường dẫn **bắt buộc** có tham số này — thiếu thì `404` — nhưng giá trị nào cũng
/// chạy. Nó là một tham số hình thức, không phải một bí mật, nên nó nằm trong repo như mọi hằng số
/// khác. Đây không phải chỗ để đặt biến môi trường.
const BTMC_KEY = '123456';

const TIMEOUT_MS = 8000;

/// Vàng trong nước đổi vài lần một ngày, và người ta hỏi lại trong cùng một buổi. Giữ ngắn: một
/// cái giá vàng cũ hơn vài phút, giữa lúc giá đang chạy, là một câu trả lời sai.
const VN_FRESH_MS = 60 * 1000;
/// Chỉ số thế giới đổi liên tục; giữ còn ngắn hơn nữa.
const WORLD_FRESH_MS = 30 * 1000;

/// Mã trong nước của Mi Hồng: `SJC` là vàng miếng, `999` là nhẫn tròn trơn 999.9. Hai thứ người
/// ta hỏi giá, và cả hai đều niêm yết bằng đồng một chỉ.
const VN_CODES = [
  { code: 'SJC', name: 'Vàng miếng SJC' },
  { code: '999', name: 'Nhẫn tròn trơn 999.9' },
];

/// Chỉ trong một lượng. Không phải một hằng số trang trí: mọi con số của Mi Hồng đi qua đây.
const CHI_PER_LUONG = 10;

/// Tên gọi trên Yahoo. Không có spot, xem đầu file.
export const WORLD_SYMBOLS = { XAU: 'GC=F', XAG: 'SI=F', DXY: 'DX-Y.NYB' };

/// Yahoo đóng cửa cho một request không `User-Agent`. Chuỗi này không phải để giả danh ai — nó chỉ
/// là thứ tối thiểu một HTTP client tử tế gửi kèm.
const UA = 'Mozilla/5.0 (compatible; bocobot/1.0)';

/**
 * Vàng trong nước, từ Mi Hồng.
 *
 * Một lượt gọi trả về **mọi** loại vàng của tiệm; ở đây lọc lấy hai loại người ta hỏi. Giá là
 * đồng một chỉ, và được nhân mười ở `vnGold` chứ không phải ở đây — chỗ đổi đơn vị nằm một nơi,
 * cạnh dòng chữ nói ra nó là đơn vị gì.
 */
export function mihongGold({ base = MIHONG, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  let last = null;

  async function rows() {
    const response = await fetchImpl(`${base}?market=domestic`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Mi Hồng trả lời ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  return {
    /// Giá từng loại vàng, hoặc mảng rỗng khi nguồn không có loại nào quen.
    async price() {
      if (!last || now() - last.at >= VN_FRESH_MS) last = { at: now(), rows: await rows() };
      return vnGold(last.rows);
    },
  };
}

/**
 * Bản ghi thô của Mi Hồng thành vàng trong nước, đã quy về **đồng một lượng**.
 *
 * `buyingPrice` là giá tiệm mua vào, `sellingPrice` là giá tiệm bán ra — người có vàng bán cho
 * tiệm nhận giá thứ nhất, người muốn mua trả giá thứ hai. Bán ra bằng 0 là loại vàng tiệm không
 * bán (chỉ thu vào), và một số 0 in lên thành "0 đồng một lượng" thì tệ hơn là không in.
 */
export function vnGold(rows) {
  const byCode = new Map((rows ?? []).map((row) => [String(row?.code ?? '').toUpperCase(), row]));

  return VN_CODES.flatMap(({ code, name }) => {
    const row = byCode.get(code);
    if (!row) return [];
    const perChi = (value) => (Number(value) > 0 ? Number(value) : null);

    const buy = perChi(row.buyingPrice);
    const sell = perChi(row.sellingPrice);
    if (buy == null && sell == null) return [];

    return [{
      code,
      name,
      buyPerLuong: buy == null ? null : buy * CHI_PER_LUONG,
      sellPerLuong: sell == null ? null : sell * CHI_PER_LUONG,
      buyPerChi: buy,
      sellPerChi: sell,
      // Mức đổi của riêng Mi Hồng, theo đồng một chỉ. Họ gửi sẵn và nó chỉ là con số phụ; bot
      // không dùng nó để nói tăng giảm, vì giá trong nước đổi theo ngày chứ không theo phiên.
      at: String(row.dateTime ?? ''),
    }];
  });
}

/**
 * Bạc trong nước, từ BTMC.
 *
 * Vì sao bạc đi nguồn khác vàng: xem đầu file — Mi Hồng không có bạc.
 *
 * Đơn vị ở đây **khác vàng, và khác theo hướng dễ chịu hơn**: bạc của BTMC ghi đơn vị ngay trong
 * tên sản phẩm ("BẠC MIẾNG PHÚ QUÝ Ag 999 **1 LƯỢNG**"), nên con số tự nói ra đơn vị của nó. Đó
 * cũng là lý do ở đây **không** có phép nhân mười như `vnGold`: chọn đúng dòng "1 LƯỢNG" rồi đọc
 * thẳng, thay vì lấy một dòng rồi đoán quy ước của bảng. Đối chiếu: dòng "5 LƯỢNG" của Rồng Thăng
 * Long là 9.005.000, đúng năm lần dòng "1 LƯỢNG" 1.801.000; và thỏi 1 KG chia 26,67 lượng cũng ra
 * đúng con số ấy.
 *
 * Có hai thương hiệu và không gộp chúng: Phú Quý với Rồng Thăng Long chênh nhau gần 2% một lượng,
 * và người mua bạc miếng quan tâm thương hiệu nào mua lại được. Gộp thành một dòng là bỏ mất đúng
 * thứ họ cần biết.
 */
export function btmcSilver({ base = BTMC, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  let last = null;

  async function rows() {
    const response = await fetchImpl(`${base}?key=${BTMC_KEY}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`BTMC trả lời ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.DataList?.Data) ? data.DataList.Data : [];
  }

  return {
    /// Giá từng thương hiệu bạc, hoặc mảng rỗng khi nguồn không có dòng nào quen.
    async price() {
      if (!last || now() - last.at >= VN_FRESH_MS) last = { at: now(), rows: await rows() };
      return vnSilver(last.rows);
    },
  };
}

/**
 * Một dòng thô của BTMC thành `{ tên, giá }`.
 *
 * Bản ghi của họ là một **túi phẳng** với tên trường tự đánh số, và số ấy đổi theo dòng: dòng 95
 * mang `@n_95`, `@pb_95`, còn dòng 460 mang `@n_460`, `@pb_460`. Nên trường được tìm theo **tiền
 * tố**, không theo tên cố định — đọc cứng `@n_95` thì hôm sau nguồn đổi thứ tự là ra `undefined`
 * cho mọi dòng, và cái sai ấy im lặng.
 */
function btmcRow(row) {
  const pick = (prefix) => {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (key.startsWith(prefix)) return value;
    }
    return undefined;
  };
  const name = String(pick('@n_') ?? '').trim();
  const buy = Number(pick('@pb_'));
  const sell = Number(pick('@ps_'));
  const at = String(pick('@d_') ?? '');
  return name ? { name, buy, sell, at } : null;
}

/// Bạc miếng 1 lượng của từng thương hiệu, theo thứ tự cố định để câu trả lời không đổi thứ tự
/// giữa hai lần gõ. Tên thương hiệu lấy từ chính tên sản phẩm, không viết tay thành một danh sách
/// thứ hai sẽ cũ.
const SILVER_BRANDS = [
  { key: 'PHÚ QUÝ', label: 'Phú Quý' },
  { key: 'RỒNG THĂNG LONG', label: 'Rồng Thăng Long' },
];

export function vnSilver(rows) {
  const parsed = (rows ?? []).map(btmcRow).filter(Boolean);

  return SILVER_BRANDS.flatMap(({ key, label }) => {
    // Dòng "1 LƯỢNG" của thương hiệu này. Bỏ qua `0,5 KG`, `1 KG`, `5 LƯỢNG`: chúng là cùng một
    // thứ nhân lên, và một bảng giá trong chat chỉ cần một quy cách.
    const row = parsed.find((one) => {
      const name = one.name.toUpperCase();
      return name.includes('BẠC') && name.includes(key) && /1\s*LƯỢNG/.test(name);
    });
    if (!row) return [];

    const price = (value) => (Number(value) > 0 ? Number(value) : null);
    const buy = price(row.buy);
    const sell = price(row.sell);
    if (buy == null && sell == null) return [];

    return [{
      brand: label,
      buyPerLuong: buy,
      sellPerLuong: sell,
      at: row.at,
    }];
  });
}

/**
 * XAU, XAG và DXY, từ Yahoo.
 *
 * Giá hiện tại đọc ở **cây nến cuối**, không đọc ở `meta.regularMarketPrice` — hai chỗ ấy bằng
 * nhau hôm nay, nhưng chỉ một chỗ là thứ `quotes()` bên dưới cũng dùng, và hai đường đọc cho cùng
 * một con số là hai đường lệch nhau vào ngày ai đó sửa một trong hai.
 */
export function yahooQuotes({ base = YAHOO, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  let last = null;

  async function fetchOne(symbol, ticker) {
    const response = await fetchImpl(`${base}/${encodeURIComponent(ticker)}?range=5d&interval=1d`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Yahoo ${ticker} trả lời ${response.status}`);
    const data = await response.json();
    return worldQuote(String(symbol), data);
  }

  return {
    /// Giá từng mã, theo đúng thứ tự được hỏi, bỏ qua mã không trả lời được.
    async quotes(symbols) {
      if (!last || now() - last.at >= WORLD_FRESH_MS) last = { at: now(), bySymbol: new Map() };
      const wanted = [...new Set(symbols.map((symbol) => String(symbol).toUpperCase()))];

      const got = await Promise.all(wanted.map(async (symbol) => {
        const held = last.bySymbol.get(symbol);
        if (held) return held;
        const one = await fetchOne(symbol, WORLD_SYMBOLS[symbol] ?? symbol).catch(() => null);
        if (one) last.bySymbol.set(symbol, one);
        return one;
      }));
      return got.filter(Boolean);
    },
  };
}

/**
 * Phản hồi của Yahoo thành một cái giá.
 *
 * Tham chiếu là **cây nến đã đóng gần nhất**, tức cây áp cuối — không phải `meta.chartPreviousClose`.
 * Trường ấy đọc lên rất giống thứ cần dùng và nó **sai**: nó là giá đóng cửa của phiên *trước cả
 * cây nến đầu tiên trong khung*, nên với khung 5 ngày nó bằng chính cây nến đầu. Lấy nó làm tham
 * chiếu thì mức tăng giảm là của cả tuần, gọi tên là của hôm nay.
 *
 * Chỉ số có ngày nghỉ, nên mảng `close` có những chỗ `null` — bỏ chúng rồi mới lấy hai cây cuối.
 */
export function worldQuote(symbol, data) {
  const result = data?.chart?.result?.[0];
  const closes = (result?.indicators?.quote?.[0]?.close ?? [])
    .map((value) => (Number.isFinite(value) ? Number(value) : null))
    .filter((value) => value != null);
  if (closes.length < 2) return null;

  const price = closes.at(-1);
  const reference = closes.at(-2);
  if (!(reference > 0)) return null;

  const change = Math.round((price - reference) * 100) / 100;
  const meta = result?.meta ?? {};
  return {
    symbol,
    price,
    reference,
    change,
    percent: Math.round((change / reference) * 10000) / 100,
    currency: String(meta.currency ?? 'USD'),
    // Giờ của nguồn, không phải giờ máy: máy chạy bot có thể lệch, và một cái giá vàng ghi sai giờ
    // là một cái giá không ai biết cũ hay mới.
    at: Number.isFinite(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000) : null,
  };
}

// ---- câu chữ ----------------------------------------------------------------------------------

/// `4.030,7` — cùng lối viết số với `line()` ở `quote.mjs`, để một tin về vàng trông như mọi tin
/// khác của bot.
function price(value) {
  return money(value);
}

/// Đồng, viết đủ chữ số: giá vàng trong nước là con số người ta so từng đồng, và `142` triệu đọc
/// lên không nói được gì về chênh lệch mua bán.
const dong = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

function vnd(value) {
  return dong.format(Math.round(value));
}

function clock(at) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

/// `14050000` ở Mi Hồng thành `27/10 09:30`.
function stamp(text) {
  const matched = /(\d{2})\/(\d{2})\/\d{4}\s+(\d{2}):(\d{2})/.exec(String(text ?? ''));
  return matched ? `${matched[1]}/${matched[2]} ${matched[3]}:${matched[4]}` : String(text ?? '');
}

/// Một dòng của XAU hay DXY, đúng hình dòng giá cổ phiếu: mã, giá, dấu, phần trăm.
export function worldLine(one) {
  if (!one) return null;
  const arrow = one.change > 0 ? '▲' : one.change < 0 ? '▼' : '▬';
  const sign = one.change > 0 ? '+' : one.change < 0 ? '-' : '';
  const when = clock(one.at);
  return `${one.symbol} ${price(one.price)} ${one.currency} ${arrow} ${sign}${price(Math.abs(one.percent))}%${when ? ` · ${when}` : ''}`;
}

/// Mua vào – bán ra, một loại vàng hai dòng: một lượng, rồi một chỉ. Không có vế nào thì bỏ vế ấy.
function vnBlock(one) {
  const range = (chi) => {
    const buy = chi === 'luong' ? one.buyPerLuong : one.buyPerChi;
    const sell = chi === 'luong' ? one.sellPerLuong : one.sellPerChi;
    if (buy == null && sell == null) return null;
    if (buy == null) return vnd(sell);
    if (sell == null) return vnd(buy);
    return `${vnd(buy)} – ${vnd(sell)}`;
  };

  const lines = [];
  const luong = range('luong');
  const chi = range('chi');
  if (luong) lines.push(`${one.name} 1 lượng: ${luong} đồng`);
  if (chi) lines.push(`${one.name} 1 chỉ: ${chi} đồng`);
  return lines.length ? lines : null;
}

/**
 * Cả câu trả lời cho `/vang`.
 *
 * Không có loại vàng nào thì trả `null` — người gọi nói ra là nguồn không trả lời, chứ không in
 * một cái khung rỗng.
 */
export function vnGoldText(rows) {
  if (!rows?.length) return null;

  const lines = [];
  for (const one of rows) {
    const block = vnBlock(one);
    if (block) lines.push(...block);
  }
  if (!lines.length) return null;

  const when = stamp(rows[0].at);
  lines.push(when ? `Giá mua vào – bán ra · ${when}` : 'Giá mua vào – bán ra');
  return lines.join('\n');
}

/**
 * Cả câu trả lời cho `!bac`.
 *
 * Một dòng mỗi thương hiệu, mỗi dòng một quy cách — một lượng. Không có dòng "một chỉ" như vàng:
 * bạc bán theo lượng và theo kg, một chỉ bạc là thứ không ai niêm yết.
 */
export function vnSilverText(rows) {
  if (!rows?.length) return null;

  const lines = rows.map((one) => {
    if (one.buyPerLuong == null) return `Bạc miếng ${one.brand} Ag 999 1 lượng: ${vnd(one.sellPerLuong)} đồng`;
    if (one.sellPerLuong == null) return `Bạc miếng ${one.brand} Ag 999 1 lượng: ${vnd(one.buyPerLuong)} đồng`;
    return `Bạc miếng ${one.brand} Ag 999 1 lượng: ${vnd(one.buyPerLuong)} – ${vnd(one.sellPerLuong)} đồng`;
  });

  const when = stamp(rows[0].at);
  lines.push(when ? `Giá mua vào – bán ra · ${when}` : 'Giá mua vào – bán ra');
  return lines.join('\n');
}

/**
 * Cả câu trả lời cho `/xau` — vàng thế giới và sức mạnh đồng đô la, cùng một tin.
 *
 * Hai chỉ số này đi cùng nhau vì chúng trả lời cùng một câu: vàng tính bằng đô la, nên đồng đô la
 * mạnh lên là một cái gió ngược. Tách ra hai lệnh thì người hỏi phải gõ hai lần để thấy điều đó.
 */
export function worldText(quotes) {
  const kept = (quotes ?? []).filter(Boolean);
  if (!kept.length) return null;

  const order = ['XAU', 'XAG', 'DXY'];
  const sorted = [...kept].sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
  return sorted.map(worldLine).filter(Boolean).join('\n');
}
