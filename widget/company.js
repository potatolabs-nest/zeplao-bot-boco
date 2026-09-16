// A card about one listed company, opened by tapping its ticker in a message.
//
//   data = { title, subtitle?, rows: [[label, value], …], about?, source? }
//
// Every field is put on the page as text, never as markup — same rule as term.js, and it matters
// more here: the description this draws began life as HTML on a broker's website.
(function () {
  const card = document.getElementById('card');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const rows = document.getElementById('rows');
  const about = document.getElementById('about');
  const source = document.getElementById('source');
  const sourceText = document.getElementById('source-text');

  // Thẻ mẫu, để mở file này riêng trong trình duyệt vẫn thấy một thẻ thật.
  const SAMPLE = {
    title: 'VIC — Tập đoàn Vingroup - Công ty CP',
    subtitle: 'VinGroup Joint Stock Company',
    rows: [
      ['Sàn', 'HOSE'],
      ['Ngành', 'Bất động sản'],
      ['Vốn hoá', '1.873.016 tỷ đồng'],
      ['Cổ phiếu lưu hành', '7.762.186.429'],
      ['Room ngoại', '48%· đang nắm 3,15%'],
      ['52 tuần', '66,7 – 265'],
      ['Niêm yết', '19/09/2007'],
    ],
    about: 'Tập đoàn Vingroup - Công ty Cổ phần (VIC) có tiền thân là Công ty Technocom, thành lập năm 1993.',
    source: 'Vietcap IQ',
  };

  const clip = (value, most) => (typeof value === 'string' ? value.trim().slice(0, most) : '');

  const pairs = (data) => (Array.isArray(data?.rows) ? data.rows : [])
    .filter((row) => Array.isArray(row) && clip(row[0], 40) && clip(String(row[1] ?? ''), 80))
    .slice(0, 12);

  const valid = (data) =>
    Boolean(data) && typeof data === 'object' && clip(data.title, 140) !== '' && pairs(data).length > 0;

  function render(data, why) {
    card.classList.toggle('waiting', !data);

    if (!data) {
      title.textContent = why === 'invalid' ? 'Không mở được thẻ này' : '';
      subtitle.hidden = true;
      rows.replaceChildren();
      about.hidden = true;
      source.hidden = true;
      if (why === 'invalid') {
        about.textContent = 'Tin nhắn gửi kèm nội dung không đúng dạng.';
        about.hidden = false;
      }
      TermView.fit(card);
      return;
    }

    title.textContent = clip(data.title, 140);

    const second = clip(data.subtitle, 140);
    subtitle.textContent = second;
    subtitle.hidden = !second;

    // Dựng lại cả danh sách mỗi lần: một thẻ chỉ mở một lần với một bộ dữ liệu, nên không có gì
    // để giữ lại, và ghép thêm vào danh sách cũ là cách một thẻ mở lại hiện ra hai lần mỗi dòng.
    rows.replaceChildren();
    for (const [label, value] of pairs(data)) {
      const name = document.createElement('dt');
      name.textContent = clip(label, 40);
      const said = document.createElement('dd');
      said.textContent = clip(String(value), 80);
      rows.append(name, said);
    }

    const words = clip(data.about, 900);
    about.textContent = words;
    about.hidden = !words;

    const from = clip(data.source, 60);
    sourceText.textContent = from;
    source.hidden = !from;

    TermView.fit(card);
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => TermView.fit(card)).observe(card);
  }

  TermView.start({ sample: SAMPLE, valid, render });
})();
