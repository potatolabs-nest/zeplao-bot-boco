// Chú thích thuật ngữ: bấm vào "MA200" trong tin nhắn là mở một thẻ giải thích ngay trong ứng dụng.
//
// Thẻ là view `term` của widget trong `widget/` (kuku.vn/bot/doc, "Views: opening a page from a
// message"). Mọi chữ trên thẻ đi trong tin nhắn — trong `data` của entity — chứ không nằm trong
// trang: một tin nhắn mở mãi đúng phiên bản widget nó được gửi cùng, nên chữ đi theo tin là chữ
// không bao giờ lệch với câu nó giải thích, và trang không cần biết thuật ngữ nào cả.

export const TERM_VIEW = 'term';

/// Tối đa 50 view mỗi tin nhắn, theo giới hạn của nền tảng.
const MOST_VIEWS = 50;

/// Những khối rich mang được entity, theo tài liệu.
const TEXT_BLOCKS = new Set(['paragraph', 'text', 'heading', 'quote']);

/**
 * Mỗi mục là đúng `data` mà thẻ `term` được mở cùng: `title`, `body`, và `formula`, `example` nếu
 * có. Khoá là chữ đúng như nó xuất hiện trong tin nhắn, phân biệt hoa thường.
 */
export const GLOSSARY = {
  PTKT: {
    title: 'PTKT — phân tích kỹ thuật',
    body: 'Đọc giá và khối lượng trong quá khứ để nhận ra xu hướng và tìm điểm mua bán: xu hướng theo MA, động lượng theo RSI và MACD, dòng tiền theo khối lượng. Là tín hiệu tham khảo, không phải khuyến nghị đầu tư.',
  },
  MA20: {
    title: 'MA20 — trung bình 20 phiên',
    body: 'Giá đóng cửa trung bình của 20 phiên gần nhất, khoảng một tháng giao dịch. Giá nằm trên MA20 là xu hướng ngắn hạn đang khoẻ; đóng cửa xuống dưới là dấu hiệu yếu đi.',
    formula: 'MA20 = (C₁ + C₂ + … + C₂₀) ÷ 20',
  },
  MA50: {
    title: 'MA50 — trung bình 50 phiên',
    body: 'Giá đóng cửa trung bình của 50 phiên, khoảng một quý. Thước đo xu hướng trung hạn: giữ được MA50 thường là cổ phiếu còn trong xu hướng tăng.',
    formula: 'MA50 = tổng giá đóng cửa 50 phiên ÷ 50',
  },
  MA200: {
    title: 'MA200 — trung bình 200 phiên',
    body: 'Giá đóng cửa trung bình của 200 phiên, gần một năm. Đường xu hướng dài hạn: giá trên MA200 là xu hướng dài hạn đi lên, dưới MA200 là đi xuống.',
    formula: 'MA200 = tổng giá đóng cửa 200 phiên ÷ 200',
    example: 'MA20 > MA50 > MA200 → xu hướng tăng rõ',
  },
  RSI: {
    title: 'RSI — chỉ số sức mạnh tương đối',
    body: 'So đà tăng với đà giảm trong 14 phiên, trên thang 0–100. Trên 70 là quá mua, dễ điều chỉnh; dưới 30 là quá bán, có thể hồi; quanh 45–55 là cung cầu cân bằng.',
    formula: 'RSI = 100 − 100 ÷ (1 + TB tăng ÷ TB giảm)',
    example: 'RSI 60 → bên mua đang chiếm ưu thế',
  },
  MACD: {
    title: 'MACD — hội tụ phân kỳ trung bình động',
    body: 'Hiệu giữa EMA 12 phiên và EMA 26 phiên, so với đường tín hiệu là EMA 9 phiên của chính nó. Cắt lên đường tín hiệu là động lượng tăng, cắt xuống là động lượng giảm; nằm trên mốc 0 là vùng khoẻ.',
    formula: 'MACD = EMA12 − EMA26 · Tín hiệu = EMA9(MACD)',
  },
  Bollinger: {
    title: 'Dải Bollinger (20, 2)',
    body: 'Hai dải bao quanh MA20, cách nó 2 lần độ lệch chuẩn. Giá chạm dải trên là đang căng, dễ điều chỉnh ngắn; chạm dải dưới là yếu, dễ hồi. Dải co hẹp thường báo trước một nhịp biến động mạnh.',
    formula: 'Dải trên / dưới = MA20 ± 2σ',
  },
  TB20: {
    title: 'TB20 — khối lượng trung bình 20 phiên',
    body: 'Khối lượng khớp trung bình của 20 phiên trước đó. So 5 phiên gần nhất với TB20 để đọc dòng tiền: trên 1,3 lần khi giá tăng là tiền vào xác nhận, khi giá giảm là áp lực bán.',
    example: '0,8 lần TB20 → thanh khoản thấp hơn bình thường',
  },
  KL: {
    title: 'KL — khối lượng khớp lệnh',
    body: 'Số cổ phiếu đã khớp trong phiên. Khối lượng xác nhận chuyển động giá: giá tăng mạnh kèm khối lượng lớn đáng tin hơn giá tăng khi ít người giao dịch.',
  },
  TC: {
    title: 'TC — giá tham chiếu',
    body: 'Mốc tính tăng giảm trong phiên: thường là giá đóng cửa phiên trước, được điều chỉnh vào ngày giao dịch không hưởng quyền như chia cổ tức hay phát hành thêm.',
  },
  TRẦN: {
    title: 'Giá trần',
    body: 'Mức giá cao nhất được đặt trong phiên: tham chiếu +7% ở HOSE, +10% ở HNX, +15% ở UPCoM. Khớp ở giá trần nghĩa là bên mua đang áp đảo.',
  },
  SÀN: {
    title: 'Giá sàn',
    body: 'Mức giá thấp nhất được đặt trong phiên: tham chiếu −7% ở HOSE, −10% ở HNX, −15% ở UPCoM. Khớp ở giá sàn nghĩa là bên bán đang áp đảo.',
  },
  'R:R': {
    title: 'R:R — tỷ lệ lợi nhuận / rủi ro',
    body: 'Mức có thể lãi chia cho mức có thể lỗ của một lệnh. Từ 2 trở lên thường mới đáng vào lệnh.',
    formula: 'R:R = (Chốt lời − Giá mua) ÷ (Giá mua − Cắt lỗ)',
    example: 'Mua 100, chốt lời 110, cắt lỗ 95 → R:R = 2',
  },
  'Chốt lời': {
    title: 'Chốt lời',
    body: 'Mức giá dự kiến bán để hiện thực hoá lợi nhuận, thường đặt ở vùng kháng cự — nơi giá từng quay đầu đi xuống.',
  },
  'Cắt lỗ': {
    title: 'Cắt lỗ',
    body: 'Mức giá bán ra để chặn khoản lỗ khi nhận định sai, thường đặt dưới vùng hỗ trợ một khoảng nhỏ để không bị dao động bình thường quét qua.',
  },
  'VN-Index': {
    title: 'VN-Index',
    body: 'Chỉ số của toàn bộ cổ phiếu trên sàn HOSE, tính theo vốn hoá. So một mã với VN-Index để biết nó mạnh hơn hay yếu hơn thị trường chung.',
  },
};

