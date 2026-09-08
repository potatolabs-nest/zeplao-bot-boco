// Tin tức theo mã, dùng cho lệnh `!tin vic`.
//
// Không kéo thêm thư viện chỉ để đọc một RSS feed nhỏ. Phần bot nhận một nguồn có hàm `latest()`
// giống như nguồn giá nhận `quotes()`, để bộ test thay bằng dữ liệu giả và không phải chạm mạng.

export const NEWS_LIMIT = 5;
export const MAX_NEWS_REPLY_CHARS = 1900;

export function googleNews({ fetcher = fetch } = {}) {
  return {
    async latest(symbol, limit = NEWS_LIMIT) {
      const normalized = String(symbol ?? '').toUpperCase();

      const url = new URL('https://news.google.com/rss/search');
      url.searchParams.set('q', `${normalized} cổ phiếu chứng khoán`);
      url.searchParams.set('hl', 'vi');
      url.searchParams.set('gl', 'VN');
      url.searchParams.set('ceid', 'VN:vi');

      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Google News trả lời ${response.status}`);

      return parseRss(await response.text())
        .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
        .slice(0, limit);
    },
  };
}

export function newsReply(symbol, articles) {
  const normalized = String(symbol ?? '').toUpperCase();
  const items = articles.filter(Boolean).slice(0, NEWS_LIMIT);
  if (!items.length) return `Chưa thấy tin mới cho ${normalized}.`;

  for (const option of [
    { title: 100, summary: 80, meta: true },
    { title: 90, summary: 0, meta: true },
    { title: 70, summary: 0, meta: false },
  ]) {
    const text = renderReply(normalized, items, option);
    if (text.length <= MAX_NEWS_REPLY_CHARS) return text;
  }

  return renderReply(normalized, items, { title: 50, summary: 0, meta: false });
}

export function parseRss(xml) {
  return [...String(xml ?? '').matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([item]) => {
    const title = cleanText(readTag(item, 'title'));
    const rawTitle = stripHtml(decodeEntities(readTag(item, 'title')));
    const rawDescription = decodeEntities(readTag(item, 'description'));
    const source = cleanText(readTag(item, 'source')) || sourceFromGoogleTitle(rawTitle);
    const summary = cleanDescription(rawDescription);
    const link = cleanText(readTag(item, 'link'));
    const publishedAt = parseDate(cleanText(readTag(item, 'pubDate')));

    return { title: removeGoogleSource(title, source), summary, source, link, publishedAt };
  }).filter((article) => article.title);
}

function readTag(xml, tag) {
  const found = String(xml).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return found ? unwrapCdata(found[1]) : '';
}

function unwrapCdata(value) {
  return String(value).replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function cleanDescription(value) {
  const text = cleanText(value);
  const parts = text.split(/\s+-\s+Đọc tiếp\s*$/i);
  return parts[0] || text;
}

function cleanText(value) {
  return oneLine(stripHtml(decodeEntities(value)));
}

function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function shorten(value, max) {
  if (!value || value.length <= max) return value;
  if (max <= 1) return '';
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function renderReply(symbol, articles, option) {
  const lines = [`5 bài viết gần nhất về ${symbol}:`];
  for (const [index, article] of articles.entries()) {
    const title = shorten(oneLine(article.title), option.title);
    const summary = shorten(oneLine(article.summary), option.summary);
    const meta = option.meta ? [article.source, when(article.publishedAt)].filter(Boolean).join(' · ') : '';
    const body = summary && summary !== title ? `${title} — ${summary}` : title;
    const link = oneLine(article.link);
    lines.push(`${index + 1}. ${body}${meta ? ` (${meta})` : ''}${link ? `\n${link}` : ''}`);
  }
  return lines.join('\n');
}

function sourceFromGoogleTitle(title) {
  const parts = String(title ?? '').split(/\s+-\s+/);
  return parts.length > 1 ? parts.at(-1).trim() : '';
}

function removeGoogleSource(title, source) {
  if (!source) return title;
  return title.replace(new RegExp(`\\s+-\\s+${escapeRegExp(source)}$`, 'i'), '').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function when(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
