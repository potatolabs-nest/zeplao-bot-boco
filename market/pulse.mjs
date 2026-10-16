// Nhịp thị trường theo kiểu O'Neil: ngày xác nhận đà hồi (follow-through day) và phiên phân phối.
//
// `marketOf` trong strength.mjs nhìn MA50 — chậm, vì MA50 chỉ quay lên khi giá đã chạy xa khỏi
// đáy. O'Neil nhìn vào chính hành vi của tiền lớn trên chỉ số:
//
//   - Phiên phân phối: chỉ số giảm mà khối lượng **cao hơn** phiên trước — tổ chức đang bán. Đủ
//     nhiều phiên như thế trong 25 phiên là xu hướng tăng đang bị rút ruột từ bên trong.
//   - Nỗ lực hồi phục: sau một đáy, phiên đầu tiên chỉ số đóng cửa tăng là ngày 1. Thủng đáy thì
//     đếm lại từ đầu.
//   - Ngày xác nhận: từ ngày thứ 4 của nỗ lực hồi phục, một phiên tăng mạnh với khối lượng cao hơn
//     phiên trước. Phiên tăng mà khối lượng thấp không tính — đó là bên bán ngừng tay, không phải
//     bên mua quay lại.
//
// Bốn trạng thái, đi theo vòng:
//
//   correction ──(nỗ lực hồi phục)──▶ attempt ──(ngày xác nhận)──▶ confirmed
//        ▲                              │                            │
//        └───────(thủng đáy)────────────┘          (phân phối dồn)   ▼
//        └──────────(phân phối quá nhiều, hoặc thủng đáy nhịp hồi)── pressure
//
// File này không biết gì về mạng: vào là nến ngày của chỉ số, ra là trạng thái và lý do.
import { tradingDay } from './chart.mjs';

const dayOf = (row) => row.day ?? tradingDay(row.time);

export const DEFAULTS = {
  /// Ngày xác nhận: chỉ số tăng từ chừng này % trở lên, với KL cao hơn phiên trước.
  ftdGain: 1.2,
  /// …và rơi vào từ ngày thứ chừng này của nỗ lực hồi phục.
  ftdMinDay: 4,
  /// Phiên phân phối: chỉ số giảm từ chừng này % trở lên, với KL cao hơn phiên trước.
  distributionDrop: 0.2,
  /// Đếm phiên phân phối trong chừng này phiên gần nhất.
  distributionWindow: 25,
  /// Phiên phân phối hết hiệu lực khi chỉ số đã đóng cửa cao hơn nó chừng này %.
  distributionExpire: 5,
  /// Từ chừng này phiên phân phối thì xu hướng tăng đang chịu áp lực…
  pressureDays: 4,
  /// …và từ chừng này thì coi là đã vào điều chỉnh.
  correctionDays: 6,
};

export const STATES = {
  confirmed: 'xu hướng tăng đã xác nhận',
  pressure: 'xu hướng tăng chịu áp lực',
  attempt: 'đang nỗ lực hồi phục, chưa xác nhận',
  correction: 'thị trường điều chỉnh',
};

/**
 * Đi qua toàn bộ nến chỉ số, trả về trạng thái của **từng phiên** — để backtest tra theo ngày, và
 * để phiên cuối có đủ lịch sử. Phần tử thứ i ứng với `rows[i]`.
 */
