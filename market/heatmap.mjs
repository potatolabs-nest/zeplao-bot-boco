// Bản đồ nhiệt toàn thị trường cho lệnh `!vboa`.
//
// VPS trả được danh sách niêm yết và giá hàng loạt, nhưng không có vốn hoá hay ngành. Nên bản
// đồ này dùng giá trị giao dịch làm độ lớn ô, và một bảng ngành nhỏ cho các mã vốn hoá/thanh
// khoản hay được nhìn trước; mã không có trong bảng vẫn hiện trong nhóm "Khác".
import { money, sessionNote, vietnamNow } from './quote.mjs';

const WIDTH = 1280;
const HEIGHT = 720;
const OUTPUT_SCALE = 2;
const PAD = 14;
const GAP = 4;
const HEADER = 34;
const FOOTER = 42;
const MIN_TILE = 36;
/// Cỡ chữ lớn nhất và nhỏ nhất còn đáng in ra. Dưới mức nhỏ nhất thì ô để trống.
const MOST_LABEL = 30;
const LEAST_LABEL = 9;
/// Khe trắng giữa hai ô, và góc bo của ô. Cả phần "trắng" của bản đồ nằm ở đây: không phủ gì lên
/// màu, chỉ chừa ra một mạch hở đủ mảnh để mỗi mã thành một viên riêng thay vì một mảng liền.
const TILE_GAP = 1.5;
const TILE_RADIUS = 1;
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
      svg: heatmapSvg(groups, stats, at),
    },
    rich: {
      blocks: [
        { type: 'paragraph', text },
      ],
    },
  };
}

function heatmapSvg(groups, stats, at) {
  const area = { x: PAD, y: PAD, w: WIDTH - PAD * 2, h: HEIGHT - PAD * 2 - FOOTER };
  const groupItems = groups.map((group) => ({
    group,
    value: group.quotes.reduce((sum, quote) => sum + quote.value, 0),
  }));
  const groupRects = treemap(groupItems, area);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * OUTPUT_SCALE}" height="${HEIGHT * OUTPUT_SCALE}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>${tileGradients()}</defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f1f5f9"/>
  ${groupRects.map(({ item, ...rect }) => sectorSvg(item.group, rect)).join('')}
  <g transform="translate(${PAD}, ${HEIGHT - FOOTER + 8})">
    ${legend('#7e22ce', `Tăng trần: ${stats.ceiling}`, 0)}
    ${legend('#02b314', `Tăng giá: ${stats.up}`, 138)}
    ${legend('#f59e0b', `Đứng giá: ${stats.flat}`, 274)}
    ${legend('#dc1d0f', `Giảm giá: ${stats.down}`, 430)}
    ${legend('#1e88e5', `Giảm sàn: ${stats.floor}`, 570)}
    <text x="${WIDTH - PAD * 2}" y="22" text-anchor="end" fill="#64748b" font-family="${font()}" font-size="17">${escapeXml(stamp(at))}</text>
  </g>
