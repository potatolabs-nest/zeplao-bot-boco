// Pha thị trường và hành động theo pha, cho đầu tin `!manh` / `!hoiphuc` và lệnh `!strategy`.
//
// Pha ghép hai thước đo đã có sẵn: VN-Index so với MA20, MA50 (`marketOf` trong strength.mjs) và
// nhịp O'Neil — phiên phân phối, ngày xác nhận (`pulseOf` trong pulse.mjs):
//
//   - Downtrend: nhịp đang "điều chỉnh", hoặc VN-Index dưới MA50 và MA20 dưới MA50 — kể cả khi
//     đang nỗ lực hồi phục, vì nỗ lực chưa có ngày xác nhận thì chưa là gì.
//   - Uptrend: VN-Index trên MA50, MA20 trên MA50, và nhịp đã xác nhận, chưa bị phân phối dồn.
//   - Đi ngang: mọi trường hợp còn lại — tín hiệu lẫn lộn thì đánh nhỏ.
//
// Hành động theo pha là quy tắc quản lý vốn kiểu CANSLIM/Minervini, chỉnh cho T+2,5 ở Việt Nam.
// Chưa backtest — chỉ để nhắc kỷ luật, không phải khuyến nghị.
//
// File này không biết gì về mạng: vào là bối cảnh thị trường, ra là pha và câu chữ. Hình ở
// `strategySvg` trong screens-chart.mjs.
import { DEFAULTS as PULSE, STATES } from './pulse.mjs';

/**
 * Mỗi pha: tên, mục tiêu, tỷ trọng cổ phiếu (`exposure` là khoảng % để vẽ), và các ô hành động —
 * `value` ngắn để in to trên hình, `note` là phần giải thích đi kèm.
 */
export const PHASES = {
  up: {
    name: 'UPTREND',
    goal: 'kiếm tiền',
    exposure: [80, 100],
    cards: [
      { key: 'positions', label: 'Số mã nắm', value: '4–6 mã' },
      { key: 'perStock', label: 'Tỷ trọng mỗi mã', value: '15–25%' },
      { key: 'risk', label: 'Rủi ro mỗi lệnh', value: '1%', note: 'tài khoản' },
      { key: 'trades', label: 'Lệnh mới', value: '2–4/tuần' },
      { key: 'stop', label: 'Cắt lỗ', value: '5–8%' },
      { key: 'pyramid', label: 'Mua thêm', value: 'Có', note: 'chỉ khi lệnh đang lời' },
    ],
    entry: 'Breakout qua pivot kèm KL lớn; pullback lần đầu về MA10/MA20 sau breakout',
    exit: 'Bán 1/3 ở +2R, phần còn lại giữ tới khi đóng cửa dưới MA20',
    next: [
      'Phân phối từ 4 phiên/25: ngừng mở lệnh mới, siết cắt lỗ',
      'VN-Index thủng MA50 hoặc từ 6 phiên phân phối: chuyển sang phòng thủ',
    ],
  },
  sideways: {
    name: 'ĐI NGANG',
    goal: 'kiếm ít, giữ vốn',
    exposure: [30, 60],
    cards: [
      { key: 'positions', label: 'Số mã nắm', value: '3–4 mã' },
      { key: 'perStock', label: 'Tỷ trọng mỗi mã', value: '10–15%' },
      { key: 'risk', label: 'Rủi ro mỗi lệnh', value: '0,5–0,75%', note: 'tài khoản' },
      { key: 'trades', label: 'Lệnh mới', value: '1–2/tuần' },
      { key: 'stop', label: 'Cắt lỗ', value: '3–5%' },
      { key: 'pyramid', label: 'Mua thêm', value: 'Không' },
    ],
    entry: 'Pullback về MA20 hoặc hỗ trợ, KL cạn, có nến xác nhận; breakout hay hụt',
    exit: 'Chốt ở đỉnh cũ hoặc kháng cự gần nhất, không gồng',
    next: [
      'Lên uptrend: VN-Index và MA20 cùng trên MA50, có ngày xác nhận',
      'Xuống downtrend: VN-Index và MA20 cùng dưới MA50, hoặc từ 6 phiên phân phối',
    ],
  },
  down: {
    name: 'DOWNTREND',
    goal: 'giữ vốn, chuẩn bị danh sách theo dõi',
    exposure: [0, 20],
    cards: [
      { key: 'positions', label: 'Số mã nắm', value: '0–2 mã' },
      { key: 'perStock', label: 'Tỷ trọng mỗi mã', value: '5–10%' },
      { key: 'risk', label: 'Rủi ro mỗi lệnh', value: '0,25–0,5%', note: 'tài khoản' },
      { key: 'trades', label: 'Lệnh mới', value: '≤ 1/tuần', note: 'hoặc không' },
      { key: 'stop', label: 'Cắt lỗ', value: '3–4%', note: 'chặt' },
      { key: 'pyramid', label: 'Mua thêm', value: 'Không' },
    ],
    entry: 'Chỉ pullback ở mã RS ≥ 90 giữ được MA20, hoặc mã hồi phục đã xác nhận đáy',
    exit: 'Chốt nhanh ở kháng cự gần nhất (+5–8%)',
    next: [
      `Có ngày xác nhận (VN-Index tăng từ ${fmt(PULSE.ftdGain)}%, KL cao hơn phiên trước): thăm dò 1–2 lệnh breakout, 25–50% tỷ trọng chuẩn`,
      'Lệnh thăm dò có lời và VN-Index lấy lại MA50: nâng lên 40–60%',
    ],
  },
};

