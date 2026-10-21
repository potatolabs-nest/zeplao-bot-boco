// Thanh khoản VN-Index trong phiên, so với cùng giờ phiên trước, cho lệnh `!liqu` / `!thanhkhoan`.
//
// Nến của DNSE cho chỉ số chỉ có khối lượng, không có giá trị. Vietcap thì có: nến phút của VNINDEX
// mang sẵn `accumulatedValue` — giá trị giao dịch cộng dồn từ đầu phiên, bằng triệu đồng. Đối chiếu
// một lần với bảng của chính Vietcap lúc 14:12 ngày 21/10/2026: 16.554 tỷ ở đây, 16.535 tỷ trên bảng
// chụp sớm hơn vài chục giây.
//
// So "với hôm qua" là so **cùng giờ**, không phải so với cả phiên hôm qua: giữa phiên thì hôm nay
// lúc nào cũng thua cả phiên hôm qua, và một con số luôn âm không nói được gì.
import { formatDay, tradingDay } from './chart.mjs';
import { count } from './quote.mjs';

export const VIETCAP_CHART = 'https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart';

const TIMEOUT_MS = 8000;
/// Nến phút: một phiên chừng 250 cây, nên 900 cây phủ được hai phiên kể cả qua một kỳ nghỉ cuối tuần.
const COUNT_BACK = 900;
/// Giữ kết quả chừng này: nến phút đổi mỗi phút, mà năm người cùng gõ thì không cần hỏi năm lần.
const FRESH_MS = 30 * 1000;
const MILLION = 1e6;
const BILLION = 1e9;