</svg>`;
}

function sectorSvg(group, rect) {
  const inner = shrink(rect, GAP);
  if (inner.w <= 0 || inner.h <= 0) return '';
  const body = { x: inner.x, y: inner.y + HEADER, w: inner.w, h: Math.max(0, inner.h - HEADER) };
  const tiles = treemap(
    group.quotes.map((quote) => ({ quote, value: quote.value })),
    body,
  );

  return `<g>
    <rect x="${round(inner.x)}" y="${round(inner.y)}" width="${round(inner.w)}" height="${round(inner.h)}" rx="4" fill="#ffffff"/>
    <text x="${round(inner.x + inner.w / 2)}" y="${round(inner.y + 23)}" text-anchor="middle" fill="#0f172a" font-family="${font()}" font-size="16" font-weight="700">${escapeXml(group.sector)}</text>
    ${tiles.map(({ item, ...tile }) => tileSvg(item.quote, shrink(tile, gapFor(tile)))).join('')}
  </g>`;
}

/// Khe của một ô, co lại khi ô quá nhỏ. Khe cố định 2,5px mỗi bên ăn hết một ô rộng 4px — mã ấy
/// biến mất khỏi bản đồ, im lặng, chỉ vì cái khe. Ô càng bé thì mạch hở càng mảnh, nhưng vẫn có.
function gapFor(rect) {
  return Math.min(TILE_GAP, rect.w / 5, rect.h / 5);
}

function tileSvg(quote, rect) {
  if (rect.w <= 0 || rect.h <= 0) return '';
  const color = colorFor(quote);
  // Mã và phần trăm **cùng một cỡ**. Hai dòng ấy là một thông tin, không phải một cái tên với một
  // ghi chú: người ta liếc bản đồ để đọc mức tăng giảm, nên thu nhỏ con số đi là thu nhỏ đúng thứ
  // đáng nhìn.
  //
  // Cỡ chữ tính từ chỗ trống, và **không có sàn**. Hai dòng cao chừng 1,8 lần cỡ chữ, nên chia
  // chiều cao ô cho 3,6 là chữ chiếm đúng nửa ô, không hơn. Bề ngang chia 4,3 cho vừa `-3,02%`.
  //
  // Trước đây có sàn 11px: ô bé tới đâu thì chữ vẫn bị kéo lên 11, và hai dòng chữ ăn gần hết ô.
  // Ô không đủ chỗ thì để trống — một ô trống vẫn đọc được màu, còn một ô đặc chữ thì không đọc
  // được gì cả.
  // Hai dòng khi ô đủ cao, **một dòng** khi ô rộng mà thấp.
  //
  // Cỡ chữ của hai dòng chồng nhau bị chiều cao quyết định, nên một ô 200×28 — thừa bề ngang để
  // viết `VIC +0,17%` — lại ra cỡ chữ bé hơn mức đọc được và bị bỏ trống, trong khi một ô hẹp mà
  // cao, diện tích nhỏ hơn hẳn, vẫn được ghi. Nhìn vào bản đồ thì đó là chuyện vô lý thấy ngay.
  // Nên thử cả hai cách xếp và lấy cách nào cho chữ to hơn.
  const stacked = Math.min(rect.w / 4.3, rect.h / 3.6, MOST_LABEL);
  const together = `${quote.symbol} ${signed(quote.percent)}%`;
  const inline = Math.min(rect.w / (together.length * 0.62), rect.h / 1.9, MOST_LABEL);
  const size = Math.max(stacked, inline);
  const oneRow = inline > stacked;
  const label = size >= LEAST_LABEL;
  const percent = signed(quote.percent);

  return `<g data-symbol="${escapeXml(quote.symbol)}">
    <rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.w)}" height="${round(rect.h)}" rx="${TILE_RADIUS}" fill="url(#o-${color})" stroke="${shade(TILE_FILLS[color], EDGE_DARKER)}" stroke-width="1"/>
    ${!label ? '' : oneRow
    ? `<text x="${round(rect.x + rect.w / 2)}" y="${round(rect.y + rect.h / 2 + size * 0.36)}" text-anchor="middle" fill="#111827" font-family="${font()}" font-size="${round(size)}" font-weight="700">${escapeXml(together)}</text>`
    : `<text x="${round(rect.x + rect.w / 2)}" y="${round(rect.y + rect.h / 2 - size * 0.18)}" text-anchor="middle" fill="#111827" font-family="${font()}" font-size="${round(size)}" font-weight="700">${escapeXml(quote.symbol)}</text>
    <text x="${round(rect.x + rect.w / 2)}" y="${round(rect.y + rect.h / 2 + size * 0.92)}" text-anchor="middle" fill="#111827" font-family="${font()}" font-size="${round(size)}" font-weight="700">${escapeXml(percent)}%</text>`}
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
 * Màu nền của một ô, theo trạng thái. Trả về **tên** chứ không phải mã màu, vì mỗi trạng thái được
 * vẽ bằng một dải chuyển sắc riêng khai trong `<defs>` — xem `TILE_FILLS`.
 */
function colorFor(quote) {
  if (quote.ceiling > 0 && quote.price >= quote.ceiling) return 'ceiling';
  if (quote.floor > 0 && quote.price <= quote.floor) return 'floor';
  if (quote.percent > 0) return 'up';
  if (quote.percent < 0) return 'down';
  return 'flat';
}

const TILE_FILLS = {
  ceiling: '#8b1dc9',
  floor: '#1e88e5',
  up: '#02cc1a',
  down: '#ef2a2f',
  flat: '#f6b846',
};

/**
 * Ô phồng lên như cái nệm: giữa sáng hơn, rìa tối hơn, viền tối hơn nữa.
 *
 * Ba con số dưới đây không phải tôi chọn — chúng là thông số mặc định của FoamTree, thư viện dựng
 * bản đồ nhiệt mà bảng điện người ta vẫn nhìn (`groupFillGradientCenterLightnessShift` +20,
 * `groupFillGradientRimLightnessShift` −5, `groupStrokePlainLightnessShift` −10).
 *
 * Điều đáng học ở đó: cả ba đều dịch **độ sáng của chính màu ấy**, không pha trắng lên trên. Phủ
 * một lớp trắng thì màu bạc đi và cả bản đồ nhợt — tôi đã thử, và nó xấu đúng như vậy.
 */
const CENTER_LIGHTER = 20;
const RIM_DARKER = -5;
const EDGE_DARKER = -10;

/**
 * Đỏ và tím chỉ sáng lên nửa mức.
 *
 * Cùng cộng 20 độ sáng, nhưng hai màu ấy vốn đã sáng hơn màu xanh, nên cộng xong đỏ ngả hồng và tím
 * ngả tử đinh hương — nhìn đúng như bị phủ trắng, thứ vừa phải bỏ đi. Độ sáng là thang tuyệt đối,
 * còn chỗ trống phía trên mỗi màu thì khác nhau, nên một con số chung không dùng được cho cả năm.
 */
const CENTER_SHIFT = { up: CENTER_LIGHTER, flat: CENTER_LIGHTER, floor: CENTER_LIGHTER, down: 10, ceiling: 10 };

function tileGradients() {
  return Object.entries(TILE_FILLS).map(([name, hex]) => `<radialGradient id="o-${name}" cx="50%" cy="50%" r="72%">
      <stop offset="0" stop-color="${shade(hex, CENTER_SHIFT[name] ?? CENTER_LIGHTER)}"/>
      <stop offset="1" stop-color="${shade(hex, RIM_DARKER)}"/>
    </radialGradient>`).join('');
}

/// Cùng một màu, dịch độ sáng đi `shift` điểm trong không gian HSL. Giữ nguyên sắc và độ bão hoà —
/// đó là khác biệt giữa "đậm nhạt của màu xanh" và "xanh pha trắng".
export function shade(hex, shift) {
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const spread = high - low;
  const light = (high + low) / 2;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * light - 1));

  let hue = 0;
  if (spread !== 0) {
    hue = high === red ? ((green - blue) / spread) % 6 : high === green ? (blue - red) / spread + 2 : (red - green) / spread + 4;
    hue = (hue * 60 + 360) % 360;
  }

  const lit = clamp(light + shift / 100, 0, 1);
  const chroma = (1 - Math.abs(2 * lit - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lit - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, second, 0]
    : hue < 120 ? [second, chroma, 0]
      : hue < 180 ? [0, chroma, second]
        : hue < 240 ? [0, second, chroma]
          : hue < 300 ? [second, 0, chroma]
            : [chroma, 0, second];
  return `#${[r, g, b].map((one) => Math.round((one + base) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function legend(color, text, x) {
  return `<g transform="translate(${x}, 0)">
    <rect x="0" y="3" width="26" height="13" fill="${color}"/>
    <text x="32" y="16" fill="#0f172a" font-family="${font()}" font-size="16">${escapeXml(text)}</text>
  </g>`;
}

/**
 * Số liệu này là của lúc nào.
 *
 * Giữa phiên thì ghi đúng giờ lấy số liệu, vì bản đồ vẽ theo giá khớp đang chạy và người xem cần
 * biết nó mới tới đâu. Ngoài phiên thì nói thẳng là sàn đã đóng, nghỉ trưa hay cuối tuần.
 *
 * Trước đây dòng này luôn ghi "Phiên gần nhất", kể cả lúc mười giờ sáng thứ Ba — số liệu thì mới
 * từng giây mà chữ lại bảo là của phiên trước, nên cả bản đồ trông như một ảnh chụp cũ.
 */
function stamp(at) {
  const day = formatDay(tradingDay(at));
  const note = sessionNote(at);
  if (note) return `${note.split(' · ')[0]} · ${day}`;

  const { minutes } = vietnamNow(at);
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `Đang khớp lệnh · ${clock} ${day}`;
}

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

/**
 * Chữ của bản đồ.
 *
 * Arial trước, không phải `system-ui`: ảnh này được **máy của người đọc** vẽ, nên `system-ui` nghĩa
 * là mỗi máy một kiểu chữ — máy này ra SF Pro tròn mềm, máy kia ra Roboto, máy khác ra thứ gì không
 * ai biết. Một bảng điện thì chữ phải chắc và giống nhau ở mọi nơi, và Arial/Helvetica có sẵn khắp
 * nơi. `system-ui` vẫn đứng cuối hàng, cho máy nào không có cả hai.
 */
function font() {
  return 'Arial, Helvetica, system-ui, sans-serif';
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
