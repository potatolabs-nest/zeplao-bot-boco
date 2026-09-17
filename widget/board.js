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
  let version = null;

  const LEAST_LABEL = 7;
  const MOST_LABEL = 30;
  const KINDS = ['up', 'down', 'flat', 'ceiling', 'floor'];

  const at = (box, x, y, w, h) => {
    box.style.left = `${x / 10}%`;
    box.style.top = `${y / 10}%`;
    box.style.width = `${w / 10}%`;
    box.style.height = `${h / 10}%`;
  };

  function draw(state) {
    version = state.v ?? null;
    map.replaceChildren();
    cells.clear();

    for (const [name, x, y, w, h] of state.g ?? []) {
      const box = document.createElement('div');
      box.className = 'group';
      at(box, x, y, w, h);
      const title = document.createElement('h2');
      title.textContent = name;
      box.append(title);
      map.append(box);
    }

    for (const [symbol, x, y, w, h, shown, kind] of state.c ?? []) {
      const box = document.createElement('div');
      box.className = `cell ${KINDS[kind] ?? 'flat'}`;
      at(box, x, y, w, h);

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
    for (const { box } of cells.values()) {
      const size = Math.min(box.clientWidth / 4.3, box.clientHeight / 3.6, MOST_LABEL);
      box.classList.toggle('hush', size < LEAST_LABEL);
      box.style.fontSize = `${Math.max(size, LEAST_LABEL)}px`;
    }
  }

  function apply(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.c)) return;

    if (state.v !== version || !cells.size) draw(state);
    else move(state);

    clock.textContent = state.note ? `${state.note} · ${state.at ?? ''}`.trim() : (state.at ?? '');
    if (state.help) help.textContent = state.help;
    for (const [kind, count] of Object.entries(state.t ?? {})) {
      const shown = document.getElementById(`n-${kind}`);
      if (shown) shown.textContent = String(count);
    }
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(map);

  if (z) {
    if (typeof z.onState === 'function') z.onState(apply);
    if (typeof z.onData === 'function') z.onData(apply);
    if (typeof z.ready === 'function') z.ready();
  } else {
    // Mở thẳng file trong trình duyệt: vẽ một bảng mẫu, để sửa giao diện mà không cần bot chạy.
    apply({
      v: 0, at: '13:58', note: 'Đang khớp lệnh', help: 'Gõ /vic để xem giá một mã',
      g: [['Ngân hàng', 0, 0, 600, 1000], ['Dầu khí', 610, 0, 390, 1000]],
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
