// Bản đồ nhiệt toàn thị trường cho lệnh `!vboa`.
//
// VPS trả được danh sách niêm yết và giá hàng loạt, nhưng không có vốn hoá hay ngành. Nên bản
// đồ này dùng giá trị giao dịch làm độ lớn ô, và một bảng ngành nhỏ cho các mã vốn hoá/thanh
// khoản hay được nhìn trước; mã không có trong bảng vẫn hiện trong nhóm "Khác".
import { money } from './quote.mjs';

const WIDTH = 1280;
const HEIGHT = 720;
const OUTPUT_SCALE = 2;
const PAD = 14;
const GAP = 5;
/// Khe trắng giữa hai ô. Đủ rộng để từng mã tách ra thành một khối riêng thay vì một mảng màu liền
/// — cùng lý do các đoạn của một cột chồng phải chừa khe: mắt đọc ranh giới, không đọc màu.
const TILE_GAP = 2.5;
const HEADER = 34;
const FOOTER = 42;
const MIN_TILE = 36;
const MAX_SYMBOLS = 500;

const FILTERS = {
  bds: { key: 'bds', title: 'Bất động sản', sectors: ['Bất động sản'] },
  bank: { key: 'bank', title: 'Bank chứng', sectors: ['Tài chính'] },
  oil: { key: 'oil', title: 'Dầu khí', sectors: ['Năng lượng'] },
  retail: { key: 'retail', title: 'Bán lẻ', sectors: ['Tiêu dùng không thiết yếu'] },
  cn: { key: 'cn', title: 'Công nghiệp', sectors: ['Công nghiệp'] },
};

const SECTOR_ORDER = [
  'Tài chính',
  'Bất động sản',
  'Nguyên vật liệu',
  'Công nghiệp',
  'Năng lượng',
  'Tiêu dùng không thiết yếu',
  'Tiêu dùng thiết yếu',
  'Công nghệ thông tin',
  'Tiện ích',
  'Y tế',
  'Khác',
];

const SECTORS = {
  ACB: 'Tài chính', BID: 'Tài chính', BSI: 'Tài chính', BVH: 'Tài chính', CTG: 'Tài chính',
  EIB: 'Tài chính', EVF: 'Tài chính', FTS: 'Tài chính', HDB: 'Tài chính', LPB: 'Tài chính',
  MBB: 'Tài chính', MSB: 'Tài chính', OCB: 'Tài chính', ORS: 'Tài chính', SHB: 'Tài chính',
  SHS: 'Tài chính', SSI: 'Tài chính', STB: 'Tài chính', TCB: 'Tài chính', TPB: 'Tài chính',
  VAB: 'Tài chính', VCB: 'Tài chính', VCI: 'Tài chính', VIB: 'Tài chính', VPB: 'Tài chính',
  VIX: 'Tài chính', VND: 'Tài chính',

  AGG: 'Bất động sản', CEO: 'Bất động sản', CRE: 'Bất động sản', DIG: 'Bất động sản',
  DXG: 'Bất động sản', HDG: 'Bất động sản', KBC: 'Bất động sản', KDH: 'Bất động sản',
  NLG: 'Bất động sản', NVL: 'Bất động sản', PDR: 'Bất động sản', SJS: 'Bất động sản',
  TCH: 'Bất động sản', VHM: 'Bất động sản', VIC: 'Bất động sản', VPI: 'Bất động sản',
  VRE: 'Bất động sản',

  BCC: 'Nguyên vật liệu', BMP: 'Nguyên vật liệu', DCM: 'Nguyên vật liệu', DGC: 'Nguyên vật liệu',
  DPM: 'Nguyên vật liệu', DRI: 'Nguyên vật liệu', GVR: 'Nguyên vật liệu', HPG: 'Nguyên vật liệu',
  HSG: 'Nguyên vật liệu', NKG: 'Nguyên vật liệu', PHR: 'Nguyên vật liệu', VGC: 'Nguyên vật liệu',

  ACV: 'Công nghiệp', CII: 'Công nghiệp', CTD: 'Công nghiệp', CTR: 'Công nghiệp',
  GEE: 'Công nghiệp', GEX: 'Công nghiệp', GMD: 'Công nghiệp', HAH: 'Công nghiệp',
  HHV: 'Công nghiệp', KSB: 'Công nghiệp', PC1: 'Công nghiệp', REE: 'Công nghiệp',
  VCG: 'Công nghiệp', VJC: 'Công nghiệp', VSC: 'Công nghiệp',

  BSR: 'Năng lượng', GAS: 'Năng lượng', OIL: 'Năng lượng', PVD: 'Năng lượng',
  PVS: 'Năng lượng', PLX: 'Năng lượng', POW: 'Năng lượng',

  DGW: 'Tiêu dùng không thiết yếu', FRT: 'Tiêu dùng không thiết yếu', HAX: 'Tiêu dùng không thiết yếu',
  HUT: 'Tiêu dùng không thiết yếu', MWG: 'Tiêu dùng không thiết yếu', PNJ: 'Tiêu dùng không thiết yếu',
  TNG: 'Tiêu dùng không thiết yếu', VPL: 'Tiêu dùng không thiết yếu',

  ANV: 'Tiêu dùng thiết yếu', BAF: 'Tiêu dùng thiết yếu', DBC: 'Tiêu dùng thiết yếu',
  HAG: 'Tiêu dùng thiết yếu', KDC: 'Tiêu dùng thiết yếu', MSN: 'Tiêu dùng thiết yếu',
  PAN: 'Tiêu dùng thiết yếu', SAB: 'Tiêu dùng thiết yếu', VHC: 'Tiêu dùng thiết yếu',
  VNM: 'Tiêu dùng thiết yếu',

  CMG: 'Công nghệ thông tin', ELC: 'Công nghệ thông tin', FPT: 'Công nghệ thông tin',
  FOX: 'Công nghệ thông tin', VGI: 'Công nghệ thông tin',

  BWE: 'Tiện ích', NT2: 'Tiện ích', PPC: 'Tiện ích', QTP: 'Tiện ích',

  DBD: 'Y tế', DHG: 'Y tế', IMP: 'Y tế', TRA: 'Y tế',
};