/// Chữ cái hoặc chữ số — thứ không được đứng sát hai bên một thuật ngữ, để `TC` trong `TCB` không bị đánh dấu.
const WORDISH = /[\p{L}\p{N}]/u;

/**
 * Entity `view` cho lần xuất hiện đầu tiên của từng thuật ngữ trong `text`.
 *
 * Theo `offset`/`length` tính bằng đơn vị UTF-16 — đúng thứ `String` của JavaScript đếm, và đúng
 * thứ nền tảng đếm. Thuật ngữ dài được tìm trước (`MA200` trước `MA20`), và không đè lên entity nào
 * đã có trong `taken`: một view không được chung ký tự với entity khác, kể cả link.
 */
export function termEntities(text, taken = [], glossary = GLOSSARY) {
  const source = String(text ?? '');
  const busy = taken
    .filter((entity) => Number.isInteger(entity?.offset) && Number.isInteger(entity?.length))
    .map((entity) => [entity.offset, entity.offset + entity.length]);
  const found = [];

  for (const term of Object.keys(glossary).sort((a, b) => b.length - a.length)) {
    if (found.length >= MOST_VIEWS) break;
    for (let at = source.indexOf(term); at >= 0; at = source.indexOf(term, at + 1)) {
      const end = at + term.length;
      const alone = !WORDISH.test(source[at - 1] ?? '') && !WORDISH.test(source[end] ?? '');
      const free = busy.every(([start, stop]) => end <= start || at >= stop);
      if (!alone || !free) continue;
      found.push({ type: 'view', offset: at, length: term.length, view: TERM_VIEW, data: glossary[term] });
      busy.push([at, end]);
      break;
    }
  }
  return found.sort((a, b) => a.offset - b.offset);
}

/**
 * Nội dung một tin nhắn, kèm chú thích thuật ngữ ở đúng chỗ nền tảng nhận.
 *
 * Tin chữ thường: vào `entities`. Tin có `rich`: vào từng khối văn bản, vì nền tảng không nhận
 * `entities` bên cạnh `rich`. Tin chỉ có hình, sticker, hay không có gì để chú thích: trả lại
 * đúng như cũ — cùng một object, để nơi gọi biết không có gì được thêm.
 */
export function withTerms(content, glossary = GLOSSARY) {
  if (!content || typeof content !== 'object' || content.stickerId) return content;

  if (Array.isArray(content.rich?.blocks)) {
    let budget = MOST_VIEWS;
    let changed = false;
    const blocks = content.rich.blocks.map((block) => {
      if (!TEXT_BLOCKS.has(block?.type) || typeof block.text !== 'string' || budget <= 0) return block;
      const views = termEntities(block.text, block.entities ?? [], glossary).slice(0, budget);
      if (!views.length) return block;
      budget -= views.length;
      changed = true;
      return { ...block, entities: [...(block.entities ?? []), ...views] };
    });
    return changed ? { ...content, rich: { ...content.rich, blocks } } : content;
  }

  if (content.image || typeof content.text !== 'string') return content;
  const views = termEntities(content.text, content.entities ?? [], glossary);
  return views.length ? { ...content, entities: [...(content.entities ?? []), ...views] } : content;
}

/// Lời từ chối nói rằng chính phần chú thích là thứ không gửi được — gửi lại không kèm nó thì có thể qua.
const VIEW_REFUSALS = [
  'bot_has_no_widget', 'views_need_uploaded_widget', 'view_not_found', 'view_name_invalid',
  'view_data_too_large', 'message_view_data_too_large', 'too_many_views', 'too_many_entities',
  'entities_overlap', 'entities_with_rich', 'entities_need_text', 'entities_need_plain_text',
  'entity_', 'rich_entit', 'widget_store_unavailable',
];

export function refusedForViews(problem) {
  const said = String(problem ?? '');
  return VIEW_REFUSALS.some((code) => said.includes(code));
}

/// Mã lỗi máy chủ trả (`"error": "view_not_found"`) trong một lỗi đã ném, hoặc null.
export function refusalCode(problem) {
  return /"error"\s*:\s*"([A-Za-z0-9_]+)"/.exec(String(problem ?? ''))?.[1] ?? null;
}
