// Bảng nhiệt sống: bot đẩy, trang vẽ.
//
// Trang này là trang của **phiên**, nên `z.onState` chạy mỗi lần bot gọi `pushState` — khác thẻ
// view, vốn nhận đúng một lần dữ liệu đi kèm tin nhắn rồi thôi. Trang không tự lấy dữ liệu ở đâu
// được: widget bị chặn mạng bằng header `connect-src 'none'`, và đó chính là chỗ hay của thiết kế
// này — một trăm người mở bảng vẫn chỉ là **một** lần bot tính và một lần đẩy.
//
//   state = { v, at, note, help, g: [[tên, x, y, w, h]], c: [[mã, x, y, w, h, "+2,17%", loại]], t: {…} }
//
// **Mỗi lần đẩy là cả bảng**, không phải phần vừa đổi. Máy chủ chỉ nhớ đúng gói cuối cùng và ghi
// đè chứ không gộp, nên nếu gói cuối là một nhúm ô vừa đổi thì người mở muộn nhận được đúng nhúm
// ấy và không có bảng nào cả. Toạ độ tính bằng phần nghìn để gói nhẹ; trang đổi ra phần trăm.
//
// Gói tới liên tục nhưng DOM chỉ dựng lại khi **bố cục** đổi (`v`). Giá thì sửa tại chỗ: dựng lại
// cả bảng mỗi nhịp là cách làm chữ nhấp nháy và mất chỗ người ta đang nhìn.
(function () {
  /// Đánh số tay, tăng mỗi lần gói đổi. Phiên ghim phiên bản gói lúc được tạo, nên một cái bảng
  /// đang mở có thể là gói của hôm qua — và nhìn vào nó thì không cách nào biết.
  const BUILD = 9;

  const z = window.Zeplao;
  const map = document.getElementById('map');
  const wrap = document.getElementById('wrap');
  const legend = document.getElementById('legend');
  const clock = document.getElementById('clock');
  const help = document.getElementById('help');
  const build = document.getElementById('build');
  const finder = document.getElementById('find');
  const finderBox = document.getElementById('find-box');
  if (build) build.textContent = `b${BUILD}`;

  const back = document.getElementById('back');
  const sheet = document.getElementById('sheet');
  const paper = {
    code: document.getElementById('s-code'),
    price: document.getElementById('s-price'),
    move: document.getElementById('s-move'),
    name: document.getElementById('s-name'),
    where: document.getElementById('s-where'),
    head: document.getElementById('s-head'),
    stats: document.getElementById('s-stats'),
    today: document.getElementById('s-today'),
    firm: document.getElementById('s-firm'),
    days: document.getElementById('s-days'),
    daysTitle: document.getElementById('s-days-title'),
    all: document.getElementById('s-all'),
    ptkt: document.getElementById('s-ptkt'),
    wait: document.getElementById('s-tk-wait'),
    tk: document.getElementById('s-tk'),
    verdict: document.getElementById('s-tk-verdict'),
    conf: document.getElementById('s-tk-conf'),
    chart: document.getElementById('s-tk-chart'),
    key: document.getElementById('s-tk-key'),
    steps: document.getElementById('s-tk-steps'),
    plan: document.getElementById('s-tk-plan'),
    about: document.getElementById('s-about'),
  };

  const cells = new Map();   // mã -> { box, percent }
  const titles = [];         // tên nhóm, đo lại mỗi lần khung đổi
  let version = null;        // bố cục đang hiện là của gói nào
  let zoomed = null;         // **tên** nhóm đang xem riêng, null là cả bảng
  let opened = null;         // mã đang mở trang chi tiết, null là đang xem bản đồ
  let tab = 'all';           // tab đang mở trong trang chi tiết: 'all' hoặc 'ptkt'
  let last = null;           // gói gần nhất, để vẽ lại khi đổi qua lại giữa hai cách xem

  const LEAST_LABEL = 7;
  const MOST_LABEL = 30;
  const ASK_AGAIN_MS = 2500;
  let asked = 0;            // lần gần nhất xin bot hồ sơ, để khỏi hỏi dồn
  let studied = 0;          // lần gần nhất xin bài phân tích kỹ thuật
  let openedAt = 0;         // lúc mở trang chi tiết, để biết khi nào thì thôi chờ
  const GIVE_UP_MS = 6000;
  let seated = false;       // đã dựng lại chỗ ngồi cũ chưa
  let sits = 0;             // đã thử dựng lại mấy lần
  const SEAT_MS = 400;
  const SIT_TRIES = 6;
  const SVG = 'http://www.w3.org/2000/svg';
  const HELLO_AGAIN_MS = 4000;
  const HELLO_TRIES = 5;
  const KINDS = ['up', 'down', 'flat', 'ceiling', 'floor'];

  /**
   * Đặt một khối theo toạ độ phần nghìn, chừa khe bằng **pixel thật**.
   *
   * Khe tính theo tỉ lệ thì ở khung nhỏ nó biến mất: một phần nghìn của bản đồ rộng 700px là 0,7
   * pixel, và các ô dính liền thành một mảng — nhìn đúng như chúng đè lên nhau. Một pixel mỗi bên
   * thì ở khung nào cũng là một pixel.
   */
  const at = (box, x, y, w, h, gap = 0) => {
    box.style.left = `calc(${x / 10}% + ${gap}px)`;
    box.style.top = `calc(${y / 10}% + ${gap}px)`;
    box.style.width = `calc(${w / 10}% - ${gap * 2}px)`;
    box.style.height = `calc(${h / 10}% - ${gap * 2}px)`;
  };

  function draw(state) {
    version = state.v ?? null;
    back.hidden = true;
    map.replaceChildren();
    cells.clear();
    titles.length = 0;

    for (const [index, [name, x, y, w, h, header]] of (state.g ?? []).entries()) {
      const box = document.createElement('div');
      box.className = 'group';
      at(box, x, y, w, h);

      const title = document.createElement('h2');
      title.textContent = name;
      // Chiều cao dải tiêu đề tính ở `fit()`, **không** tính ở đây: lúc dựng DOM thì khung bảng có
      // thể còn chưa có chiều cao thật — card đang được đổi cỡ — và đo lúc ấy ra 0. Đó chính là
      // cách tôi vừa làm mất sạch tên nhóm: 0 pixel thì nhóm nào cũng "quá bé để ghi tên".
      title.dataset.strip = String(header ?? 30);
      title.addEventListener('click', () => zoom(index));
      box.append(title);
      titles.push(title);
      map.append(box);
    }

    for (const [symbol, x, y, w, h, shown, kind] of state.c ?? []) {
      const box = tile(symbol, shown, kind);
      at(box, x, y, w, h, 1);
      map.append(box);
    }

    fit();
  }

  /// Một ô: mã, phần trăm, màu, và bấm được để mở trang chi tiết. Cả bảng lẫn bảng phóng to đều
  /// dựng ô bằng đây, nên một ô ở hai chỗ không bao giờ khác nhau.
  function tile(symbol, shown, kind) {
    const box = document.createElement('div');
    box.className = `cell ${KINDS[kind] ?? 'flat'}`;

    const name = document.createElement('b');
    name.textContent = symbol;
    const percent = document.createElement('span');
    percent.textContent = shown;
    box.append(name, percent);
    box.addEventListener('click', () => open(symbol));

    cells.set(symbol, { box, percent });
    return box;
  }

  /// Bảng cũ, giá mới: chỉ sờ vào ô có số khác đi.
  function move(state) {
    for (const [symbol, , , , , shown, kind] of state.c ?? []) {
      const cell = cells.get(symbol);
      if (!cell) continue;
      if (cell.percent.textContent !== shown) cell.percent.textContent = shown;
      const want = `cell ${KINDS[kind] ?? 'flat'}${cell.box.classList.contains('hush') ? ' hush' : ''}`;
      if (cell.box.className !== want) cell.box.className = want;
    }
  }

  /**
   * Cỡ chữ tính theo kích thước thật của ô, không theo con số bot gửi.
   *
   * Cùng luật với bản đồ SVG — hai dòng không quá nửa chiều cao ô — nhưng ở đây ô co giãn theo cửa
   * sổ, nên phải tính lại mỗi lần đổi cỡ. Ô không đủ chỗ thì giấu chữ và giữ màu: một ô trống vẫn
   * đọc được màu, còn một ô đặc chữ thì không đọc được gì.
   */
  function fit() {
    // Bản đồ là chữ nhật 16:9 lớn nhất lọt vào chỗ còn trống, đo bằng pixel thật của khung bọc.
    // Trang chi tiết nhận đúng cái khung ấy: bấm vào một ô không được làm cả tấm card nhảy cỡ.
    const room = wrap.getBoundingClientRect();
    if (room.width > 0 && room.height > 0) {
      const wide = Math.floor(Math.min(room.width, (room.height * 16) / 9));
      map.style.width = `${wide}px`;
      map.style.height = `${Math.floor((wide * 9) / 16)}px`;

      // Trang chi tiết lấy **cả khung**, không theo 16:9. Luật 16:9 sinh ra cho treemap — nhét nó
      // vào khung cao và hẹp thì các ô thành cột dựng đứng. Một trang chữ và bảng thì ngược lại:
      // càng cao càng đỡ phải kéo, mà kéo trong một cái card nổi là việc khó chịu.
      sheet.style.width = `${Math.floor(room.width)}px`;
      sheet.style.height = `${Math.floor(room.height)}px`;
      // Chữ trên trang chi tiết co theo khung như chữ trong các ô, nhưng có sàn và có trần: một
      // bảng mở trên điện thoại mà chữ 7px thì không ai đọc, còn trên màn hình rộng thì chữ 30px
      // làm trang chỉ còn vừa ba dòng.
      sheet.style.fontSize = `${Math.max(10, Math.min(wide / 46, 17))}px`;
    }

    // Nút quay lại bám góc **trang đang hiện**, không bám góc khung bọc: trang căn giữa, nên ở cửa
    // sổ rộng hai bên còn thừa chỗ và một nút dính mép trái sẽ nằm chơ vơ ngoài bảng.
    const face = opened === null ? map : sheet;
    back.style.left = `${face.offsetLeft + 6}px`;
    back.style.top = `${face.offsetTop + 5}px`;
    // Dòng đầu của trang chi tiết lùi vào đúng bề ngang cái nút — nó nằm đè lên trang, và bề ngang
    // ấy đổi theo tên in trên mặt nút.
    paper.head.style.paddingLeft = opened === null ? '' : `${back.offsetWidth + 10}px`;
    // Chart vẽ bằng pixel thật, nên đổi cỡ khung là phải vẽ lại — không có cách nào để nó tự co mà
    // không bẹt chữ, và bẹt chữ chính là thứ vừa phải sửa.
    if (drawn_ && opened !== null && tab === 'ptkt' && paper.chart.clientWidth > 0) {
      paper.chart.replaceChildren(sketch(drawn_));
    }

    // Dải tên nhóm: cao đúng bằng khoảng bot đã chừa, và biến mất khi khoảng ấy hẹp quá — chữ nhỏ
    // nhất vẫn tràn ra và đè sang nhóm bên cạnh, mà một nhóm không tên vẫn nhận ra qua các mã.
    for (const title of titles) {
      const strip = (Number(title.dataset.strip) / 1000) * map.clientHeight;
      title.hidden = strip < 9;
      title.style.height = `${strip}px`;
      title.style.lineHeight = `${strip}px`;
      title.style.fontSize = `${Math.max(8, Math.min(strip * 0.62, 13))}px`;
    }

    for (const { box } of cells.values()) {
      const size = Math.min(box.clientWidth / 4.3, box.clientHeight / 3.6, MOST_LABEL);
      box.classList.toggle('hush', size < LEAST_LABEL);
      box.style.fontSize = `${Math.max(size, LEAST_LABEL)}px`;
    }
  }

  /**
   * Xem riêng một ngành: chỉ các mã của nhóm ấy, chia lại cho kín cả khung.
   *
   * Bố cục này do **trang** tính, không phải bot. Một lần `pushState` tới hết mọi người đang mở
   * bảng của phòng, nên nếu bot dựng bố cục phóng to thì một người bấm là cả phòng bị kéo theo.
   * Bot chỉ gửi kèm nhóm và tiền giao dịch của từng mã; chia ô thì cùng một thuật toán, ở đây.
   */
  function drawOne(state) {
    const place = placeOf(state);
    // Nhóm biến mất khỏi gói — hết mã, hoặc bot đổi cách xếp ngành. Về cả bảng còn hơn một khung trắng.
    if (place < 0) { zoomed = null; draw(state); return; }

    version = state.v ?? null;
    map.replaceChildren();
    cells.clear();
    titles.length = 0;

    const mine = (state.c ?? []).filter((cell) => cell[7] === place);
    for (const { one, ...box } of treemap(mine.map((cell) => ({ cell, v: cell[8] ?? 1 })), { x: 0, y: 0, w: 1000, h: 1000 })) {
      const [symbol, , , , , shown, kind] = one.cell;
      const drawn = tile(symbol, shown, kind);
      at(drawn, box.x, box.y, box.w, box.h, 1);
      map.append(drawn);
    }

    back.hidden = false;
    // Nút ghi chỗ nó **dẫn tới**, không ghi chỗ đang đứng: "← Ngân hàng" trên một bảng toàn mã ngân
    // hàng thì bấm vào lại tưởng ra chỗ khác. Tên ngành đang xem nằm dưới hàng chú giải.
    back.textContent = '← Tất cả';
    fit();
  }

  /**
   * Nhóm đang xem riêng nằm ở chỗ nào trong gói này.
   *
   * Bám theo **tên**, không theo số thứ tự đã bấm: bot xếp nhóm theo tiền giao dịch, nên chỗ thứ ba
   * nhịp này có thể là ngành khác ở nhịp sau — nhớ số thì đang xem ngân hàng bỗng nhảy sang thép.
   */
  const placeOf = (state) => (state.g ?? []).findIndex((group) => group[0] === zoomed);

  /// Chia ô theo tiền giao dịch — cùng thuật toán bot dùng, để bảng phóng to nhìn ra cùng một kiểu.
  function treemap(items, rect) {
    const total = items.reduce((sum, one) => sum + Math.max(0, one.v), 0);
    if (!items.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
    if (items.length === 1) return [{ one: items[0], ...rect }];

    const sorted = [...items].sort((a, b) => b.v - a.v);
    const half = total / 2;
    let taken = sorted[0].v;
    let split = 1;
    while (split < sorted.length - 1) {
      const next = taken + sorted[split].v;
      if (Math.abs(half - taken) < Math.abs(half - next)) break;
      taken = next;
      split += 1;
    }
    const ratio = taken / total;
    const first = sorted.slice(0, split);
    const rest = sorted.slice(split);

    if (rect.w >= rect.h) {
      const wide = rect.w * ratio;
      return [
        ...treemap(first, { ...rect, w: wide }),
        ...treemap(rest, { x: rect.x + wide, y: rect.y, w: rect.w - wide, h: rect.h }),
      ];
    }
    const tall = rect.h * ratio;
    return [
      ...treemap(first, { ...rect, h: tall }),
      ...treemap(rest, { x: rect.x, y: rect.y + tall, w: rect.w, h: rect.h - tall }),
    ];
  }

  function zoom(index) {
    if (!last) return;
    const name = (last.g?.[index] ?? [])[0];
    if (!name) return;
    zoomed = name;
    drawOne(last);
    count(last);
    seat();
  }

  /**
   * Trang chi tiết một mã.
   *
   * Mở ngay bằng thứ trang đang có — mã, phần trăm, màu — rồi xin bot phần còn lại. Đợi gói mới rồi
   * mới mở thì bấm xong phải nhìn bảng cũ thêm một nhịp, và người bấm sẽ tưởng cú bấm không ăn.
   */
  function open(symbol) {
    if (!last || opened === symbol) return;
    opened = symbol;
    // Mã mới thì về tab đầu: người bấm vào một ô màu đang hỏi "mã này là gì", chưa hỏi "nên mua chưa".
    tab = 'all';
    showTab();
    // Bản đồ biến mất khỏi DOM: các ô không còn thì `move()` cũng không còn gì để sửa, và lúc quay
    // lại bảng được dựng lại từ gói mới nhất chứ không phải từ cái khung đã đứng im suốt lúc ấy.
    map.hidden = true;
    sheet.hidden = false;
    cells.clear();
    version = null;
    asked = 0;
    openedAt = Date.now();
    paint(last);
    ask(symbol);
    seat();
    fitRoom();   // card cao lên ngay, không đợi nhịp đẩy sau
  }

  /**
   * Xin bot hồ sơ của một mã, nhiều nhất mỗi vài giây một lần.
   *
   * Hỏi lại là có lý do: gói đẩy đi là gói chung cả phòng, nên một người khác đóng trang chi tiết
   * của đúng mã này sẽ kéo nó ra khỏi gói, và người còn lại ngồi nhìn "đang lấy hồ sơ" mãi. Một câu
   * hỏi lại mỗi hai giây rưỡi thì tự lành, và cũng lành luôn cả lần hỏi đầu tiên bị rơi.
   */
  function ask(symbol) {
    if (!z || typeof z.send !== 'function') return;
    const now = Date.now();
    if (now - asked < ASK_AGAIN_MS) return;
    asked = now;
    try { z.send({ open: symbol }); } catch { /* không xin được thì trang vẫn mở, chỉ thiếu hồ sơ */ }
  }

  /// Rời trang chi tiết, về đúng chỗ vừa rời đi — cả bảng hay một ngành, tuỳ lúc bấm vào ô là đang
  /// đứng ở đâu. `zoomed` không bị đụng tới lúc mở, nên nó chính là cái chỗ ấy.
  function shut() {
    // Nói với bot rằng chỗ này thôi xem: gói đẩy cho phòng mang theo hồ sơ của mọi mã đang mở, và
    // giữ lại một mã không ai còn nhìn là bắt cả phòng tải nó mỗi ba giây.
    if (opened !== null && z && typeof z.send === 'function') {
      try { z.send({ shut: opened }); } catch { /* không nói được thì bot tự bỏ khi quá sáu mã */ }
    }
    opened = null;
    sheet.hidden = true;
    map.hidden = false;
    fitRoom();   // và thu lại đúng khung của bản đồ
    if (!last) return;
    if (zoomed === null) draw(last);
    else drawOne(last);
    count(last);
    seat();
  }

  back.addEventListener('click', () => {
    if (opened !== null) { shut(); return; }
    zoomed = null;
    if (!last) return;
    draw(last);
    count(last);
    seat();
  });

  /**
   * Vẽ trang chi tiết bằng gói mới nhất.
   *
   * Chạy lại mỗi nhịp đẩy, nên khối lượng và giá trị giao dịch trên trang này sống y như các ô màu
   * phía sau nó. Phần hồ sơ công ty thì tới muộn một nhịp — bot phải hỏi nguồn — và trang nói rõ nó
   * đang đợi, chứ không để một khoảng trống mà người xem không biết là thiếu hay là hỏng.
   */
  function paint(state) {
    const cell = (state.c ?? []).find(([symbol]) => symbol === opened);
    const detail = state.d?.[opened] ?? null;
    const kind = KINDS[cell?.[6]] ?? 'flat';

    if (!detail) ask(opened);

    paper.code.textContent = opened;
    paper.price.textContent = detail?.p ?? '';
    paper.price.className = kind;
    paper.move.textContent = [cell?.[5], detail?.d && `(${detail.d})`].filter(Boolean).join('  ');
    paper.move.className = kind;

    // Tên đi sẵn trong gói cho những mã bot đã hâm hồ sơ, nên bấm vào ô là có tên ngay — không đợi
    // một vòng hỏi đáp chỉ để lấy một chuỗi chữ.
    // Ba câu cho ba tình huống, và câu thứ ba là câu quan trọng nhất: gõ nhầm một mã không có thật
    // thì phải được nói ra, chứ không để cái trang quay mãi như đang bận.
    const late = !detail && Date.now() - openedAt > GIVE_UP_MS;
    paper.name.textContent = detail?.n || state.n?.[opened]
      || (detail?.f === 0 ? 'Không có hồ sơ công ty' : late ? 'Không tìm thấy mã này' : 'Đang lấy hồ sơ…');
    // Ngành và giá trị giao dịch có sẵn ngay trên chính ô vừa bấm — tên nhóm nó nằm trong, và tiền
    // giao dịch mà bảng dùng để chia ô. Lấp bằng chúng trong lúc chờ gói: một trang trống trơn suốt
    // một vòng hỏi đáp trông như bấm hụt, dù thật ra nó đang chạy đúng.
    paper.where.textContent = detail?.w || (cell ? (state.g?.[cell[7]] ?? [])[0] ?? '' : '');

    // Ba con số to: khối lượng và giá trị hôm nay, rồi khối lượng bình quân mười phiên — cái thứ ba
    // là thước đo của hai cái đầu, và để nó nằm ở chân một cái bảng phải cuộn mới tới là chôn nó.
    const today = detail?.q ?? [['Khối lượng', '…'], ['Giá trị', cell ? `${dot(cell[8])} tỷ` : '…']];
    const tiles = [...today.slice(0, 2), ...(detail?.hb ? [detail.hb] : [])];
    paper.stats.replaceChildren(...tiles.map(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'stat';
      const name = document.createElement('span');
      name.textContent = label;
      const shown = document.createElement('b');
      shown.textContent = value;
      box.append(name, shown);
      return box;
    }));

    rows(paper.today, today.slice(2));
    rows(paper.firm, detail?.r ?? []);
    history(detail);
    paper.about.textContent = detail?.a ?? '';

    if (tab === 'ptkt') {
      technical(detail);
      if (!detail?.tk) study(opened);
    }

    back.hidden = false;
    back.textContent = `← ${zoomed ?? 'Bản đồ'}`;
    fit();
  }

  /**
   * Bảng mười phiên gần nhất, và khối lượng bình quân ở chân bảng.
   *
   * Bảng vắng mặt khi nguồn nến không trả lời — không dựng một cái khung rỗng có tiêu đề: một bảng
   * năm cột trống trông như số liệu hỏng, còn không có bảng thì chỉ là không có bảng.
   */
  function history(detail) {
    const days = detail?.h ?? [];
    paper.days.replaceChildren();
    // Tiêu đề đi cùng bảng, không đứng lại một mình: một dòng "10 phiên gần nhất" trên khoảng trống
    // là một lời hứa không có gì phía sau.
    paper.daysTitle.hidden = !days.length;
    if (!days.length) return;

    // Hai cột khối ngoại chỉ hiện khi nguồn có trả lời: một cột rỗng suốt mười dòng trông như số
    // liệu hỏng, trong khi sự thật chỉ là nguồn kia không nói.
    const hasForeign = days.some(([, , , , , , buy]) => buy);
    const head = document.createElement('tr');
    for (const label of ['Ngày', 'Giá', 'Thay đổi', 'Khối lượng', 'Giá trị', ...(hasForeign ? ['NN mua', 'NN bán'] : [])]) {
      const cell = document.createElement('th');
      cell.textContent = label;
      head.append(cell);
    }
    paper.days.append(head);

    for (const [day, close, percent, volume, value, way, buy, sell] of days) {
      const line = document.createElement('tr');
      const cells = [day, close, percent, volume, value, ...(hasForeign ? [buy, sell] : [])];
      for (const [index, shown] of cells.entries()) {
        const cell = document.createElement('td');
        cell.textContent = shown;
        // Cột giá và cột thay đổi ăn màu theo phiên; hai cột khối ngoại ăn màu theo chiều của chính
        // chúng — mua là mua, dù hôm ấy giá có giảm. Tô cả dòng thì bảng thành một mảng xanh đỏ và
        // không còn đọc được cột nào.
        if (index === 1 || index === 2) cell.className = way > 0 ? 'up' : way < 0 ? 'down' : '';
        if (index === 5) cell.className = 'up';
        if (index === 6) cell.className = 'down';
        line.append(cell);
      }
      paper.days.append(line);
    }
  }

  /// Đổi tab: chỉ đổi cái gì hiện ra, không đụng tới mã đang mở.
  function showTab() {
    for (const button of document.querySelectorAll('#s-tabs .tab')) {
      button.classList.toggle('on', button.dataset.tab === tab);
    }
    paper.all.hidden = tab !== 'all';
    paper.ptkt.hidden = tab !== 'ptkt';
  }

  /**
   * Tìm một mã bằng cách gõ tên nó.
   *
   * Bảng chỉ bày ra hai trăm sáu mươi ô to nhất, mà sàn có hơn một nghìn năm trăm mã — phần còn lại
   * không có cách nào bấm tới. Ô này là cách ấy.
   */
  finder?.addEventListener('submit', (event) => {
    event.preventDefault();
    const symbol = String(finderBox.value ?? '').trim().toUpperCase();
    finderBox.value = '';
    // Trả bàn phím lại cho màn hình: trên điện thoại nó che mất nửa cái card vừa mở ra.
    finderBox.blur();
    if (!/^[A-Z0-9]{3,10}$/.test(symbol)) return;
    if (opened === symbol) return;
    opened = null;          // để `open` chịu mở lại khi đang đứng ở một mã khác
    open(symbol);
  });

  for (const button of document.querySelectorAll('#s-tabs .tab')) {
    button.addEventListener('click', () => {
      tab = button.dataset.tab;
      showTab();
      seat();
      if (last) paint(last);
      // Bài phân tích chỉ được tính khi có người mở tab ấy ra. Xin ngay lúc bấm, và `paint` xin lại
      // nếu gói về vẫn chưa có — cùng lối với hồ sơ công ty.
      if (tab === 'ptkt') study(opened);
    });
  }

  /// Xin bot bài phân tích kỹ thuật của một mã, thưa thớt như xin hồ sơ.
  function study(symbol) {
    if (!symbol || !z || typeof z.send !== 'function') return;
    const now = Date.now();
    if (now - studied < ASK_AGAIN_MS) return;
    studied = now;
    try { z.send({ ptkt: symbol }); } catch { /* không xin được thì tab ấy báo đang đợi */ }
  }

  /**
   * Tab phân tích kỹ thuật: kết luận, chart, các tín hiệu, rồi kế hoạch giá.
   *
   * Chart do trang tự vẽ từ chuỗi giá bot gửi, không phải một cái ảnh SVG đúc sẵn: ảnh đúc sẵn có
   * nền sáng cố định, mà widget chạy trong nền tối hay sáng là tuỳ người xem.
   */
  function technical(detail) {
    const card = detail?.tk ?? null;
    // Ba trạng thái, ba câu khác nhau: đang tính, tính rồi mà không phân tích được, và có bài.
    const ready = Boolean(card && !card.none);
    paper.tk.hidden = !ready;
    paper.wait.hidden = ready;
    if (!ready) {
      paper.wait.textContent = card?.none || 'Đang phân tích…';
      return;
    }

    paper.verdict.textContent = card.verdict;
    paper.verdict.className = card.kind ?? '';
    paper.conf.textContent = [
      `tin cậy ${card.confidence}`,
      card.reason,
      `phiên ${card.day}${card.live ? ' (đang giao dịch)' : ''}`,
      card.ms ? `tính trong ${card.ms}ms` : '',
    ].filter(Boolean).join(' · ');

    paper.steps.replaceChildren(...(card.steps ?? []).map(([text, score]) => {
      const line = document.createElement('li');
      line.textContent = text;
      line.className = score > 0 ? 'up' : score < 0 ? 'down' : '';
      return line;
    }));

    paper.plan.replaceChildren(...[
      ...(card.plan ?? []),
      `Hỗ trợ: ${(card.zones?.supports ?? []).join(' · ')}`,
      `Kháng cự: ${(card.zones?.resistances ?? []).join(' · ')}`,
    ].map((text) => {
      const line = document.createElement('div');
      line.textContent = text;
      return line;
    }));

    drawn_ = card.chart;
    paper.chart.replaceChildren(sketch(card.chart));
    legendFor(card.chart);
  }

  /**
   * Chú giải cho chart: đường nào là đường nào.
   *
   * Không có nó thì trong hình có ba đường và hai vạch đứt, không cái nào mang tên — người xem phải
   * đoán, và đoán sai thì đọc ngược cả bức tranh. Dựng bằng HTML chứ không vẽ trong SVG: chữ nét
   * hơn, và nó tự xuống hàng khi khung hẹp.
   */
  function legendFor(chart) {
    const items = [
      ['rise', 'Phiên tăng', ''],
      ['fall', 'Phiên giảm', ''],
      ['line', 'MA20', 'var(--ma20)'],
      ['line', 'MA50', 'var(--ma50)'],
      ['dash', `Hỗ trợ ${vi(chart.support)}`, 'var(--up-r, var(--up))'],
      ['dash', `Kháng cự ${vi(chart.resistance)}`, 'var(--down-r, var(--down))'],
    ].filter(([, label]) => !/(NaN|undefined)/.test(label));

    paper.key.replaceChildren(...items.map(([kind, label, colour]) => {
      const box = document.createElement('span');
      box.className = 'key';
      if (colour) box.style.color = colour;
      const mark = document.createElement('i');
      mark.className = kind;
      const text = document.createElement('span');
      text.textContent = label;
      box.append(mark, text);
      return box;
    }));
  }

  /// Chart vừa vẽ, giữ lại để vẽ lại khi khung đổi cỡ — nó tính theo pixel thật nên không tự co.
  let drawn_ = null;

  /**
   * Chart giá ba tháng: nến, hai đường trung bình, khối lượng, lưới giá và hai mức hỗ trợ/kháng cự.
   *
   * Vẽ theo **pixel thật** của khung chứ không vẽ vào một `viewBox` cố định rồi kéo giãn: kéo giãn
   * thì nét dọc mảnh đi, nét ngang dày lên và chữ bị bẹt ngang — cái chart trông như bị ai ngồi lên.
   * Một đơn vị SVG ở đây là một pixel, nên hình vẽ ra sao là đúng như thế.
   */
  function sketch(chart) {
    const wide = Math.max(240, Math.round(paper.chart.clientWidth || 320));
    const RIGHT = 48;                        // chỗ cho thang giá bên phải
    const PRICE = { top: 10, bottom: 128 };
    const VOLUME = { top: 140, bottom: 166 };
    const HIGH = 182;

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${wide} ${HIGH}`);
    svg.setAttribute('width', wide);
    svg.setAttribute('height', HIGH);

    const closes = chart?.close ?? [];
    if (closes.length < 2) return svg;

    const add = (name, attrs, styles) => {
      const node = document.createElementNS(SVG, name);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (styles) Object.assign(node.style, styles);
      svg.append(node);
      return node;
    };

    // Thang giá bám theo nến và hai đường trung bình, cộng hai mức hỗ trợ/kháng cự — chúng là lý do
    // người ta nhìn cái chart này, nên để chúng rơi ra ngoài khung thì vẽ cũng bằng thừa.
    const marks = [chart.support, chart.resistance].filter(Number.isFinite);
    const spread = [
      ...(chart.high ?? closes), ...(chart.low ?? closes), ...closes,
      ...(chart.ma20 ?? []), ...(chart.ma50 ?? []), ...marks,
    ].filter(Number.isFinite);
    const low = Math.min(...spread);
    const high = Math.max(...spread);
    const span = high - low || 1;

    const slot = (wide - RIGHT) / closes.length;
    const bar = Math.max(1.5, slot * 0.6);
    const mid = (index) => slot * (index + 0.5);
    const y = (value) => PRICE.top + ((high - value) / span) * (PRICE.bottom - PRICE.top);

    // Lưới ngang và thang giá: bốn mức, đủ để đọc một con số mà không thành cái lồng chim.
    for (let step = 0; step <= 3; step += 1) {
      const value = low + (span * step) / 3;
      add('line', { x1: 0, x2: wide - RIGHT, y1: y(value), y2: y(value) }, { stroke: 'var(--line)', strokeWidth: '1' });
      add('text', { x: wide - RIGHT + 4, y: y(value) + 3, 'font-size': '9' }, { fill: 'var(--muted)' })
        .textContent = vi(value);
    }

    for (const [value, label, colour] of [[chart.support, 'HT', 'var(--up)'], [chart.resistance, 'KC', 'var(--down)']]) {
      if (!Number.isFinite(value)) continue;
      add('line', { x1: 0, x2: wide - RIGHT, y1: y(value), y2: y(value) },
        { stroke: colour, strokeWidth: '1', strokeDasharray: '4 3', opacity: '0.8' });
      add('text', { x: wide - RIGHT + 4, y: y(value) - 4, 'font-size': '9', 'font-weight': '700' }, { fill: colour })
        .textContent = `${label} ${vi(value)}`;
    }

    // Nến: phiên tăng thì thân rỗng, phiên giảm thì thân đặc — cùng lối với hình của `!ptkt`.
    const mostVolume = Math.max(1, ...(chart.volume ?? [0]));
    for (let index = 0; index < closes.length; index += 1) {
      const open = chart.open?.[index] ?? closes[index];
      const close = closes[index];
      const top = chart.high?.[index] ?? Math.max(open, close);
      const bottom = chart.low?.[index] ?? Math.min(open, close);
      const rising = close >= open;
      const colour = rising ? 'var(--up-r, var(--up))' : 'var(--down-r, var(--down))';
      const x = mid(index);

      add('line', { x1: x, x2: x, y1: y(top), y2: y(bottom) }, { stroke: colour, strokeWidth: '1' });
      const bodyTop = y(Math.max(open, close));
      const bodyHigh = Math.max(1, y(Math.min(open, close)) - bodyTop);
      add('rect', { x: x - bar / 2, y: bodyTop, width: bar, height: bodyHigh },
        rising
          ? { fill: 'var(--panel)', stroke: colour, strokeWidth: '1' }
          : { fill: colour });

      // Khối lượng ngay dưới, cùng màu với phiên: hai dải đọc cùng một nhịp thì mắt nối được chúng.
      const tall = ((chart.volume?.[index] ?? 0) / mostVolume) * (VOLUME.bottom - VOLUME.top);
      add('rect', { x: x - bar / 2, y: VOLUME.bottom - tall, width: bar, height: Math.max(0.5, tall) },
        { fill: colour, opacity: '0.55' });
    }

    // Hai đường trung bình vẽ sau cùng, đè lên nến.
    for (const [values, colour, thick] of [[chart.ma50, 'var(--ma50)', 1.3], [chart.ma20, 'var(--ma20)', 1.3]]) {
      const points = (values ?? [])
        .map((value, index) => (Number.isFinite(value) ? `${mid(index).toFixed(1)},${y(value).toFixed(1)}` : null))
        .filter(Boolean)
        .join(' ');
      if (points) add('polyline', { points, fill: 'none' }, { stroke: colour, strokeWidth: String(thick) });
    }

    add('text', { x: 0, y: HIGH - 3, 'font-size': '9' }, { fill: 'var(--muted)' }).textContent = chart.first ?? '';
    add('text', { x: wide - RIGHT, y: HIGH - 3, 'font-size': '9', 'text-anchor': 'end' }, { fill: 'var(--muted)' })
      .textContent = chart.last ?? '';
    add('text', { x: 0, y: VOLUME.top - 3, 'font-size': '9' }, { fill: 'var(--muted)' }).textContent = 'Khối lượng';
    return svg;
  }

  /// Số có dấu chấm ngăn nghìn, kiểu Việt Nam. Trang không gọi được `Intl` của bot, mà một con số
  /// bảy chữ số liền nhau thì đọc ra được đúng một điều: "nhiều".
  const dot = (value) => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /// Giá: giữ phần thập phân, và dấu phẩy là dấu thập phân — "241,2", không phải "241.2".
  const vi = (value) => String(Math.round(Number(value) * 100) / 100).replace('.', ',');

  /// Một cột nhãn — giá trị. Dòng nào nguồn không có thì không có dòng đó: một dòng "Vốn hoá: —"
  /// trông như số liệu hỏng, trong khi sự thật chỉ là nguồn không nói.
  function rows(into, pairs) {
    into.replaceChildren();
    for (const [label, value] of pairs) {
      const name = document.createElement('dt');
      name.textContent = label;
      const shown = document.createElement('dd');
      shown.textContent = value;
      // Giá trị dài — tên một ngành chẳng hạn — thì xuống hàng bên trái thay vì dóng phải: dóng
      // phải một câu ba dòng thì mắt không tìm ra chỗ bắt đầu.
      if (String(value).length > 18) shown.className = 'wrap';
      into.append(name, shown);
    }
  }

  /**
   * Hàng chú giải đếm đúng thứ đang hiện trên bảng.
   *
   * Xem riêng ngân hàng mà dưới chân vẫn ghi "165 tăng" của cả sàn thì hai con số cạnh nhau nói hai
   * chuyện khác nhau, và người đọc tin con số hơn tin cái bảng.
   */
  function count(state) {
    const tally = {};
    let mine = 0;
    if (zoomed === null) Object.assign(tally, state.t ?? {});
    else {
      const place = placeOf(state);
      for (const cell of state.c ?? []) {
        if (cell[7] !== place) continue;
        const kind = KINDS[cell[6]] ?? 'flat';
        tally[kind] = (tally[kind] ?? 0) + 1;
        mine += 1;
      }
    }
    for (const kind of KINDS) {
      const shown = document.getElementById(`n-${kind}`);
      if (shown) shown.textContent = String(tally[kind] ?? 0);
    }

    // Chỗ của câu hướng dẫn cũng là chỗ nói đang xem riêng ngành nào: hàng chú giải chỉ có một
    // dòng, và tên ngành thì cần hơn một câu hướng dẫn mà lúc ấy không ai đọc.
    help.textContent = zoomed === null ? (state.help ?? '') : `${zoomed} · ${mine} mã`;
  }

  function apply(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.c)) return;
    last = state;

    // Bảng màu do bot gửi: giữa ô, rìa ô, viền — cùng sắc độ mà bản đồ SVG dùng.
    for (const [kind, shades] of Object.entries(state.p ?? {})) {
      const [middle, rim, edge] = shades;
      document.documentElement.style.setProperty(`--${kind}-c`, middle);
      document.documentElement.style.setProperty(`--${kind}-r`, rim);
      document.documentElement.style.setProperty(`--${kind}-e`, edge);
    }

    // Xin khung ở đây chứ không chỉ lúc nạp trang: trên web, `z.room` chỉ có sau khi ứng dụng chào,
    // mà lời chào tới cùng lúc với dữ liệu đầu tiên. Gọi lúc nạp là gọi vào chỗ chưa có gì.
    fitRoom();

    // Gói đầu tiên: về đúng chỗ người này đứng lần trước, nếu bot còn nhớ.
    if (!seated) sit(state);

    // Bố cục cũ thì chỉ sửa giá tại chỗ; bố cục đổi thì vẽ lại — vẽ lại kiểu nào là tuỳ người xem
    // đang mở cả bảng hay đang xem riêng một ngành, và lựa chọn ấy giữ nguyên qua mỗi nhịp đẩy.
    if (opened !== null) paint(state);
    else if (state.v === version && cells.size) move(state);
    else if (zoomed === null) draw(state);
    else drawOne(state);

    clock.textContent = state.note ? `${state.note} · ${state.at ?? ''}`.trim() : (state.at ?? '');
    // Số bản dựng, và số cú bấm bot đã nhận được của phòng này. Bấm mà con số sau không tăng thì
    // cú bấm không tới được bot, và đó là chỗ hoàn toàn khác với "bot nhận rồi mà trả lời chậm".
    if (build) build.textContent = state.got ? `b${BUILD}·${state.got}` : `b${BUILD}`;
    count(state);
  }

  /**
   * Xin đúng cái khung cho một bảng nhiệt: chữ nhật nằm ngang.
   *
   * Khung mặc định của phiên là thẻ nổi hơi đứng — web 440×560, điện thoại rộng chừng màn hình trừ
   * 24 và cao hơn rộng — mà một treemap nhét vào khung đứng thì các ô thành những cột dựng, chữ
   * không nằm được và mắt không so được diện tích nữa. `z.room` cho biết khung lớn nhất máy này
   * chịu cho, nên tính ra bề ngang rồi xin đúng 16:9 trong đó.
   */
  /**
   * Phần khung ngoài bản đồ: hàng chú giải cộng đệm — **đo**, không phải hằng số.
   *
   * Hằng số thì sai ngay lần đầu bố cục đổi: bỏ hàng tiêu đề trên đi mà vẫn xin đúng chiều cao cũ
   * là chừa lại một dải trắng vô nghĩa đúng bằng hàng vừa bỏ, và người dùng nhìn thấy ngay.
   */
  const chrome = () => Math.round((legend?.getBoundingClientRect().height || 24) + 10);

  let wanted = null;   // kích thước vừa xin, để không xin đi xin lại y hệt một thứ

  function fitRoom() {
    const room = z?.room;
    if (!room?.width || typeof z.setSize !== 'function') return;

    const CHROME = chrome();
    // Bản đồ: chữ nhật 16:9 lớn nhất lọt vào phòng. Trang chi tiết: xin hết những gì phòng có —
    // bảng mười phiên, chart và phần hồ sơ cộng lại dài hơn một khung 16:9 rất nhiều.
    const wide = opened === null
      ? Math.round(Math.max(200, Math.min(room.width, ((room.height - CHROME) * 16) / 9)))
      : Math.round(room.width);
    const tall = opened === null
      ? Math.round((wide * 9) / 16 + CHROME)
      : Math.round(room.height);

    // So với **khung ứng dụng đang cho**, không phải với thứ vừa xin: host báo lại khung thật sự
    // cấp qua đúng đường `onRoom` này, nên xin lại cái khung đang có là một vòng đổi cỡ không dừng.
    if (Math.abs(room.width - wide) <= 2 && Math.abs(room.height - tall) <= 2) return;
    // Và đừng xin lại đúng thứ vừa xin: ứng dụng có quyền kẹp bớt, lúc ấy `z.room` không bao giờ
    // bằng thứ mình hỏi, và hỏi mãi là một vòng lặp gửi đi mỗi nhịp đẩy.
    if (wanted && wanted.w === wide && wanted.h === tall) return;
    wanted = { w: wide, h: tall };
    z.setSize(wide, tall);
  }

  function hello() {
    if (!z || typeof z.send !== 'function') return;
    try { z.send({ hello: 1, host: z.room?.host ?? '?' }); } catch { /* không chào được thì thôi */ }
  }

  /**
   * Báo bot chỗ mình đang đứng, để lần sau mở lại còn về đúng đấy.
   *
   * Trang không tự nhớ được: widget chạy trong iframe `sandbox="allow-scripts"` không có
   * `allow-same-origin`, nên origin là mờ và chạm vào `localStorage` là ném lỗi. Bot nhớ hộ.
   *
   * Gộp lại một nhịp: bấm vào một ngành rồi bấm ngay một mã là hai lần đổi trong nửa giây, mà
   * người ta chỉ dừng ở chỗ cuối cùng.
   */
  let seating = null;
  let satAt = 0;

  function seat() {
    if (!z || typeof z.send !== 'function') return;
    const tell = () => {
      satAt = Date.now();
      try { z.send({ seat: [zoomed, opened, tab] }); } catch { /* không báo được thì thôi */ }
    };

    // Lần đổi đầu tiên báo **ngay**, những lần dồn dập sau mới gộp lại. Chờ rồi mới báo là đánh cược
    // rằng trang còn sống thêm bốn phần mười giây nữa — mà người đóng widget ngay sau khi mở một mã
    // thì đúng là không: cái hẹn chết theo trang, và bot không bao giờ biết họ đã đứng ở đâu.
    if (Date.now() - satAt >= SEAT_MS) { tell(); return; }
    clearTimeout(seating);
    seating = setTimeout(tell, SEAT_MS);
  }

  /**
   * Dựng lại chỗ ngồi cũ, đúng một lần, lúc gói đầu tiên tới.
   *
   * Chỉ lần đầu: sau đó người xem đang tự đi lại trong bảng, và một cái gói tới mỗi ba giây mà kéo
   * họ về chỗ ghi trong đó là không ai bấm đi đâu được nữa.
   */
  function sit(state) {
    // **Chỉ đánh dấu đã dựng khi biết mình là ai.** Trên web, danh tính người xem tới trong lời chào
    // của ứng dụng, còn gói trạng thái đi bằng một tin nhắn khác — và không có gì bảo đảm lời chào
    // tới trước. Đốt cờ ngay ở gói đầu tiên nghĩa là hôm nào lời chào tới sau thì mất chỗ ngồi, hôm
    // nào tới trước thì còn. Đó đúng là kiểu lúc được lúc không.
    sits += 1;
    const who = z?.viewer?.id;
    if (!who) {
      // Nhưng cũng không đợi mãi: không có danh tính sau vài nhịp thì thôi, chứ dựng lại chỗ cũ vào
      // giữa lúc người ta đang bấm dở là giật mất cái bảng khỏi tay họ.
      if (sits >= SIT_TRIES) seated = true;
      return;
    }

    seated = true;
    const mine = state.seats?.[who];
    if (!Array.isArray(mine)) return;

    const [wasZoom, wasOpen, wasTab] = mine;
    if (typeof wasZoom === 'string' && (state.g ?? []).some(([name]) => name === wasZoom)) zoomed = wasZoom;
    if (typeof wasOpen === 'string' && (state.c ?? []).some(([symbol]) => symbol === wasOpen)) {
      tab = wasTab === 'ptkt' ? 'ptkt' : 'all';
      showTab();
      open(wasOpen);
      if (tab === 'ptkt') study(wasOpen);
    }
  }

  // Theo dõi khung bọc, không theo dõi bản đồ: chính `fit()` đặt kích thước bản đồ, nên nghe ngóng
  // bản đồ là nghe lại tiếng của mình và quay vòng.
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(wrap);

  if (z) {
    // Chỉ `onState`. Doc nói rõ: trong một phiên, `onData` **không bao giờ được gọi** — nó là đường
    // của thẻ view, nơi dữ liệu đi sẵn trong tin nhắn. Đăng ký nó ở đây chỉ là mã không ai chạy.
    // Đăng ký trước `ready()`, vì `ready()` mới là lúc nói với app rằng đã sẵn sàng nhận trạng thái.
    if (typeof z.onState === 'function') z.onState(apply);
    // `onRoom` là cả câu chuyện: nó chạy ngay khi khung đã biết (điện thoại ghi sẵn trước cả mã của
    // trang) và chạy lúc ứng dụng chào khi chưa biết (web, nơi khung lúc nạp còn bằng 0). Gọi tay
    // lúc nạp thì trên web rơi đúng vào lúc chưa có gì — đó là lý do lần đầu bảng mở ra vẫn đứng.
    if (typeof z.onRoom === 'function') z.onRoom(fitRoom);
    else fitRoom();
    if (typeof z.ready === 'function') z.ready();

    // Chào một tiếng. Không có tin báo "đã mở" nào cho bot, nên đây là cách duy nhất bot biết bảng
    // thật sự hiện ra trên máy ai — và biết nó hiện trên web hay điện thoại.
    //
    // Tiếng chào này là **điều kiện để có số**, không phải phép lịch sự: ngoài giờ khớp lệnh bot
    // đẩy đúng một lần rồi nghỉ, và lần ấy đi trước lúc trang này tồn tại. Nên chào lại tới khi có
    // gói đầu tiên — một gói rơi mất là cả cái bảng không bao giờ hiện ra.
    hello();
    let tries = 0;
    const again = setInterval(() => {
      if (last) { clearInterval(again); return; }
      tries += 1;
      if (tries > HELLO_TRIES) {
        clearInterval(again);
        // Nói ra thay vì đứng mãi ở "Đang mở…": hai câu ấy trông giống nhau trên màn hình nhưng
        // một câu là đang chờ, còn câu kia là đã hỏng — và chỉ câu thứ hai mới đáng đi báo.
        clock.textContent = 'Chưa nhận được số liệu';
        return;
      }
      hello();
    }, HELLO_AGAIN_MS);
  } else {
    // Mở thẳng file trong trình duyệt: vẽ một bảng mẫu, để sửa giao diện mà không cần bot chạy.
    apply({
      v: 0, at: '13:58', note: 'Đang khớp lệnh', help: 'Gõ /vic để xem giá một mã',
      g: [['Ngân hàng', 0, 0, 600, 1000, 60], ['Dầu khí', 610, 0, 390, 1000, 60]],
      c: [
        ['VPB', 10, 120, 350, 500, '+2,17%', 0, 0, 900],
        ['TCB', 370, 120, 220, 500, '+0,62%', 0, 0, 600],
        ['SHB', 10, 630, 580, 350, '+0%', 2, 0, 500],
        ['BSR', 620, 120, 370, 500, '-1,96%', 1, 1, 700],
        ['GEL', 620, 630, 180, 350, '+6,99%', 3, 1, 260],
        ['PVD', 810, 630, 180, 350, '-2,28%', 1, 1, 240],
      ],
      t: { ceiling: 9, up: 257, flat: 93, down: 150, floor: 1 },
      d: {
        VPB: {
          n: 'Ngân hàng TMCP Việt Nam Thịnh Vượng', e: 'Vietnam Prosperity JSC Bank',
          w: 'HOSE · Ngân hàng', p: '23,50', d: '+0,50', f: 1,
          q: [['Khối lượng', '18.462.900'], ['Giá trị', '434 tỷ'], ['Tham chiếu', '23,00'],
            ['Trần / Sàn', '24,60 / 21,40'], ['Mở cửa', '23,05'], ['Cao / Thấp', '23,60 / 23,00']],
          r: [['Ngành', 'Ngân hàng'], ['Vốn hoá', '186.420 tỷ đồng'], ['Cổ phiếu lưu hành', '7.933.923.601'],
            ['Room ngoại', '30% · đang nắm 24,8%'], ['52 tuần', '17,30 – 24,10'], ['Niêm yết', '17/08/2017']],
          h: [
            ['17/09', '23,50', '+2,17%', '18.462.900', '434 tỷ', 1],
            ['16/09', '23,00', '-0,18%', '20.259.400', '466 tỷ', -1],
            ['15/09', '23,05', '+1,65%', '24.355.000', '561 tỷ', 1],
            ['12/09', '22,67', '+0,93%', '25.705.400', '583 tỷ', 1],
            ['11/09', '22,46', '-2,00%', '27.525.700', '618 tỷ', -1],
          ],
          hb: ['KLTB 5 phiên', '23.261.680'],
          a: 'Ngân hàng TMCP Việt Nam Thịnh Vượng tiền thân là Ngân hàng TMCP Các Doanh nghiệp Ngoài quốc doanh, hoạt động trong lĩnh vực ngân hàng bán lẻ và tài chính tiêu dùng.',
        },
      },
    });
  }
})();
