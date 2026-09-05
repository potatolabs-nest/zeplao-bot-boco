// Một dòng giá, và mọi thứ để dựng nên nó.
//
// File này không biết gì về mạng và không biết gì về bot: vào là bản ghi thô của một nguồn giá,
// ra là con số đã chuẩn hoá và câu chữ để gửi vào phòng. Đây là chỗ duy nhất trong repo hiểu
// "giá" nghĩa là gì, nên cũng là chỗ được test kỹ nhất — phần còn lại chỉ là ống dẫn.

/**
 * Feed đếm khối lượng theo **lô 10 cổ phiếu**, không phải theo cổ phiếu.
 *
 * Không có dòng nào trong tài liệu của họ nói vậy; nó lộ ra khi đối chiếu một phiên đã đóng với
 * một nguồn khác: HPG phiên 04/09 feed trả `lot: 1.392.090`, nơi khác trả 13.920.900 cổ phiếu.
 * Đúng gấp mười, và sai gấp mười là loại sai không ai nhìn ra — con số vẫn hợp lý, vẫn tăng
 * giảm đúng chiều, chỉ là ít đi một chữ số. Nên nó được nhân ở đây, một lần, có tên.
 */
export const SHARES_PER_LOT = 10;

/// Nhiều nhất bao nhiêu mã một lần hỏi. Một tin nhắn tối đa 2000 ký tự, và mười dòng đã là
/// nhiều hơn thứ ai đó đọc được trong một nhóm đang nói chuyện.
export const MAX_SYMBOLS = 10;

const soLuong = new Intl.NumberFormat('vi-VN');
const soTien = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/// Giá, theo lối viết số của tiếng Việt: dấu phẩy là phần thập phân.
export function money(value) {
  return soTien.format(round(value, 2));
}

/// Khối lượng, đã là cổ phiếu chứ không còn là lô.
export function count(value) {
  return soLuong.format(Math.round(value));
}

