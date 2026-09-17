// Hồ sơ doanh nghiệp: bấm vào `VIC` trong tin nhắn là mở tên đầy đủ, sàn, ngành, vốn hoá.
//
// Cùng đường đi với chú thích thuật ngữ trong `glossary.mjs` — một entity `view` trên chính chữ ấy,
// mọi nội dung thẻ đi kèm trong `data` của entity. Khác một điều: chữ của thuật ngữ là cố định, còn
// hồ sơ thì phải hỏi nguồn, nên mỗi mã là một lần gọi mạng trước khi tin nhắn đi.
//
// Nguồn là Vietcap IQ `/company/{mã}`, cùng host với `!kq`: một lời gọi, không cần khoá, có cho cả
// mã UPCoM lẫn mã bé tí, và vốn hoá trả sẵn bằng đồng chứ không phải tự nhân. Nó **không gửi CORS**,
// nên trang widget không tự gọi được — đó chính là lý do số liệu đi theo tin nhắn.
import { TEXT_BLOCKS } from './glossary.mjs';
import { count, money } from './quote.mjs';
import { VIETCAP } from './vietcap.mjs';

export const COMPANY_VIEW = 'company';

const TIMEOUT_MS = 8000;
/// Hồ sơ đổi theo tháng chứ không theo phiên, nên giữ lại nửa ngày. Vốn hoá của Vietcap cũng là ảnh
/// chụp cuối phiên trước, hỏi lại mỗi lần ai đó nhắc tên một mã chỉ tổ nện vào một feed miễn phí.
const TTL_MS = 12 * 60 * 60 * 1000;
const BILLION = 1e9;
/// Giá của feed tính bằng đồng; cả bot nói chuyện bằng nghìn đồng.
const THOUSAND = 1000;
/// Mô tả dài bao nhiêu là đủ cho một thẻ bật lên, và là mức giữ cho `data` của entity khỏi bị chối.
const MOST_ABOUT = 520;
/// Đợi hồ sơ nhiều nhất chừng này rồi gửi câu trả lời mà không có nó — xem `companyCards`.
const WAIT_MS = 2000;

const EXCHANGES = { VNINDEX: 'HOSE', HNXIndex: 'HNX', UpcomIndex: 'UPCoM' };

/// Chữ cái hoặc chữ số — thứ không được đứng sát mã, để `VIC` trong `VICEM` không thành nút bấm.
const WORDISH = /[\p{L}\p{N}]/u;

/**
 * Hồ sơ đã chuẩn hoá từ bản ghi thô của Vietcap. `null` khi bản ghi không phải của một mã.
 *
 * Đừng dùng `organCode` để nhận mã: đó là mã tổ chức nội bộ và nó khác ticker ở nhiều công ty —
 * ACV là `ACVN`, MCH là `MSCC`, VGI là `VTGI`.
 */
export function companyOf(data) {
  if (!data?.ticker) return null;

  const percent = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 10 : null);
  return {
    symbol: String(data.ticker).toUpperCase(),
    nameVi: text(data.viOrganName),
    nameEn: text(data.enOrganName),
    exchange: EXCHANGES[data.comGroupCode] ?? text(data.comGroupCode),
    sector: text(data.sectorVn),
    marketCap: Number.isFinite(data.marketCap) ? data.marketCap : null,
    shares: Number.isFinite(data.issueShare) ? data.issueShare : null,
    foreignRoom: percent(data.maximumForeignPercentage),
    foreignHeld: percent(data.foreignerPercentage),
    freeFloat: percent(data.freeFloatPercentage),
    listed: day(data.listingDate),
    low52: Number.isFinite(data.lowestPrice1Year) ? data.lowestPrice1Year / THOUSAND : null,
    high52: Number.isFinite(data.highestPrice1Year) ? data.highestPrice1Year / THOUSAND : null,
    volume20: Number.isFinite(data.averageMatchVolume1Month) ? data.averageMatchVolume1Month : null,
    about: about(data.profile),
  };
}

