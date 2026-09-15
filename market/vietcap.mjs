// Cơ cấu doanh thu từ báo cáo tài chính, lấy ở Vietcap IQ — cho lệnh `!kq`.
//
// Không có nguồn miễn phí nào công khai doanh thu theo mảng kinh doanh (báo cáo bộ phận). Vietcap
// có thứ gần nhất và có cho mọi mã, không cần khoá: thuyết minh doanh thu theo loại, và báo cáo kết
// quả kinh doanh theo đúng mẫu của từng loại công ty. Nên câu trả lời tách theo thứ mỗi loại công
// ty thực sự báo cáo:
//
//   - doanh nghiệp: doanh thu bán hàng / dịch vụ / hợp đồng xây dựng (thuyết minh)
//   - ngân hàng: thu nhập lãi thuần, dịch vụ, ngoại hối, chứng khoán, khác
//   - công ty chứng khoán: tự doanh, cho vay ký quỹ, môi giới, bảo lãnh, tư vấn, lưu ký…
//   - bảo hiểm: phí bảo hiểm thuần, hoạt động tài chính, ngân hàng, bất động sản đầu tư…
//
// Nhãn các dòng lấy từ chính `metrics` của Vietcap chứ không viết tay: mã trường đổi theo loại
// công ty, và một nhãn viết tay sai là một con số gắn nhầm tên mà không ai phát hiện.

export const VIETCAP = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/company';
const TIMEOUT_MS = 15000;
const BILLION = 1e9;

const PROFILES = {
  normal: {
    measure: 'doanh thu',
    section: 'NOTE',
    parent: 'noc102',
    totals: [['isa3', 'DT thuần'], ['isa5', 'LNG', true], ['isa20', 'LNST', true]],
  },
  bank: {
    measure: 'thu nhập hoạt động',
    section: 'INCOME_STATEMENT',
    fields: ['isb27', 'isb30', 'isb31', 'isb32', 'isb33', 'isb37', 'isb36'],
    totals: [['isb38', 'Tổng thu nhập HĐ'], ['isa16', 'LNTT', true], ['isa20', 'LNST', true]],
  },
  securities: {
    measure: 'doanh thu hoạt động',
    section: 'INCOME_STATEMENT',
    parent: 'isa1',
    totals: [['isa1', 'DT hoạt động'], ['isa5', 'LNG', true], ['isa20', 'LNST', true]],
  },
  insurance: {
    measure: 'doanh thu',
    section: 'INCOME_STATEMENT',
    fields: ['isi105', 'isi106', 'isa6', 'isi88', 'isi179', 'isi91'],
    totals: [['isi105', 'Phí BH thuần'], ['isi87', 'LNG bảo hiểm', true], ['isa20', 'LNST', true]],
  },
};

/// Loại công ty, đọc từ những mã trường mà báo cáo kết quả kinh doanh của nó có.
export function profileOf(metrics) {
  const fields = (metrics?.INCOME_STATEMENT ?? []).map((metric) => String(metric.field ?? '').toLowerCase());
  if (fields.some((field) => field.startsWith('isi'))) return 'insurance';
  if (fields.some((field) => field.startsWith('iss'))) return 'securities';
  if (fields.includes('isb27')) return 'bank';
  return 'normal';
}