function num(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * Một cái giá, dựng từ những con số đã đọc được ở bất cứ đâu.
 *
 * Mọi nguồn đi qua đây, và đây là chỗ **duy nhất** tính mức tăng giảm. Nguồn nào cũng có sẵn
 * hai trường ấy và không nguồn nào đáng tin: chúng là chuỗi, không phải nguồn nào cũng mang
 * dấu, và một mã giảm hiện lên thành mã tăng thì không có dòng nào trong bot bắt được. Trừ hai
 * số vốn đã phải đọc thì không tốn gì, và sai được theo đúng một cách là cả hai số cùng sai.
 */
export function quote({
  symbol, price = 0, reference = 0, ceiling = 0, floor = 0,
  open = 0, high = 0, low = 0, average = 0, volume = 0,
}) {
  if (!symbol) return null;

  // Giá khớp bằng 0 nghĩa là **chưa có**, không phải giá bằng không: trước phiên, hoặc một mã
  // cả ngày không ai mua bán. Mọi thứ bên dưới phân biệt hai cái đó.
  const traded = price > 0;
  const shown = traded ? price : reference;
  const change = traded && reference > 0 ? round(shown - reference, 2) : 0;

  return {
    symbol: String(symbol).toUpperCase(),
    price: shown,
    reference, ceiling, floor, open, high, low, average, volume,
    change,
    percent: traded && reference > 0 ? round((change / reference) * 100, 2) : 0,
    traded,
  };
}

/// Bản ghi thô của feed công khai, đổi thành một cái giá. Chỗ duy nhất trong repo biết tên các
/// trường của feed ấy — `r`, `c`, `f`, `lot` — là ba dòng dưới đây.
export function normalize(raw) {
  if (!raw || !raw.sym) return null;
  return quote({
    symbol: raw.sym,
    price: num(raw.lastPrice),
    reference: num(raw.r),
    ceiling: num(raw.c),
    floor: num(raw.f),
    open: num(raw.openPrice),
    high: num(raw.highPrice),
    low: num(raw.lowPrice),
    average: num(raw.avePrice),
    volume: num(raw.lot) * SHARES_PER_LOT,
  });
}

/**
 * Một mã, một dòng.
 *
 *   VIC 256,1 ▲ +4,74% · KL 7.518.600
 *
 * Trần và sàn được gọi tên chứ không chỉ là một con số phần trăm to. Trên bảng điện chúng là
 * màu tím và màu xanh lơ; trong một khung chat không có màu nào cả, nên thứ duy nhất còn lại
 * để nói "hết biên độ rồi" là chữ.
 */
export function line(quote) {
  if (!quote) return null;
  if (!quote.traded) {
    return `${quote.symbol} — chưa khớp · TC ${money(quote.reference)}`;
  }

  const arrow = quote.change > 0 ? '▲' : quote.change < 0 ? '▼' : '▬';
  const sign = quote.change > 0 ? '+' : quote.change < 0 ? '-' : '';
  const percent = `${sign}${money(Math.abs(quote.percent))}%`;

  let tag = '';
  if (quote.ceiling > 0 && quote.price >= quote.ceiling) tag = ' TRẦN';
  else if (quote.floor > 0 && quote.price <= quote.floor) tag = ' SÀN';

  return `${quote.symbol} ${money(quote.price)} ${arrow} ${percent}${tag} · KL ${count(quote.volume)}`;
}

/// Mã hỏi mà nguồn không có. Nói ra chứ không lặng lẽ bỏ đi: người gõ `/vnm` và nhận về một
/// dòng của mã khác sẽ tưởng mã kia là câu trả lời cho mã này.
export function missing(symbol) {
  return `${symbol} — không có dữ liệu`;
}

// ---- phiên giao dịch ------------------------------------------------------------------------

/// Giờ của cả ba sàn, tính theo phút kể từ nửa đêm giờ Việt Nam.
const MORNING = [9 * 60, 11 * 60 + 30];
const AFTERNOON = [13 * 60, 15 * 60];

/**
 * Giờ Việt Nam của một thời điểm, bất kể máy chủ đặt ở đâu.
 *
 * Qua `Intl` chứ không cộng bảy tiếng: máy chạy bot có thể ở bất cứ múi giờ nào, và một
 * container thường chạy UTC. Cộng tay thì đúng cho tới lần đầu ai đó chạy nó trên máy mình.
 */
export function vietnamNow(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Sàn đang mở hay đã đóng, nói bằng một dòng — hoặc không nói gì khi đang khớp lệnh.
 *
 * Đây là suy ra từ đồng hồ, không phải từ dữ liệu: feed không gửi kèm dấu thời gian nào, nên
 * không có cách nào biết con số vừa nhận là của mười giây trước hay của phiên hôm kia. Một dòng
 * "đã đóng cửa" khi đồng hồ nói vậy là thứ trung thực nhất làm được, và nó **không biết lịch
 * nghỉ lễ**: mùng một Tết vào lúc mười giờ sáng, bot sẽ im lặng như một phiên đang chạy trong
 * khi số liệu là của phiên cuối cùng trước Tết.
 */
export function sessionNote(at = new Date()) {
  const { weekday, minutes } = vietnamNow(at);

  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'Cuối tuần · số liệu phiên gần nhất';
  }
  if (minutes >= MORNING[0] && minutes < MORNING[1]) return null;
  if (minutes >= AFTERNOON[0] && minutes < AFTERNOON[1]) return null;
  if (minutes >= MORNING[1] && minutes < AFTERNOON[0]) {
    return 'Đang nghỉ trưa · số liệu dừng ở phiên sáng';
  }
  return 'Sàn đã đóng cửa · số liệu phiên gần nhất';
}

/**
 * Cả câu trả lời, một tin nhắn.
 *
 * Một tin nhắn cho mọi mã được hỏi, không phải mỗi mã một tin. Nền tảng cho một tin mỗi giây
 * mỗi phòng; ba mã thành ba tin là hai lần chờ và một phòng bị đẩy trôi vì một câu hỏi.
 */
export function reply(quotes, asked, at = new Date()) {
  const found = new Map(quotes.filter(Boolean).map((quote) => [quote.symbol, quote]));
  const lines = asked.map((symbol) => {
    const quote = found.get(symbol);
    return quote ? line(quote) : missing(symbol);
  });

  const note = sessionNote(at);
  if (note) lines.push(note);
  return lines.join('\n');
}
