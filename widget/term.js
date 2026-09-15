// A card explaining one word, opened by tapping that word in a message.
//
//   data = { title, body, formula?, example? }
//
// Every field is put on the page as text, never as markup. The words come from the bot, but
// the bot is a program somebody wrote, and a card that ran what it was handed would be a way
// to draw a sign-in screen inside a conversation.
(function () {
  const card = document.getElementById('card');
  const title = document.getElementById('title');
  const body = document.getElementById('body');
  const formula = document.getElementById('formula');
  const example = document.getElementById('example');
  const exampleText = document.getElementById('example-text');

  // Thẻ mẫu, để mở file này riêng trong trình duyệt vẫn thấy một thẻ thật.
  const SAMPLE = {
    title: 'MA200 — trung bình 200 phiên',
    body: 'Giá đóng cửa trung bình của 200 phiên, gần một năm. Giá trên MA200 là xu hướng dài hạn đi lên, dưới MA200 là đi xuống.',
    formula: 'MA200 = tổng giá đóng cửa 200 phiên ÷ 200',
    example: 'MA20 > MA50 > MA200 → xu hướng tăng rõ',
  };

  // Cut short rather than refused. A popover with a paragraph too many is still a card; one
  // that shows nothing because a sentence ran long is a broken tap.
  const clip = (value, most) => (typeof value === 'string' ? value.trim().slice(0, most) : '');

  const valid = (data) =>
    Boolean(data) && typeof data === 'object' && clip(data.title, 120) !== '' && typeof data.body === 'string';

  function render(data, why) {
    card.classList.toggle('waiting', !data);

    if (!data) {
      title.textContent = why === 'invalid' ? 'Không mở được thẻ này' : '';
      body.textContent = why === 'invalid' ? 'Tin nhắn gửi kèm nội dung không đúng dạng.' : 'Đang mở…';
      formula.hidden = true;
      example.hidden = true;
    } else {
      title.textContent = clip(data.title, 120);
      body.textContent = clip(data.body, 1200);

      const math = clip(data.formula, 240);
      formula.textContent = math;
      formula.hidden = !math;

      const shown = clip(data.example, 400);
      exampleText.textContent = shown;
      example.hidden = !shown;
    }

    TermView.fit(card);
  }

  // The frame's width is the app's to choose, and a narrower one makes the same words taller.
  // So the height is asked for again whenever the card's own size moves, not only once.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => TermView.fit(card)).observe(card);
  }

  TermView.start({ sample: SAMPLE, valid, render });
})();
