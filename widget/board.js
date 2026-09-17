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
  const z = window.Zeplao;
  const map = document.getElementById('map');
  const wrap = document.getElementById('wrap');
  const legend = document.getElementById('legend');
  const clock = document.getElementById('clock');
  const help = document.getElementById('help');

  const back = document.getElementById('back');

  const cells = new Map();   // mã -> { box, percent }
  const titles = [];         // tên nhóm, đo lại mỗi lần khung đổi
  let version = null;        // bố cục đang hiện là của gói nào
  let zoomed = null;         // **tên** nhóm đang xem riêng, null là cả bảng
  let last = null;           // gói gần nhất, để vẽ lại khi đổi qua lại giữa hai cách xem

  const LEAST_LABEL = 7;
  const MOST_LABEL = 30;
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
      title.addEventListener('click', () => open(index));
      box.append(title);
      titles.push(title);
      map.append(box);
    }

    for (const [symbol, x, y, w, h, shown, kind] of state.c ?? []) {
      const box = document.createElement('div');
      box.className = `cell ${KINDS[kind] ?? 'flat'}`;
      at(box, x, y, w, h, 1);

      const name = document.createElement('b');
      name.textContent = symbol;
      const percent = document.createElement('span');
      percent.textContent = shown;
      box.append(name, percent);

      map.append(box);
      cells.set(symbol, { box, percent });
    }

    fit();
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
    const room = wrap.getBoundingClientRect();
    if (room.width > 0 && room.height > 0) {
      const wide = Math.min(room.width, (room.height * 16) / 9);
      map.style.width = `${Math.floor(wide)}px`;
      map.style.height = `${Math.floor((wide * 9) / 16)}px`;
    }

    // Nút quay lại bám góc **bản đồ**, không bám góc khung bọc: bản đồ căn giữa, nên ở cửa sổ rộng
    // hai bên còn thừa chỗ và một nút dính mép trái sẽ nằm chơ vơ ngoài bảng.
    back.style.left = `${map.offsetLeft + 6}px`;
    back.style.top = `${map.offsetTop + 5}px`;

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
      const tile = document.createElement('div');
      tile.className = `cell ${KINDS[kind] ?? 'flat'}`;
      at(tile, box.x, box.y, box.w, box.h, 1);

      const name = document.createElement('b');
      name.textContent = symbol;
      const percent = document.createElement('span');
      percent.textContent = shown;
      tile.append(name, percent);

      map.append(tile);
      cells.set(symbol, { box: tile, percent });
    }

    back.hidden = false;
    back.textContent = `← ${zoomed}`;
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

  function open(index) {
    if (!last) return;
    const name = (last.g?.[index] ?? [])[0];
    if (!name) return;
    zoomed = name;
    drawOne(last);
    count(last);
  }

  back.addEventListener('click', () => {
    zoomed = null;
    if (!last) return;
    draw(last);
    count(last);
  });

  /**
   * Hàng chú giải đếm đúng thứ đang hiện trên bảng.
   *
   * Xem riêng ngân hàng mà dưới chân vẫn ghi "165 tăng" của cả sàn thì hai con số cạnh nhau nói hai
   * chuyện khác nhau, và người đọc tin con số hơn tin cái bảng.
   */
  function count(state) {
    const tally = {};
    if (zoomed === null) Object.assign(tally, state.t ?? {});
    else {
      const place = placeOf(state);
      for (const cell of state.c ?? []) {
        if (cell[7] !== place) continue;
        const kind = KINDS[cell[6]] ?? 'flat';
        tally[kind] = (tally[kind] ?? 0) + 1;
      }
    }
    for (const kind of KINDS) {
      const shown = document.getElementById(`n-${kind}`);
      if (shown) shown.textContent = String(tally[kind] ?? 0);
    }
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

    // Bố cục cũ thì chỉ sửa giá tại chỗ; bố cục đổi thì vẽ lại — vẽ lại kiểu nào là tuỳ người xem
    // đang mở cả bảng hay đang xem riêng một ngành, và lựa chọn ấy giữ nguyên qua mỗi nhịp đẩy.
    if (state.v === version && cells.size) move(state);
    else if (zoomed === null) draw(state);
    else drawOne(state);

    clock.textContent = state.note ? `${state.note} · ${state.at ?? ''}`.trim() : (state.at ?? '');
    if (state.help) help.textContent = state.help;
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

  function fitRoom() {
    const room = z?.room;
    if (!room?.width || typeof z.setSize !== 'function') return;

    const CHROME = chrome();
    const width = Math.max(200, Math.min(room.width, ((room.height - CHROME) * 16) / 9));
    const wide = Math.round(width);
    const tall = Math.round((width * 9) / 16 + CHROME);

    // So với **khung ứng dụng đang cho**, không phải với thứ vừa xin: host báo lại khung thật sự
    // cấp qua đúng đường `onRoom` này, nên xin lại cái khung đang có là một vòng đổi cỡ không dừng.
    if (Math.abs(room.width - wide) <= 2 && Math.abs(room.height - tall) <= 2) return;
    z.setSize(wide, tall);
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
    if (typeof z.send === 'function') {
      try { z.send({ hello: 1, host: z.room?.host ?? '?' }); } catch { /* không chào được thì thôi */ }
    }
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
    });
  }
})();