/**
 * Đúng `data` mà thẻ `company` được mở cùng.
 *
 * Mỗi dòng là một cặp nhãn — giá trị, và dòng nào nguồn không có thì không có dòng đó: một thẻ ghi
 * "Vốn hoá: —" trông như số liệu hỏng, trong khi sự thật chỉ là nguồn không nói.
 */
export function companyCard(profile) {
  if (!profile) return null;

  const rows = [];
  const add = (label, value) => { if (value) rows.push([label, value]); };
  add('Sàn', profile.exchange);
  add('Ngành', profile.sector);
  add('Vốn hoá', profile.marketCap ? `${count(profile.marketCap / BILLION)} tỷ đồng` : null);
  add('Cổ phiếu lưu hành', profile.shares ? count(profile.shares) : null);
  add('Free float', profile.freeFloat ? `${money(profile.freeFloat)}%` : null);
  add('Room ngoại', profile.foreignRoom
    ? `${money(profile.foreignRoom)}%${profile.foreignHeld === null ? '' : ` · đang nắm ${money(profile.foreignHeld)}%`}`
    : null);
  add('52 tuần', profile.low52 && profile.high52 ? `${money(profile.low52)} – ${money(profile.high52)}` : null);
  add('KL bình quân tháng', profile.volume20 ? count(profile.volume20) : null);
  add('Niêm yết', profile.listed);

  return {
    title: `${profile.symbol} — ${profile.nameVi || profile.nameEn}`,
    subtitle: profile.nameVi ? profile.nameEn : '',
    rows,
    about: profile.about,
    source: 'Vietcap IQ',
  };
}

/**
 * Trang chi tiết một mã trong bảng nhiệt sống.
 *
 * Cùng nội dung với thẻ bật lên khi bấm vào mã gạch chân trong tin nhắn — `companyCard` dựng chung
 * cho cả hai — cộng số của phiên hôm nay, thứ mà thẻ trong tin nhắn không có. Khối lượng và giá trị
 * giao dịch đổi từng giây, nên chúng chỉ đúng khi đi cùng một bảng đang chạy; trang được đẩy lại mỗi
 * nhịp nên hai con số ấy sống y như các ô màu phía sau.
 *
 * `card` là `null` khi hồ sơ chưa về hoặc mã không có hồ sơ — trang vẫn mở được, chỉ thiếu phần tên
 * và vốn hoá. Số của phiên thì luôn có, vì chúng tới từ chính cái bảng người ta vừa bấm vào.
 */