/// Nhãn cho người đọc: bỏ ghi chú "(Trước năm 2016)", và chữ in hoa toàn bộ thành chữ thường.
function clean(title) {
  let text = String(title ?? '')
    .replace(/\s*\((?:trước|từ)\s+năm\s+\d{4}\)/giu, '')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
  if (text && text === text.toUpperCase()) text = text.toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Dòng số liệu của kỳ được hỏi, và dòng cùng kỳ năm trước.
 *
 * `quarters` là các kỳ quý (`lengthReport` 1–4), `years` là các năm (`lengthReport` 5). Không nói
 * năm thì lấy kỳ mới nhất khớp với điều được hỏi.
 */
export function pickPeriod(data, asked = {}) {
  const annual = Boolean(asked.annual);
  const rows = (annual ? data?.years : data?.quarters) ?? [];
  const matching = rows
    .filter((row) => (annual ? true : !asked.quarter || row.lengthReport === asked.quarter))
    .filter((row) => !asked.year || row.yearReport === asked.year)
    .sort((a, b) => b.yearReport - a.yearReport || b.lengthReport - a.lengthReport);
  const row = matching[0];
  if (!row) return null;
  const previous = rows.find((one) => one.yearReport === row.yearReport - 1 && one.lengthReport === row.lengthReport) ?? null;
  return { row, previous };
}

const billions = (value) => (Number.isFinite(value) ? value / BILLION : null);

/**
 * Báo cáo đã chuẩn hoá cho `resultsMessage`, từ ba câu trả lời của Vietcap. `null` khi không có kỳ nào khớp.
 */
export function vietcapReport(symbol, asked, { metrics, income, note }) {
  const kind = profileOf(metrics);
  const profile = PROFILES[kind];
  const titles = new Map();
  for (const section of ['NOTE', 'INCOME_STATEMENT']) {
    for (const metric of metrics?.[section] ?? []) titles.set(String(metric.field).toLowerCase(), clean(metric.titleVi));
  }

  const totalsAt = pickPeriod(income, asked);
  if (!totalsAt) return null;
  const { row, previous } = totalsAt;

  const sectionData = profile.section === 'NOTE' ? note : income;
  const segmentsAt = profile.section === 'NOTE'
    ? pickPeriod(sectionData, { ...asked, year: row.yearReport, quarter: asked.annual ? null : row.lengthReport })
    : totalsAt;

  const fields = profile.fields ?? (metrics?.[profile.section] ?? [])
    .filter((metric) => String(metric.parent ?? '').toLowerCase() === profile.parent && Number(metric.level) === 2)
    .map((metric) => String(metric.field).toLowerCase());

  const segments = segmentsAt
    ? fields
      .map((field) => ({
        name: titles.get(field) ?? field,
        value: billions(segmentsAt.row[field]),
        previous: billions(segmentsAt.previous?.[field]),
      }))
      .filter((segment) => Number.isFinite(segment.value) && Math.abs(segment.value) >= 0.5)
    : [];

  const totals = profile.totals
    .map(([field, label, margin]) => ({ label, value: billions(row[field]), previous: billions(previous?.[field]), margin: Boolean(margin) }))
    .filter((total) => Number.isFinite(total.value));

  // Ngày công bố đọc thẳng từ chuỗi: `2026-08-29T00:00:00` không kèm múi giờ, và để `Date` hiểu nó
  // theo giờ máy rồi đổi ra UTC là lùi mất một ngày ở Việt Nam.
  const published = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(row.publicDate ?? ''));
  const day = published ? `${published[3]}/${published[2]}/${published[1]}` : null;

  return {
    symbol: String(symbol).toUpperCase(),
    period: { year: row.yearReport, quarter: row.lengthReport >= 1 && row.lengthReport <= 4 ? row.lengthReport : null },
    unit: 'tỷ đồng',
    measure: profile.measure,
    kind,
    segments,
    totals,
    source: `Vietcap IQ${day ? ` · BCTC công bố ${day}` : ''}`,
  };
}

export function vietcapResults({ base = VIETCAP, fetchImpl = fetch, timeout = TIMEOUT_MS } = {}) {
  async function read(url) {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    if (response.status >= 400 && response.status < 500) return null;
    if (!response.ok) throw new Error(`Vietcap trả lời ${response.status}`);
    const answer = await response.json();
    return answer?.data ?? null;
  }

  return {
    async segments(symbol, asked) {
      const code = String(symbol ?? '').toUpperCase();
      const [metrics, income, note] = await Promise.all([
        read(`${base}/${code}/financial-statement/metrics`),
        read(`${base}/${code}/financial-statement?section=INCOME_STATEMENT`),
        read(`${base}/${code}/financial-statement?section=NOTE`),
      ]);
      if (!metrics || !income) return null;
      return vietcapReport(code, asked, { metrics, income, note });
    },
  };
}