/// Kỷ luật chung, pha nào cũng giữ.
export const RULES = [
  'Số cổ = (tài khoản × % rủi ro) / (giá mua − cắt lỗ), rồi giới hạn theo tỷ trọng mỗi mã',
  'T+2,5: chưa bán được trong 2 phiên đầu, tính thêm 2–3% trượt giá vào rủi ro',
  '2–3 lệnh thua liên tiếp: giảm một nửa tỷ trọng mỗi lệnh · tài khoản giảm 8–10% từ đỉnh: nghỉ 1–2 tuần',
];

/**
 * Pha thị trường từ `market` (`marketOf`) và `pulse` (`pulseOf`); một trong hai có thể `null`.
 * `null` khi không có gì để xét.
 */
export function phaseOf(market, pulse) {
  if (!market && !pulse) return null;
  if (pulse?.state === 'correction') return 'down';
  if (market?.regime === 'down') return 'down';
  if (market?.regime === 'up' && (!pulse || pulse.state === 'confirmed')) return 'up';
  return 'sideways';
}

/**
 * Lý do của pha: mỗi tiêu chí một câu, kèm chiều — `up` ủng hộ tăng, `down` ủng hộ giảm, `flat`
 * lưng chừng. Hình và chữ dùng chung.
 */
export function phaseReasons(market, pulse) {
  const out = [];
  if (market) {
    out.push({ text: `VN-Index ${market.close > market.ma50 ? 'trên' : 'dưới'} MA50`, tone: market.close > market.ma50 ? 'up' : 'down' });
    out.push({ text: `MA20 ${market.ma20 > market.ma50 ? 'trên' : 'dưới'} MA50`, tone: market.ma20 > market.ma50 ? 'up' : 'down' });
  }
  if (pulse) {
    const tone = { confirmed: 'up', pressure: 'flat', attempt: 'flat', correction: 'down' }[pulse.state];
    out.push({ text: STATES[pulse.state], tone });
    const heavy = pulse.distribution >= PULSE.correctionDays ? 'down' : pulse.distribution >= PULSE.pressureDays ? 'flat' : 'up';
    out.push({ text: `${pulse.distribution} phiên phân phối/${PULSE.distributionWindow}`, tone: heavy });
  }
  return out;
}

/// Việc cần làm ở chỗ chuyển pha, theo nhịp thị trường. Rỗng khi không ở chỗ chuyển.
export function transition(phase, pulse) {
  if (!pulse) return '';
  if (pulse.state === 'attempt') return 'Có ngày xác nhận thì thăm dò 1–2 lệnh breakout mã dẫn dắt, 25–50% tỷ trọng chuẩn';
  if (pulse.state === 'pressure') return 'Phân phối dồn: ngừng mở lệnh mới, siết cắt lỗ';
  if (pulse.state === 'confirmed' && phase !== 'up') return 'Vừa có ngày xác nhận: thăm dò breakout nhỏ, lời thì mới tăng tỷ trọng';
  return '';
}