export function boardDetail({
  symbol, card = null, quote = null, sector = '', pending = false, history = [], study = null, studying = false,
  foreign = new Map(),
}) {
  const code = String(symbol ?? '').toUpperCase();
  if (!code) return null;

  // Mười phiên gần nhất, mỗi phiên một dòng. Khối lượng bình quân đứng riêng ở chân bảng: một mã
  // hôm nay khớp mười triệu là nhiều hay ít thì chỉ con số ấy trả lời được.
  const days = history.map((row) => {
    // Ghép khối ngoại vào theo ngày, không theo thứ tự: hai nguồn khác nhau, và một phiên nghỉ giữa
    // chừng ở nguồn này mà không nghỉ ở nguồn kia sẽ làm cả bảng lệch đi một dòng — kiểu sai mà
    // nhìn vào không ai ngờ, vì mọi con số đều hợp lý, chỉ đứng nhầm hàng.
    const nn = foreign.get(dayKey(row.day));
    return [
      // Ngày/tháng thôi: mười phiên gần nhất thì năm là bốn chữ số không nói thêm gì, mà bảng đang
      // có bảy cột và cột nào cũng tranh chỗ.
      row.day.slice(0, 5),
      money(row.close),
      `${signed(row.percent)}%`,
      count(row.volume),
      traded(row.close * row.volume),
      row.change > 0 ? 1 : row.change < 0 ? -1 : 0,
      nn ? traded(nn.buyValue) : '',
      nn ? traded(nn.sellValue) : '',
    ];
  });
  const average = history.length
    ? Math.round(history.reduce((sum, row) => sum + row.volume, 0) / history.length)
    : 0;

  const today = [];
  if (quote) {
    // Khối lượng và giá trị đứng trước: đó là hai con số người ta mở trang này để xem, phần còn lại
    // là bối cảnh. Giá trị tính từ giá khớp nhân khối lượng — feed không gửi sẵn, và một con số tự
    // nhân ra vẫn đúng hơn là không có con số nào.
    today.push(['Khối lượng', count(quote.volume)]);
    today.push(['Giá trị', traded(quote.price * quote.volume)]);
    today.push(['Tham chiếu', money(quote.reference)]);
    // Nhãn viết sát, không có khoảng trắng quanh dấu gạch: cột này hẹp, và "Cao / Thấp" xuống hai
    // dòng thì một cái nhãn hai chữ chiếm chỗ bằng hai dòng số.
    if (quote.ceiling > 0 && quote.floor > 0) today.push(['Trần/Sàn', `${money(quote.ceiling)} / ${money(quote.floor)}`]);
    if (quote.open > 0) today.push(['Mở cửa', money(quote.open)]);
    if (quote.high > 0 && quote.low > 0) today.push(['Cao/Thấp', `${money(quote.high)} / ${money(quote.low)}`]);
    if (quote.average > 0) today.push(['Bình quân', money(quote.average)]);
  }

  return {
    n: companyName(card, code),
    e: card?.subtitle ?? '',
    w: [card?.rows?.find(([label]) => label === 'Sàn')?.[1], sector].filter(Boolean).join(' · '),
    p: quote ? money(quote.price) : '',
    // Thay đổi bằng đồng, không phải phần trăm: phần trăm đã nằm sẵn trên chính ô vừa bấm, còn
    // "tăng 1,2 nghìn đồng" thì cả bảng không chỗ nào nói.
    d: quote && quote.change ? `${quote.change > 0 ? '+' : '-'}${money(Math.abs(quote.change))}` : '',
    q: today,
    // Bỏ dòng Sàn khỏi phần hồ sơ: nó đã đứng ngay dưới tên mã rồi. Vài nhãn rút ngắn cho vừa một
    // cột hẹp — thẻ trong tin nhắn rộng hơn nên nó giữ nguyên tên đầy đủ.
    r: (card?.rows ?? [])
      .filter(([label]) => label !== 'Sàn')
      .map(([label, value]) => [SHORTER[label] ?? label, value]),
    h: days,
    // Khối lượng bình quân mười phiên — và ghi rõ mười phiên, vì hồ sơ Vietcap cũng có một con số
    // "KL bình quân tháng" ngay bên cạnh, và hai con số giống tên nhau mà khác nghĩa là chỗ sai.
    hb: average ? [`KLTB ${history.length} phiên`, count(average)] : null,
    a: card?.about ?? '',
    // Bài phân tích kỹ thuật, chỉ có khi người xem mở tab ấy ra: một bài PTKT là bốn lượt gọi nguồn
    // nến, quá đắt để chạy cho mỗi cú bấm vào một ô màu.
    tk: study,
    tks: studying ? 1 : 0,
    // Hồ sơ chưa về thì trang nói "đang lấy", hồ sơ về mà rỗng thì trang nói "không có" — hai
    // chuyện khác nhau, và một cái quay mãi trong khi thật ra chẳng bao giờ có gì là chuyện thứ ba.
    f: card ? 1 : pending ? 2 : 0,
  };
}

const SHORTER = { 'Cổ phiếu lưu hành': 'CP lưu hành', 'KL bình quân tháng': 'KLTB tháng' };

/// Tên công ty trong thẻ, bỏ phần mã đứng trước. Thẻ ghi "VIC — Tập đoàn Vingroup" vì nó đứng một
/// mình trong tin nhắn; trên trang chi tiết thì mã đã in to ngay phía trên rồi.
export function companyName(card, symbol) {
  if (!card?.title) return '';
  return String(card.title).replace(`${String(symbol ?? '').toUpperCase()} — `, '');
}

/// `17/09/2026` → `2026-09-17`, để tra vào bảng khối ngoại vốn khoá theo ngày kiểu ISO.
function dayKey(day) {
  const found = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(day ?? ''));
  return found ? `${found[3]}-${found[2]}-${found[1]}` : '';
}