export function askedHeatmapFor(message) {
  const text = withoutPrivateFlag(message?.text ?? '').trimStart();
  if (!text.startsWith('!')) return null;
  const parts = text.slice(1).trim().split(/\s+/).filter(Boolean);
  if (parts[0]?.toLowerCase() !== 'vboa') return null;
  if (parts.length === 1) return { addressed: true };

  const filter = FILTERS[parts[1].toLowerCase()];
  if (filter && parts.length === 2) return { addressed: true, filter };
  return {
    addressed: true,
    error: 'Chỉ hỗ trợ: !vboa bds, !vboa bank, !vboa oil, !vboa retail, !vboa cn.',
  };
}

function withoutPrivateFlag(text) {
  return String(text ?? '').replace(/\s+-v\s*$/i, '').trimEnd();
}

export function marketHeatmap({ maxSymbols = MAX_SYMBOLS, at = () => new Date() } = {}) {
  return {
    async rich(market, asked = {}) {
      const universe = await market.universe();
      const quotes = await market.quotes(universe);
      return heatmapRich(quotes, { maxSymbols, at: at(), filter: asked.filter });
    },
  };
}

export function heatmapRich(quotes, { maxSymbols = MAX_SYMBOLS, at = new Date(), filter = null } = {}) {
  const rows = quotes
    .filter((quote) => quote?.reference > 0 && quote.price > 0)
    .map((quote) => ({
      ...quote,
      value: Math.max(quote.price * quote.volume, 1),
      sector: SECTORS[quote.symbol] ?? 'Khác',
    }))
    .filter((quote) => !filter || filter.sectors.includes(quote.sector))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxSymbols);

  if (!rows.length) return null;

  const groups = filter
    ? [{ sector: filter.title, quotes: rows }]
    : SECTOR_ORDER
      .map((sector) => ({ sector, quotes: rows.filter((quote) => quote.sector === sector) }))
      .filter((group) => group.quotes.length);

  const stats = summarize(rows);
  const day = tradingDay(at);
  const text = `Bản đồ nhiệt VN${filter ? ` ${filter.title}` : ''} ${formatDay(day)}`;
  return {
    text,
    image: {
      fileName: `vboa${filter ? `-${filter.key}` : ''}-${day}.svg`,
      svg: heatmapSvg(groups, stats, day),
    },
    rich: {
      blocks: [
        { type: 'paragraph', text },
      ],
    },
  };
}

