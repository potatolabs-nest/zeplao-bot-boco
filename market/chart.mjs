// Chart trong ngày cho một mã.
//
// Kuku rich message đã có block `chart`, nên bot chỉ cần đưa nhãn và dãy số. Dữ liệu lấy từ
// DNSE intraday 5 phút, rồi chọn phiên mới nhất có nến: hôm nay nếu có, hoặc phiên gần nhất
// trước đó nếu hôm nay nghỉ/chưa mở cửa.
import { CHART, kindOf } from './dnse.mjs';
import { money } from './quote.mjs';

const TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 10;
const RESOLUTION = '5';
const MAX_POINTS = 64;

export function intradayChart({ base = CHART, fetchImpl = fetch, timeout = TIMEOUT_MS, now = () => Date.now() } = {}) {
  async function candles(symbol) {
    const normalized = String(symbol ?? '').toUpperCase();
    const to = Math.floor(now() / 1000);
    const from = to - LOOKBACK_DAYS * 24 * 60 * 60;
    const url = `${base}/${kindOf(normalized)}?from=${from}&to=${to}&symbol=${normalized}&resolution=${RESOLUTION}`;

    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data?.t) || !Array.isArray(data?.c) || data.t.length !== data.c.length) return null;
    return latestSession(normalized, data);
  }

  return {
    async rich(symbol, quote) {
      const session = await candles(symbol);
      return session ? chartRich(session, quote) : null;
    },
  };
}

export function latestSession(symbol, data) {
  const rows = data.t.map((stamp, index) => ({
    time: Number(stamp),
    close: Number(data.c[index]),
    high: Number(data.h?.[index] ?? data.c[index]),
    low: Number(data.l?.[index] ?? data.c[index]),
    volume: Number(data.v?.[index] ?? 0),
  })).filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0);

  const sessions = new Map();
  for (const row of rows) {
    const day = tradingDay(row.time);
    if (!sessions.has(day)) sessions.set(day, []);
    sessions.get(day).push(row);
  }

  const [day, points] = [...sessions.entries()].at(-1) ?? [];
  if (!day || points.length < 2) return null;

  const sampled = sample(points, MAX_POINTS);
  const closes = sampled.map((point) => round(point.close));
  const open = points[0].close;
  const close = points.at(-1).close;
  const high = Math.max(...points.map((point) => point.high));
  const low = Math.min(...points.map((point) => point.low));
  const volume = points.reduce((sum, point) => sum + point.volume, 0);

  return {
    symbol: String(symbol).toUpperCase(),
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

export function chartRich(session, quote) {
  const direction = session.change > 0 ? 'tăng' : session.change < 0 ? 'giảm' : 'đi ngang';
  const color = session.change > 0 ? '#16a34a' : session.change < 0 ? '#dc2626' : '#64748b';
  const reference = quote?.reference > 0 ? round(quote.reference) : null;
  const series = [
    { name: 'Giá', values: session.closes, color },
  ];
  if (reference) {
    series.push({ name: 'Tham chiếu', values: session.closes.map(() => reference), color: '#94a3b8' });
  }

  return {
    blocks: [
      {
        type: 'chart',
        chart: 'line',
        title: `${session.symbol} trong phiên ${formatDay(session.day)} · ${direction} ${signed(session.change)} (${signed(session.percent)}%)`,
        labels: session.labels,
        series,
      },
      {
        type: 'paragraph',
        text: `Mở ${money(session.open)} · Cao ${money(session.high)} · Thấp ${money(session.low)} · Đóng ${money(session.close)}`,
      },
    ],
  };
}

export function withRich(text, rich) {
  if (!rich?.blocks?.length) return { text };
  return {
    text,
    rich: {
      blocks: [
        { type: 'paragraph', text },
        ...rich.blocks,
      ],
    },
  };
}

function sample(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => points[Math.round(index * step)]);
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

function signed(value) {
  const rounded = money(Math.abs(value));
  if (value > 0) return `+${rounded}`;
  if (value < 0) return `-${rounded}`;
  return rounded;
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