/// Dấu đi liền số, và số không thì không mang dấu nào.
function signed(value) {
  if (value > 0) return `+${money(value)}`;
  if (value < 0) return `-${money(Math.abs(value))}`;
  return money(0);
}

/// Giá trị giao dịch, tính bằng nghìn đồng vào — số càng lớn càng ít số lẻ: "1.925 tỷ" đọc nhanh
/// hơn "1.925,51 tỷ", còn một mã bé thì "820 triệu" mới ra được chuyện.
function traded(thousandDong) {
  const billion = thousandDong / 1e6;
  if (billion >= 100) return `${count(billion)} tỷ`;
  if (billion >= 1) return `${money(billion)} tỷ`;
  return `${money(billion * 1000)} triệu`;
}

/**
 * Entity `view` trên lần xuất hiện đầu tiên của từng mã trong `text`.
 *
 * Cùng luật với `termEntities`: đếm bằng đơn vị UTF-16, không dính vào chữ hai bên, và không đè lên
 * entity nào đã có trong `taken` — một view không được chung ký tự với entity khác.
 */
export function companyEntities(text, cards, taken = []) {
  const source = String(text ?? '');
  const busy = taken
    .filter((entity) => Number.isInteger(entity?.offset) && Number.isInteger(entity?.length))
    .map((entity) => [entity.offset, entity.offset + entity.length]);
  const found = [];

  for (const [symbol, card] of cards ?? []) {
    if (!card) continue;
    for (let at = source.indexOf(symbol); at >= 0; at = source.indexOf(symbol, at + 1)) {
      const end = at + symbol.length;
      const alone = !WORDISH.test(source[at - 1] ?? '') && !WORDISH.test(source[end] ?? '');
      const free = busy.every(([start, stop]) => end <= start || at >= stop);
      if (!alone || !free) continue;
      found.push({ type: 'view', offset: at, length: symbol.length, view: COMPANY_VIEW, data: card });
      busy.push([at, end]);
      break;
    }
  }
  return found.sort((a, b) => a.offset - b.offset);
}

/**
 * Nội dung một tin nhắn, kèm thẻ hồ sơ trên mã.
 *
 * Cùng hình dạng với `withTerms`: tin có `rich` thì gắn vào khối văn bản, tin chữ thì gắn vào
 * `entities`. Dùng chung cho mọi câu trả lời có nhắc tên mã — dòng giá, bài PTKT, bảng kết quả
 * kinh doanh — chứ không riêng dòng giá, vì người đọc thấy chữ `VIC` ở đâu cũng muốn bấm được.
 */
export function withCompany(content, cards) {
  if (!content || typeof content !== 'object' || content.stickerId || !cards?.size) return content;

  if (Array.isArray(content.rich?.blocks)) {
    let changed = false;
    const blocks = content.rich.blocks.map((block) => {
      if (!TEXT_BLOCKS.has(block?.type) || typeof block.text !== 'string') return block;
      const views = companyEntities(block.text, cards, block.entities ?? []);
      if (!views.length) return block;
      changed = true;
      return { ...block, entities: [...(block.entities ?? []), ...views] };
    });
    return changed ? { ...content, rich: { ...content.rich, blocks } } : content;
  }

  if (typeof content.text !== 'string') return content;
  const views = companyEntities(content.text, cards, content.entities ?? []);
  return views.length ? { ...content, entities: [...(content.entities ?? []), ...views] } : content;
}

/**
 * Nguồn hồ sơ, có nhớ.
 *
 * Mã lạ được Vietcap trả về **200 kèm `data: null`** chứ không phải 404, nên "không có mã ấy" đọc ở
 * `data`, không ở mã trạng thái. Kết quả rỗng cũng được nhớ: một mã không có hồ sơ mà hỏi lại mỗi
 * lần ai nhắc tới nó là cách chắc chắn nhất để bị nguồn chặn.
 */