export function pulseSeries(rows, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const out = [];
  let state = 'correction';
  let low = Infinity; // đáy của đợt điều chỉnh đang xét (hoặc đáy của nhịp hồi đã xác nhận)
  let lowAt = -1;
  let attemptDay = 0;
  let ftd = null;
  const distribution = []; // chỉ số các phiên phân phối

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev = rows[i - 1];
    const change = prev ? pct(prev.close, row.close) : 0;
    const heavier = prev ? row.volume > prev.volume : false;

    if (prev && change <= -o.distributionDrop && heavier) distribution.push(i);
    while (distribution.length && distribution[0] <= i - o.distributionWindow) distribution.shift();
    for (let k = distribution.length - 1; k >= 0; k--) {
      if (pct(rows[distribution[k]].close, row.close) >= o.distributionExpire) distribution.splice(k, 1);
    }
    const count = distribution.length;

    if (state === 'correction' || state === 'attempt') {
      if (row.low < low) {
        // Đáy mới: nỗ lực hồi phục (nếu có) hỏng, đếm lại.
        low = row.low;
        lowAt = i;
        attemptDay = 0;
        state = 'correction';
      } else if (attemptDay === 0) {
        if (change > 0) { attemptDay = 1; state = 'attempt'; }
      } else {
        attemptDay++;
        if (attemptDay >= o.ftdMinDay && change >= o.ftdGain && heavier) {
          state = 'confirmed';
          ftd = { at: i, day: dayOf(row), gain: change, attemptDay };
          // Phân phối cũ thuộc về đợt giảm trước — xu hướng mới bắt đầu sạch.
          distribution.length = 0;
        }
      }
    } else {
      if (row.close < low) {
        state = 'correction';
        low = row.low;
        lowAt = i;
        attemptDay = 0;
      } else if (count >= o.correctionDays) {
        state = 'correction';
        low = row.low;
        lowAt = i;
        attemptDay = 0;
      } else {
        state = count >= o.pressureDays ? 'pressure' : 'confirmed';
      }
    }

    out.push({
      state,
      distribution: distribution.length,
      attemptDay: state === 'attempt' ? attemptDay : 0,
      low: Number.isFinite(low) ? low : null,
      lowDay: lowAt >= 0 ? dayOf(rows[lowAt]) : null,
      ftd: state === 'confirmed' || state === 'pressure' ? ftd : null,
      change,
      volumeVsPrev: prev && prev.volume > 0 ? row.volume / prev.volume : null,
      volumeVs20: i >= 20 ? row.volume / mean(rows.slice(i - 20, i).map((r) => r.volume)) : null,
    });
  }
  return out;
}

/** Trạng thái của phiên cuối. `null` khi chưa đủ phiên. */
export function pulseOf(rows, options = {}) {
  if (rows.length < 60) return null;
  return pulseSeries(rows, options).at(-1);
}

/**
 * Một hai dòng cho tin nhắn: trạng thái, lý do, và việc cần chờ. `estimated` khi phiên cuối là
 * nến đang chạy với KL ước cả phiên.
 *
 * Chỉ để thông tin, không chặn lệnh: backtest 5 năm, lọc theo nhịp này cho lệnh tốt hơn từng lệnh
 * nhưng bỏ lỡ gần nửa số lệnh, tổng lãi thấp hơn lọc theo MA50 — xem `marketOf` trong strength.mjs.
 */
export function pulseLines(pulse, { estimated = false, ...options } = {}) {
  if (!pulse) return [];
  const o = { ...DEFAULTS, ...options };
  const volume = [
    pulse.volumeVsPrev != null && `KL ${estimated ? 'ước ' : ''}${fmt(pulse.volumeVsPrev)} lần phiên trước`,
    pulse.volumeVs20 != null && `${fmt(pulse.volumeVs20)} lần TB20`,
  ].filter(Boolean).join(', ');
  const head = `Nhịp thị trường: ${STATES[pulse.state]} · ${pulse.distribution} phiên phân phối/${o.distributionWindow} phiên · VN-Index ${signed(pulse.change)}, ${volume}`;
  const why = {
    confirmed: pulse.ftd && `Xác nhận ngày ${formatDay(pulse.ftd.day)} (+${fmt(pulse.ftd.gain)}%, ngày ${pulse.ftd.attemptDay} của nhịp hồi) · thủng ${fmt(pulse.low)} là hỏng`,
    pressure: `Phân phối dồn — thêm ${o.correctionDays - pulse.distribution} phiên nữa là điều chỉnh · thủng ${fmt(pulse.low)} là hỏng`,
    attempt: `Ngày ${pulse.attemptDay} của nhịp hồi từ đáy ${fmt(pulse.low)} (${formatDay(pulse.lowDay)}) · chờ phiên tăng từ ${fmt(o.ftdGain)}% với KL cao hơn phiên trước${pulse.attemptDay < o.ftdMinDay ? `, từ ngày ${o.ftdMinDay}` : ''}`,
    correction: pulse.lowDay && `Đáy gần nhất ${fmt(pulse.low)} (${formatDay(pulse.lowDay)}) · chờ một phiên đóng cửa tăng để bắt đầu đếm nhịp hồi`,
  }[pulse.state];
  return why ? [head, why] : [head];
}

// ---- tiện ích ----------------------------------------------------------------------------------

function pct(from, to) {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function formatDay(day) {
  return day ? day.split('-').reverse().join('/') : '';
}
const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const fmt = (value) => one.format(value);
const signed = (value) => `${value > 0 ? '+' : ''}${one.format(value)}%`;