/**
 * Một câu cho mục "Lúc này" của `!strategy`: mã đang ở đâu trong nhịp, việc nên làm ngay. Khác
 * `transition` — câu ấy là việc khi có tín hiệu, đã nằm trong "chuyển pha khi".
 */
export function nowText(phase, pulse) {
  if (!pulse) return '';
  if (pulse.state === 'attempt') {
    return `Ngày ${pulse.attemptDay} của nhịp hồi${pulse.low ? ` từ đáy ${fmt(pulse.low)}` : ''}, chưa có ngày xác nhận: chưa mua đuổi, soạn sẵn danh sách theo dõi (!manh, !hoiphuc) và điểm mua từng mã`;
  }
  if (pulse.state === 'correction') return 'Thị trường đang điều chỉnh: giữ tiền, chờ một phiên tăng để bắt đầu đếm nhịp hồi';
  return transition(phase, pulse);
}

/// "0–20%" từ khoảng tỷ trọng.
export function exposureText(phase) {
  const [low, high] = PHASES[phase].exposure;
  return `${low}–${high}%`;
}

const card = (phase, key) => PHASES[phase].cards.find((c) => c.key === key);
const cardText = (phase, key) => {
  const c = card(phase, key);
  return c.note ? `${c.value} (${c.note})` : c.value;
};

/** Hai ba dòng cho đầu tin `!manh` / `!hoiphuc`: pha, tỷ trọng, kiểu điểm mua, việc ở chỗ chuyển pha. */
export function phaseLines(market, pulse) {
  const phase = phaseOf(market, pulse);
  if (!phase) return [];
  const p = PHASES[phase];
  const next = transition(phase, pulse);
  return [
    `Pha thị trường: ${p.name} · tỷ trọng cổ phiếu ${exposureText(phase)} · ${card(phase, 'positions').value}, ${card(phase, 'perStock').value}/mã`,
    `Ưu tiên: ${p.entry.charAt(0).toLowerCase()}${p.entry.slice(1)} · cắt lỗ ${cardText(phase, 'stop')}`,
    next && `${next} · chi tiết: !strategy`,
  ].filter(Boolean);
}

/**
 * Tin nhắn cho `!strategy`: chỉ hành động của pha hiện tại, kèm lý do và điều kiện chuyển pha.
 * Không xác định được pha (nguồn chết) thì nói ra, chỉ in kỷ luật chung.
 */
export function strategyMessage(market, pulse, { day = '' } = {}) {
  const phase = phaseOf(market, pulse);
  const lines = [`CHIẾN LƯỢC${day ? ` · phiên ${day.split('-').reverse().join('/')}` : ''}`];
  if (!phase) {
    lines.push('Chưa lấy được dữ liệu VN-Index để xác định pha. Thử lại sau một lát.', '', 'Kỷ luật chung:');
    lines.push(...RULES.map((rule) => `• ${rule}`));
    return lines.join('\n');
  }

  const p = PHASES[phase];
  lines.push(
    `Pha hiện tại: ${p.name} — ${p.goal}`,
    `Vì sao: ${phaseReasons(market, pulse).map((reason) => reason.text).join(' · ')}`,
    '',
    'Nên làm:',
    `• Tỷ trọng cổ phiếu ${exposureText(phase)} · ${cardText(phase, 'positions')}, ${cardText(phase, 'perStock')}/mã`,
    `• Rủi ro ${card(phase, 'risk').value} tài khoản/lệnh · lệnh mới ${cardText(phase, 'trades')}`,
    `• Điểm mua: ${p.entry}`,
    `• Cắt lỗ ${cardText(phase, 'stop')} · ${p.exit}`,
    `• Mua thêm: ${cardText(phase, 'pyramid')}`,
  );
  const now = nowText(phase, pulse);
  if (now) lines.push('', `Lúc này: ${now}`);
  lines.push('', 'Chuyển pha khi:', ...p.next.map((item) => `• ${item}`));
  lines.push('', 'Kỷ luật chung:', ...RULES.map((rule) => `• ${rule}`));
  lines.push('', 'Quy tắc quản lý vốn chưa backtest — không phải khuyến nghị đầu tư.');
  return lines.join('\n');
}

function fmt(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
}