export function vietcapCompany({
  base = VIETCAP, fetchImpl = fetch, timeout = TIMEOUT_MS, ttlMs = TTL_MS, now = () => Date.now(),
} = {}) {
  const kept = new Map();

  return {
    async profile(symbol) {
      const code = String(symbol ?? '').toUpperCase();
      const held = kept.get(code);
      if (held && now() - held.at < ttlMs) return held.profile;

      const response = await fetchImpl(`${base}/${code}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) throw new Error(`Vietcap trả lời ${response.status}`);
      const profile = companyOf((await response.json())?.data);
      kept.set(code, { profile, at: now() });
      return profile;
    },
  };
}

/**
 * Thẻ hồ sơ cho từng mã, hỏi song song. Mã nào hỏng thì vắng mặt, không ai bị mất câu trả lời.
 *
 * Hồ sơ là phần thêm vào một dòng giá. Nguồn chết, mã lạ, mạng chậm — không cái nào đáng để người
 * hỏi giá không nhận được giá.
 */
export async function companyCards(company, symbols, { waitMs = WAIT_MS } = {}) {
  if (!company || !symbols?.length) return new Map();
  const asked = [...new Set(symbols.map((symbol) => String(symbol).toUpperCase()))];
  const all = Promise.all(asked.map((symbol) => company.profile(symbol)
    .then((profile) => companyCard(profile))
    .catch(() => null)));

  // Có hạn chờ riêng, ngắn hơn hạn của chính lời gọi mạng: người ta hỏi giá, và một dòng giá tới
  // muộn tám giây vì đang đợi tên đầy đủ của công ty là một câu trả lời hỏng.
  //
  // Cái hẹn này **không** `unref`: `unref` nghĩa là nó không giữ tiến trình sống, nên khi không còn
  // việc nào khác thì tiến trình kết thúc trước lúc chuông reo và lời hứa ở đây treo mãi. Dọn bằng
  // `clearTimeout` khi đã có kết quả — như thế nó chỉ giữ vòng lặp đúng quãng nó thực sự đang đợi.
  let timer;
  const deadline = new Promise((done) => { timer = setTimeout(() => done(null), waitMs); });
  try {
    const cards = await Promise.race([all, deadline]);
    if (!cards) return new Map();
    return new Map(asked.map((symbol, index) => [symbol, cards[index]]).filter(([, card]) => card));
  } finally {
    clearTimeout(timer);
  }
}

// ---- chữ nghĩa -------------------------------------------------------------------------------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', ensp: ' ', emsp: ' ',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', ntilde: 'ñ', ccedil: 'ç', eth: 'đ', dstrok: 'đ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…',
  middot: '·', bull: '·', deg: '°', euro: '€', pound: '£', copy: '©', reg: '®', trade: '™',
};

/**
 * Chữ của một đoạn HTML: thẻ bỏ đi, thực thể giải mã, khoảng trắng gom lại.
 *
 * Phần mô tả của Vietcap là HTML soạn thảo, và tiếng Việt trong đó đi bằng thực thể — chữ thường
 * Latin-1 có tên (`&ocirc;` là ô), còn chữ có dấu thanh đi bằng số (`&#7871;` là ế). Không giải mã
 * thì thẻ hiện ra nguyên "C&ocirc;ng ty".
 */
export function plainText(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      if (NAMED[name] !== undefined) return NAMED[name];
      const lower = name[0].toLowerCase() + name.slice(1);
      return NAMED[lower] === undefined ? whole : NAMED[lower].toUpperCase();
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/// Mô tả cắt ở ranh giới câu, không cắt giữa một chữ: thẻ bật lên chỉ có chỗ cho vài dòng.
function about(html) {
  const whole = plainText(html);
  if (whole.length <= MOST_ABOUT) return whole;
  const cut = whole.slice(0, MOST_ABOUT);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return `${(stop > MOST_ABOUT / 2 ? cut.slice(0, stop) : cut.slice(0, cut.lastIndexOf(' '))).trim()}…`;
}

const text = (value) => String(value ?? '').trim();

/// `2007-09-19T00:00:00` → `19/09/2007`, đọc thẳng từ chuỗi để khỏi lệch một ngày vì múi giờ.
function day(value) {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return found ? `${found[3]}/${found[2]}/${found[1]}` : '';
}