export function vietcapLiquidity({ url = VIETCAP_CHART, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  let last = null;

  async function minutes() {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://trading.vietcap.com.vn',
        Referer: 'https://trading.vietcap.com.vn/',
      },
      body: JSON.stringify({
        timeFrame: 'ONE_MINUTE', symbols: ['VNINDEX'], to: Math.floor(now() / 1000), countBack: COUNT_BACK,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Vietcap nến phút trả lời ${response.status}`);
    const [data] = await response.json();
    return sessionsFrom(data);
  }

  return {
    /// Tin có hình, hoặc `null` khi nguồn không có đủ hai phiên để so.
    async rich() {
      if (!last || now() - last.at >= FRESH_MS) last = { at: now(), sessions: await minutes() };
      const shown = compare(last.sessions);
      return shown && liquidityRich(shown);
    },
  };
}

/**
 * Nến phút thành các phiên, mỗi phiên là chuỗi `{ minute, value }` — `minute` tính từ 0:00 giờ Việt
 * Nam, `value` là giá trị cộng dồn bằng đồng.
 */
export function sessionsFrom(data) {
  if (!Array.isArray(data?.t) || !Array.isArray(data?.accumulatedValue)) return [];
  const byDay = new Map();
  data.t.forEach((stamp, i) => {
    const seconds = Number(stamp);
    const value = Number(data.accumulatedValue[i]) * MILLION;
    if (!Number.isFinite(seconds) || !Number.isFinite(value)) return;
    const day = tradingDay(seconds);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ minute: minuteOf(seconds), value });
  });
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, points]) => ({ day, points: points.sort((a, b) => a.minute - b.minute) }));
}

/// Hai phiên gần nhất, và mức hôm nay so với hôm qua ở cùng phút.
export function compare(sessions) {
  if (sessions.length < 2) return null;
  const [before, today] = sessions.slice(-2);
  const latest = today.points.at(-1);
  if (!latest) return null;
  const then = valueAt(before.points, latest.minute);
  return {
    today,
    before,
    value: latest.value,
    minute: latest.minute,
    then,
    beforeTotal: before.points.at(-1)?.value ?? 0,
    percent: then > 0 ? ((latest.value - then) / then) * 100 : null,
  };
}

/// Giá trị cộng dồn tới phút ấy: cây nến cuối cùng không muộn hơn nó.
function valueAt(points, minute) {
  let value = 0;
  for (const point of points) {
    if (point.minute > minute) break;
    value = point.value;
  }
  return value;
}

function minuteOf(seconds) {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(seconds * 1000)).split(':').map(Number);
  return (hour % 24) * 60 + minute;
}

// ---- câu chữ và hình ----------------------------------------------------------------------------

export function liquidityText(shown) {
  const billions = (value) => `${count(value / BILLION)} tỷ`;
  const moved = shown.percent == null ? '' : shown.percent >= 0 ? ` tăng ${pct(shown.percent)}` : ` giảm ${pct(-shown.percent)}`;
  return [
    `Thanh khoản VN-Index phiên ${formatDay(shown.today.day)} tới ${clock(shown.minute)}: ${billions(shown.value)} đồng,${moved} so với cùng giờ phiên ${formatDay(shown.before.day)} (${billions(shown.then)})`,
    `Cả phiên ${formatDay(shown.before.day)}: ${billions(shown.beforeTotal)}`,
  ].join('\n');
}

export function liquidityRich(shown) {
  const text = liquidityText(shown);
  return {
    text,
    image: { fileName: `thanhkhoan-${shown.today.day}.svg`, svg: liquiditySvg(shown) },
    rich: { blocks: [{ type: 'paragraph', text }] },
  };
}

const W = 1200;
const H = 440;
const SCALE = 2;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const PLOT = { left: 104, right: 1150, top: 70, bottom: 345 };
const OPEN = 9 * 60;
const CLOSE = 15 * 60;
const SURFACE = '#ffffff';
const INK = '#1f1f1f';
const MUTED = '#6b6b6b';
const GRID = '#e6e6e6';
const TODAY = '#2e9e44';
const TODAY_FILL = '#c6e5c7';
const BEFORE_FILL = '#c9c9d1';

export function liquiditySvg(shown) {
  const highest = Math.max(shown.value, shown.beforeTotal, 1);
  const step = niceStep(highest / 4);
  const top = Math.ceil((highest * 1.08) / step) * step;
  const x = (minute) => PLOT.left + ((Math.min(Math.max(minute, OPEN), CLOSE) - OPEN) / (CLOSE - OPEN)) * (PLOT.right - PLOT.left);
  const y = (value) => PLOT.bottom - (value / top) * (PLOT.bottom - PLOT.top);

  const area = (points) => {
    const kept = points.filter((point) => point.minute >= OPEN && point.minute <= CLOSE);
    if (!kept.length) return '';
    const line = kept.map((point, i) => `${i ? 'L' : 'M'}${r(x(point.minute))},${r(y(point.value))}`).join('');
    return `${line}L${r(x(kept.at(-1).minute))},${PLOT.bottom}L${r(x(kept[0].minute))},${PLOT.bottom}Z`;
  };

  const ticks = [];
  for (let value = 0; value <= top + 1; value += step) ticks.push(value);
  const hours = [];
  for (let minute = OPEN; minute <= CLOSE; minute += 50) hours.push(minute);

  const moved = shown.percent == null ? '' : ` ${shown.percent >= 0 ? 'tăng +' : 'giảm '}${pctPlain(shown.percent)}% so với hôm qua`;
  const title = `Thanh khoản VN-Index đạt ${count(shown.value / BILLION)} tỷ đồng${moved}`;
  const endX = x(shown.minute);
  const endY = y(shown.value);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="${W / 2}" y="36" text-anchor="middle" font-size="22" fill="${INK}">${escapeXml(title)}</text>
  ${ticks.map((tick) => `<line x1="${PLOT.left}" y1="${r(y(tick))}" x2="${PLOT.right}" y2="${r(y(tick))}" stroke="${GRID}"/>
  <text x="${PLOT.left - 10}" y="${r(y(tick) + 5)}" text-anchor="end" font-size="15" fill="${MUTED}">${count(tick / BILLION)}</text>`).join('')}
  <text transform="translate(28 ${(PLOT.top + PLOT.bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="14" fill="${MUTED}">GTGD (tỷ đồng)</text>
  <path d="${area(shown.today.points)}" fill="${TODAY_FILL}" opacity="0.95"/>
  <path d="${area(shown.before.points)}" fill="${BEFORE_FILL}" opacity="0.6"/>
  <line x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}" stroke="${MUTED}"/>
  ${hours.map((minute) => `<line x1="${r(x(minute))}" y1="${PLOT.bottom}" x2="${r(x(minute))}" y2="${PLOT.bottom + 6}" stroke="${MUTED}"/>
  <text x="${r(x(minute))}" y="${PLOT.bottom + 26}" text-anchor="middle" font-size="15" fill="${MUTED}">${clock(minute)}</text>`).join('')}
  <circle cx="${r(endX)}" cy="${r(endY)}" r="4" fill="${TODAY}"/>
  <text x="${r(Math.min(endX, PLOT.right - 50))}" y="${r(Math.max(endY - 14, PLOT.top - 6))}" text-anchor="middle" font-size="16" fill="${TODAY}">${count(shown.value / BILLION)}</text>
  <circle cx="${PLOT.left + 6}" cy="${H - 30}" r="8" fill="${TODAY}"/>
  <text x="${PLOT.left + 22}" y="${H - 24}" font-size="16" fill="${INK}">Hôm nay ${formatDay(shown.today.day)}</text>
  <circle cx="${PLOT.left + 236}" cy="${H - 30}" r="8" fill="${BEFORE_FILL}"/>
  <text x="${PLOT.left + 252}" y="${H - 24}" font-size="16" fill="${INK}">Phiên trước ${formatDay(shown.before.day)}</text>
  <text x="${PLOT.right}" y="${H - 24}" text-anchor="end" font-size="15" fill="${MUTED}">${formatDay(shown.today.day)} · ${clock(shown.minute)}</text>
</svg>`;
}

function niceStep(raw) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const norm = raw / magnitude;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
}

function clock(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

const two = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pct(value) {
  return `${two.format(value)}%`;
}

function pctPlain(value) {
  return two.format(Math.abs(value));
}

function r(value) {
  return Math.round(value * 10) / 10;
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
