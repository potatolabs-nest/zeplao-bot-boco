// Chart giá cho một mã: trong phiên bằng nến 5 phút, dài hạn bằng nến ngày.
//
// Kuku rich message có block `chart`, nhưng renderer hiện tại không vẽ nhãn trục Y. Vì chart
// giá mà thiếu thang giá thì khó đọc, phần này tự dựng một SVG an toàn rồi gửi qua field
// `image.svg` của rich message.
import { CHART, kindOf } from './dnse.mjs';
import { count, money } from './quote.mjs';

const TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 10;
const INTRADAY_RESOLUTION = '5';
const DAILY_RESOLUTION = '1D';
const MAX_INTRADAY_POINTS = 64;
const MAX_RANGE_POINTS = 96;

export const CHART_PERIODS = new Map([
  ['1m', { key: '1m', days: 31, label: '1 tháng' }],
  ['6m', { key: '6m', days: 183, label: '6 tháng' }],
  ['1n', { key: '1n', days: 370, label: '1 năm' }],
  ['5n', { key: '5n', days: 1835, label: '5 năm' }],
]);

export function intradayChart({ base = CHART, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  async function candles(symbol, periodKey) {
    const normalized = String(symbol ?? '').toUpperCase();
    const period = CHART_PERIODS.get(String(periodKey ?? '').toLowerCase());
    const to = Math.floor(now() / 1000);
    const days = period?.days ?? LOOKBACK_DAYS;
    const resolution = period ? DAILY_RESOLUTION : INTRADAY_RESOLUTION;
    const from = to - days * 24 * 60 * 60;
    const url = `${base}/${kindOf(normalized)}?from=${from}&to=${to}&symbol=${normalized}&resolution=${resolution}`;

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data?.t) || !Array.isArray(data?.c) || data.t.length !== data.c.length) return null;
    return period ? rangeSession(normalized, data, period) : latestSession(normalized, data);
  }

  return {
    async rich(symbol, quote, period) {
      const session = await candles(symbol, period);
      return session ? chartRich(session, quote) : null;
    },
  };
}

export function latestSession(symbol, data) {
  const rows = rowsFrom(data);

  const sessions = new Map();
  for (const row of rows) {
    const day = tradingDay(row.time);
    if (!sessions.has(day)) sessions.set(day, []);
    sessions.get(day).push(row);
  }

  const [day, points] = [...sessions.entries()].at(-1) ?? [];
  if (!day || points.length < 2) return null;

  const sampled = sample(points, MAX_INTRADAY_POINTS);
  const closes = sampled.map((point) => round(point.close));
  const open = points[0].close;
  const close = points.at(-1).close;
  const high = Math.max(...points.map((point) => point.high));
  const low = Math.min(...points.map((point) => point.low));
  const volume = points.reduce((sum, point) => sum + point.volume, 0);

  return {
    symbol: String(symbol).toUpperCase(),
    mode: 'intraday',
    period: '1d',
    day,
    labels: sampled.map((point) => label(point.time)),
    closes,
    open,
    close,
    high,
    low,
    volume,
    change: round(close - open),
    percent: open > 0 ? round(((close - open) / open) * 100) : 0,
  };
}

export function rangeSession(symbol, data, period) {
  const points = rowsFrom(data);
  if (points.length < 2) return null;

  const sampled = sample(points, MAX_RANGE_POINTS);
  const open = points[0].close;
  const close = points.at(-1).close;
  const high = Math.max(...points.map((point) => point.high));
  const low = Math.min(...points.map((point) => point.low));
  const volume = points.reduce((sum, point) => sum + point.volume, 0);
  const day = tradingDay(points.at(-1).time);

  return {
    symbol: String(symbol).toUpperCase(),
    mode: 'range',
    period: period.key,
    periodLabel: period.label,
    day,
    labels: sampled.map((point) => dateLabel(point.time, period.key)),
    closes: sampled.map((point) => round(point.close)),
    open,
    close,
    high,
    low,
    volume,
    change: round(close - open),
    percent: open > 0 ? round(((close - open) / open) * 100) : 0,
  };
}

export function chartRich(session, quote) {
  const direction = session.change > 0 ? 'tăng' : session.change < 0 ? 'giảm' : 'đi ngang';
  const ranged = session.mode === 'range';
  const title = ranged
    ? `${session.symbol} ${session.periodLabel} đến ${formatDay(session.day)} · ${direction} ${signed(session.change)} (${signed(session.percent)}%)`
    : `${session.symbol} trong phiên ${formatDay(session.day)} · ${direction} ${signedDong(dong(session.change))} (${signed(session.percent)}%)`;

  return {
    image: {
      fileName: ranged
        ? `${session.symbol.toLowerCase()}-${session.period}-${session.day}.svg`
        : `${session.symbol.toLowerCase()}-${session.day}.svg`,
      svg: chartSvg(session, quote, title),
    },
    blocks: [
      ranged ? rangeStats(session) : intradayStats(session),
    ],
  };
}

export function withRich(text, rich) {
  if (!rich?.blocks?.length && !rich?.image) return { text };
  return {
    text,
    ...(rich.image ? { image: rich.image } : {}),
    rich: {
      blocks: [
        { type: 'paragraph', text },
        ...(rich.blocks ?? []),
      ],
    },
  };
}

function sample(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => points[Math.round(index * step)]);
}