function heatmapSvg(groups, stats, day) {
  const area = { x: PAD, y: PAD, w: WIDTH - PAD * 2, h: HEIGHT - PAD * 2 - FOOTER };
  const groupItems = groups.map((group) => ({
    group,
    value: group.quotes.reduce((sum, quote) => sum + quote.value, 0),
  }));
  const groupRects = treemap(groupItems, area);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * OUTPUT_SCALE}" height="${HEIGHT * OUTPUT_SCALE}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <!-- Ánh sáng trong lòng mỗi ô: trắng ở giữa, tan dần ra mép. Một mảng màu phẳng lì trông như
         vệt sơn; cùng màu ấy có ánh sáng thì thành một viên gạch, và mắt tách được từng mã ra khỏi
         mảng bên cạnh trước cả khi đọc chữ. Độ đục giữ thấp để chữ trắng trên nền đậm không mờ đi. -->
    <radialGradient id="glow" cx="50%" cy="14%" r="82%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.13"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f1f5f9"/>
  ${groupRects.map(({ item, ...rect }) => sectorSvg(item.group, rect)).join('')}
  <g transform="translate(${PAD}, ${HEIGHT - FOOTER + 8})">
    ${legends([
    { colors: ['#8b1dc9'], text: `Tăng trần: ${stats.ceiling}` },
    { colors: UP.map((one) => one.fill), text: `Tăng giá: ${stats.up}` },
    { colors: ['#f0a020'], text: `Đứng giá: ${stats.flat}` },
    { colors: DOWN.map((one) => one.fill), text: `Giảm giá: ${stats.down}` },
    { colors: ['#1e88e5'], text: `Giảm sàn: ${stats.floor}` },
  ])}
    <text x="${WIDTH - PAD * 2}" y="22" text-anchor="end" fill="#64748b" font-family="${font()}" font-size="17">Phiên gần nhất · ${escapeXml(formatDay(day))}</text>
  </g>
