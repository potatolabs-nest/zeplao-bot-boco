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
  const clock = document.getElementById('clock');
  const help = document.getElementById('help');

  const cells = new Map();   // mã -> { box, percent }
  const titles = [];         // tên nhóm, đo lại mỗi lần khung đổi
  let version = null;

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
    map.replaceChildren();
    cells.clear();
    titles.length = 0;

    for (const [name, x, y, w, h, header] of state.g ?? []) {
      const box = document.createElement('div');
      box.className = 'group';
      at(box, x, y, w, h);

      const title = document.createElement('h2');
      title.textContent = name;
      // Chiều cao dải tiêu đề tính ở `fit()`, **không** tính ở đây: lúc dựng DOM thì khung bảng có
      // thể còn chưa có chiều cao thật — card đang được đổi cỡ — và đo lúc ấy ra 0. Đó chính là
      // cách tôi vừa làm mất sạch tên nhóm: 0 pixel thì nhóm nào cũng "quá bé để ghi tên".
      title.dataset.strip = String(header ?? 30);
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

  function apply(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.c)) return;

    // Xin khung ở đây chứ không chỉ lúc nạp trang: trên web, `z.room` chỉ có sau khi ứng dụng chào,
    // mà lời chào tới cùng lúc với dữ liệu đầu tiên. Gọi lúc nạp là gọi vào chỗ chưa có gì.
    fitRoom();

    if (state.v !== version || !cells.size) draw(state);
    else move(state);

    clock.textContent = state.note ? `${state.note} · ${state.at ?? ''}`.trim() : (state.at ?? '');
    if (state.help) help.textContent = state.help;
    for (const [kind, count] of Object.entries(state.t ?? {})) {
      const shown = document.getElementById(`n-${kind}`);
      if (shown) shown.textContent = String(count);
    }
  }

  /**
   * Xin đúng cái khung cho một bảng nhiệt: chữ nhật nằm ngang.
   *
   * Khung mặc định của phiên là thẻ nổi hơi đứng — web 440×560, điện thoại rộng chừng màn hình trừ
   * 24 và cao hơn rộng — mà một treemap nhét vào khung đứng thì các ô thành những cột dựng, chữ
   * không nằm được và mắt không so được diện tích nữa. `z.room` cho biết khung lớn nhất máy này
   * chịu cho, nên tính ra bề ngang rồi xin đúng 16:9 trong đó.
   */
  const CHROME = 76;   // chỗ cho dòng tiêu đề và hàng chú giải
  function fitRoom() {
    const room = z?.room;
    if (!room?.width || typeof z.setSize !== 'function') return;

    const width = Math.max(200, Math.min(room.width, ((room.height - CHROME) * 16) / 9));
    const wide = Math.round(width);
    const tall = Math.round((width * 9) / 16 + CHROME);

    // So với **khung ứng dụng đang cho**, không phải với thứ vừa xin: host báo lại khung thật sự
    // cấp qua đúng đường `onRoom` này, nên xin lại cái khung đang có là một vòng đổi cỡ không dừng.
    if (Math.abs(room.width - wide) <= 2 && Math.abs(room.height - tall) <= 2) return;
    z.setSize(wide, tall);
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(map);

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
        ['VPB', 10, 120, 350, 500, '+2,17%', 0],
        ['TCB', 370, 120, 220, 500, '+0,62%', 0],
        ['SHB', 10, 630, 580, 350, '+0%', 2],
        ['BSR', 620, 120, 370, 500, '-1,96%', 1],
        ['GEL', 620, 630, 180, 350, '+6,99%', 3],
        ['PVD', 810, 630, 180, 350, '-2,28%', 1],
      ],
      t: { ceiling: 9, up: 257, flat: 93, down: 150, floor: 1 },
    });
  }
})();