function axisLabels(labels, ticks = 6) {
  if (labels.length <= ticks) return labels;
  const step = (labels.length - 1) / (ticks - 1);
  return Array.from({ length: ticks }, (_, index) => labels[Math.round(index * step)]);
}

function rowsFrom(data) {
  return data.t.map((stamp, index) => ({
    time: Number(stamp),
    close: Number(data.c[index]),
    high: Number(data.h?.[index] ?? data.c[index]),
    low: Number(data.l?.[index] ?? data.c[index]),
    volume: Number(data.v?.[index] ?? 0),
  })).filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0);
}

function intradayStats(session) {
  const baseline = session.open;
  const highMove = dong(session.high - baseline);
  const lowMove = dong(session.low - baseline);
  return {
    type: 'paragraph',
    text: `Mở ${money(session.open)} · Cao ${money(session.high)} (${signedDong(highMove)}) · Thấp ${money(session.low)} (${signedDong(lowMove)}) · Đóng ${money(session.close)}`,
  };
}

function rangeStats(session) {
  return {
    type: 'paragraph',
    text: `Đầu kỳ ${money(session.open)} · Cao ${money(session.high)} · Thấp ${money(session.low)} · Cuối kỳ ${money(session.close)} · KL ${count(session.volume)}`,
  };
}

function chartSvg(session, quote, title) {
  const width = 720;
  const height = 420;
  const plot = { left: 86, right: 26, top: 64, bottom: 58 };
  const prices = session.closes.map(Number).filter(Number.isFinite);
  const reference = session.mode !== 'range' && quote?.reference > 0 ? round(quote.reference) : null;
  const floor = Math.min(session.low, ...prices, reference ?? session.low);
  const ceiling = Math.max(session.high, ...prices, reference ?? session.high);
  const padding = Math.max((ceiling - floor) * 0.12, 0.05);
  const min = floor - padding;
  const max = ceiling + padding;
  const y = (price) => plot.top + ((max - price) / (max - min)) * (height - plot.top - plot.bottom);
  const x = (index) => plot.left + (index / Math.max(1, prices.length - 1)) * (width - plot.left - plot.right);
  const points = prices.map((price, index) => `${round(x(index))},${round(y(price))}`).join(' ');
  const baselineY = y(session.open);
  const area = `${plot.left},${baselineY} ${points} ${width - plot.right},${baselineY}`;
  const stroke = session.change > 0 ? '#16a34a' : session.change < 0 ? '#dc2626' : '#475569';
  const fill = session.change > 0 ? '#dcfce7' : session.change < 0 ? '#fee2e2' : '#e2e8f0';
  const ticks = priceTicks(session);
  const timeLabels = axisLabels(session.labels);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="22" fill="#f6fbf8"/>
  <text x="${plot.left}" y="34" fill="#0f172a" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="20" font-weight="700">${escapeXml(title)}</text>
  <line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${height - plot.bottom}" stroke="#94a3b8" stroke-width="2"/>
  <line x1="${plot.left}" y1="${height - plot.bottom}" x2="${width - plot.right}" y2="${height - plot.bottom}" stroke="#cbd5e1" stroke-width="1"/>
  ${ticks.map((tick) => `<g>
    <line x1="${plot.left}" y1="${round(y(tick))}" x2="${width - plot.right}" y2="${round(y(tick))}" stroke="#dbe4dc" stroke-width="1"/>
    <text x="${plot.left - 10}" y="${round(y(tick) + 5)}" text-anchor="end" fill="#64748b" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="17">${escapeXml(money(tick))}</text>
  </g>`).join('')}
  <line x1="${plot.left}" y1="${round(baselineY)}" x2="${width - plot.right}" y2="${round(baselineY)}" stroke="#94a3b8" stroke-width="3"/>
  ${reference ? `<line x1="${plot.left}" y1="${round(y(reference))}" x2="${width - plot.right}" y2="${round(y(reference))}" stroke="#64748b" stroke-width="2" stroke-dasharray="8 8" opacity="0.65"/>` : ''}
  <polygon points="${area}" fill="${fill}" opacity="0.72"/>
  <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  ${timeLabels.map((tick, index) => `<text x="${round(plot.left + index * ((width - plot.left - plot.right) / Math.max(1, timeLabels.length - 1)))}" y="${height - 22}" text-anchor="middle" fill="#64748b" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="16">${escapeXml(tick)}</text>`).join('')}
</svg>`;
}

function priceTicks(session) {
  const values = [session.high, session.open, session.low].map(round);
  return [...new Set(values)].sort((a, b) => b - a);
}

function tradingDay(seconds) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(seconds * 1000));
}

function formatDay(day) {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

function label(seconds) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}

function dateLabel(seconds, period) {
  const at = new Date(seconds * 1000);
  if (period === '5n') {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      month: '2-digit',
      year: '2-digit',
    }).format(at);
  }
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  }).format(at);
}

function signed(value) {
  const rounded = money(Math.abs(value));
  if (value > 0) return `+${rounded}`;
  if (value < 0) return `-${rounded}`;
  return rounded;
}

function signedDong(value) {
  const rounded = count(Math.abs(value));
  if (value > 0) return `+${rounded}đ`;
  if (value < 0) return `-${rounded}đ`;
  return '0đ';
}

function dong(value) {
  return Math.round(Number(value) * 1000);
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