</svg>`;
}

function sectorSvg(group, rect) {
  const inner = shrink(rect, GAP);
  if (inner.w <= 0 || inner.h <= 0) return '';
  const body = { x: inner.x, y: inner.y + HEADER, w: inner.w, h: Math.max(0, inner.h - HEADER) };
  const tiles = treemap(packed(group.quotes, body), body);

  return `<g>
    <rect x="${round(inner.x)}" y="${round(inner.y)}" width="${round(inner.w)}" height="${round(inner.h)}" rx="4" fill="#ffffff"/>
    <text x="${round(inner.x + inner.w / 2)}" y="${round(inner.y + 23)}" text-anchor="middle" fill="#0f172a" font-family="${font()}" font-size="16" font-weight="700">${escapeXml(group.sector)}</text>
    ${tiles.map(({ item, ...tile }) => (item.quote
    ? tileSvg(item.quote, shrink(tile, TILE_GAP))
    : restSvg(item.rest, shrink(tile, TILE_GAP)))).join('')}
  </g>`;
}

/**
 * Số ô vừa chỗ này, và phần đuôi gộp lại làm một.
 *
 * Nhồi hết vào thì phần đuôi thành những hạt vài pixel: không đọc được mã, không đọc được màu, chỉ
 * làm rối chỗ đáng nhìn. Giữ những mã giao dịch nhiều nhất cho tới khi hết chỗ tử tế, rồi nói thẳng
 * còn bao nhiêu mã nữa — một con số đọc được vẫn hơn hai trăm chấm không đọc được.
 */
function packed(quotes, body) {
  const room = Math.max(1, Math.floor((body.w * body.h) / (MIN_TILE * MIN_TILE * 1.6)));
  const sorted = [...quotes].sort((a, b) => b.value - a.value);
  if (sorted.length <= room) return sorted.map((quote) => ({ quote, value: quote.value }));

  const shown = sorted.slice(0, Math.max(1, room - 1));
  const rest = sorted.slice(shown.length);

  // Ô gộp không lấy chỗ theo tổng giá trị của cả đám, mà cũng không bé bằng ô nhỏ nhất.
  //
  // Vẽ đúng tổng thì một khối xám chiếm chỗ đẹp nhất của nhóm để nói điều chẳng ai cần nhìn to đến
  // thế — nó là lối ra, không phải một mã. Nhưng bé quá thì mất nhãn, và một ô xám không chữ còn tệ
  // hơn: người xem tưởng có mã nào đó hỏng. Vài phần trăm diện tích nhóm là vừa đủ để đọc con số.
  const smallest = shown.at(-1)?.value ?? rest[0].value;
  const readable = shown.reduce((sum, quote) => sum + quote.value, 0) * 0.04;
  return [
    ...shown.map((quote) => ({ quote, value: quote.value })),
    { rest: rest.length, value: Math.max(smallest, readable) },
  ];
}

/// Ô cuối của một nhóm đã chật: còn bao nhiêu mã nữa, viết ra chứ không vẽ ra.
function restSvg(count, rect) {
  if (rect.w <= 0 || rect.h <= 0) return '';
  const size = clamp(Math.min(rect.w / 4.6, rect.h / 2.6), 11, 22);
  return `<g>
    <rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.w)}" height="${round(rect.h)}" rx="3" fill="#e2e8f0"/>
    ${rect.w >= MIN_TILE && rect.h >= 22 ? `<text x="${round(rect.x + rect.w / 2)}" y="${round(rect.y + rect.h / 2 + size / 3)}" text-anchor="middle" fill="#475569" font-family="${font()}" font-size="${round(size)}" font-weight="700">+${count} mã</text>` : ''}
  </g>`;
}

function tileSvg(quote, rect) {
  if (rect.w <= 0 || rect.h <= 0) return '';
  const { fill: color, ink } = colorFor(quote);
  const label = rect.w >= MIN_TILE && rect.h >= MIN_TILE;
  const symbolSize = clamp(Math.min(rect.w / 4.4, rect.h / 3.2), 13, 31);
  const pctSize = clamp(symbolSize * 0.8, 11, 25);
  const percent = signed(quote.percent);

  return `<g data-symbol="${escapeXml(quote.symbol)}">
    <rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.w)}" height="${round(rect.h)}" rx="3" fill="${color}"/>
    <rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.w)}" height="${round(rect.h)}" rx="3" fill="url(#glow)"/>
    ${label ? `<text x="${round(rect.x + rect.w / 2)}" y="${round(rect.y + rect.h / 2 - 3)}" text-anchor="middle" fill="${ink}" font-family="${font()}" font-size="${round(symbolSize)}" font-weight="800">${escapeXml(quote.symbol)}</text>
    <text x="${round(rect.x + rect.w / 2)}" y="${round(rect.y + rect.h / 2 + pctSize)}" text-anchor="middle" fill="${ink}" font-family="${font()}" font-size="${round(pctSize)}" font-weight="700">${escapeXml(percent)}%</text>` : ''}
  </g>`;
}

function treemap(items, rect) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (!items.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  if (items.length === 1) return [{ item: items[0], ...rect }];

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const half = total / 2;
  let leftValue = sorted[0].value;
  let split = 1;
  while (split < sorted.length - 1) {
    const next = leftValue + sorted[split].value;
    if (Math.abs(half - leftValue) < Math.abs(half - next)) break;
    leftValue = next;
    split += 1;
  }
  const first = sorted.slice(0, split);
  const second = sorted.slice(split);
  const ratio = leftValue / total;

  if (rect.w >= rect.h) {
    const leftW = rect.w * ratio;
    return [
      ...treemap(first, { x: rect.x, y: rect.y, w: leftW, h: rect.h }),
      ...treemap(second, { x: rect.x + leftW, y: rect.y, w: rect.w - leftW, h: rect.h }),
    ];
  }

  const topH = rect.h * ratio;
  return [
    ...treemap(first, { x: rect.x, y: rect.y, w: rect.w, h: topH }),
    ...treemap(second, { x: rect.x, y: rect.y + topH, w: rect.w, h: rect.h - topH }),
  ];
}

function summarize(quotes) {
  return quotes.reduce((sum, quote) => {
    if (quote.ceiling > 0 && quote.price >= quote.ceiling) sum.ceiling += 1;
    else if (quote.floor > 0 && quote.price <= quote.floor) sum.floor += 1;

    if (quote.percent > 0) sum.up += 1;
    else if (quote.percent < 0) sum.down += 1;
    else sum.flat += 1;
    return sum;
  }, { ceiling: 0, floor: 0, up: 0, flat: 0, down: 0 });
}

/**
 * Màu của một ô, và màu chữ đọc được trên nền ấy.
 *
 * Ba nấc mỗi chiều theo biên độ, đậm dần: dưới 1%, 1–3%, từ 3% trở lên. Một màu xanh duy nhất cho
 * mọi mã tăng là bản đồ không nói gì — cả bảng xanh lè như nhau thì mã nhích 0,1% trông y hệt mã
 * tăng 6%, và thứ người ta cần nhìn ra ngay là chỗ nào đang thật sự chạy.
 *
 * Trần, sàn, đứng giá giữ nguyên ba màu của bảng điện — tím, xanh lơ, vàng — vì đó là trạng thái,
 * không phải mức độ, và người xem bảng giá Việt Nam đọc chúng theo phản xạ.
 *
 * Màu chữ chọn theo độ tương phản đo được, không theo cảm giác: nền nhạt thì chữ đen, nền đậm thì
 * chữ trắng, mọi cặp đều trên 4:1.
 */
function colorFor(quote) {
  if (quote.ceiling > 0 && quote.price >= quote.ceiling) return { fill: '#8b1dc9', ink: '#ffffff' };
  if (quote.floor > 0 && quote.price <= quote.floor) return { fill: '#1e88e5', ink: '#ffffff' };

  const size = Math.abs(quote.percent);
  const step = size >= 3 ? 2 : size >= 1 ? 1 : 0;
  if (quote.percent > 0) return UP[step];
  if (quote.percent < 0) return DOWN[step];
  return { fill: '#f0a020', ink: '#0b1220' };
}

const UP = [
  { fill: '#86dfa4', ink: '#0b1220' },
  { fill: '#2eb85c', ink: '#0b1220' },
  { fill: '#0b6e30', ink: '#ffffff' },
];

const DOWN = [
  { fill: '#f6a9a6', ink: '#0b1220' },
  { fill: '#e23b35', ink: '#ffffff' },
  { fill: '#8f1713', ink: '#ffffff' },
];

/**
 * Chú giải, xếp liền nhau theo bề rộng thật của từng mục.
 *
 * Mục tăng và giảm hiện cả ba nấc màu chứ không một ô mẫu: thang có nấc mà chú giải chỉ cho xem một
 * nấc thì người đọc không biết màu đậm nhạt đang nói điều gì.
 */
function legends(marks) {
  let x = 0;
  return marks.map(({ colors, text }) => {
    const swatches = colors
      .map((color, index) => `<rect x="${index * (SWATCH + 2)}" y="3" width="${SWATCH}" height="13" fill="${color}"/>`)
      .join('');
    const width = colors.length * (SWATCH + 2) + 8;
    const drawn = `<g transform="translate(${round(x)}, 0)">
    ${swatches}
    <text x="${width}" y="16" fill="#0f172a" font-family="${font()}" font-size="16">${escapeXml(text)}</text>
  </g>`;
    // Bề rộng chữ ước lượng theo số ký tự: đủ đúng cho một hàng chú giải, và không cần đo font.
    x += width + text.length * 8.4 + 26;
    return drawn;
  }).join('');
}

const SWATCH = 15;

function tradingDay(at) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function formatDay(day) {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

function signed(value) {
  if (value > 0) return `+${money(value)}`;
  if (value < 0) return `-${money(Math.abs(value))}`;
  return '+0';
}

function shrink(rect, gap) {
  return { x: rect.x + gap, y: rect.y + gap, w: rect.w - gap * 2, h: rect.h - gap * 2 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function font() {
  return 'system-ui, -apple-system, Segoe UI, sans-serif';
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
