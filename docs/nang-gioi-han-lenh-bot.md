# Đề nghị: nâng giới hạn lệnh của bot, và bỏ chỗ đọc lệnh trên đường nóng

Gửi nhóm nền tảng Zeplao. Viết ngày 16/09/2026, đối chiếu với `origin/main` = `1b8c91c` ("Build 166",
16/09 11:03).

> **Lưu ý về phiên bản.** Nếu bạn đang đọc `.Take(100)` trong `Data/ChatStoreBots.cs:568` và không
> thấy `BotApiAnswers.cs`, bạn đang ở cây trước Build 164 (`921263d`, 15/09). Trên `origin/main`
> hiện tại, giới hạn là hằng số `BotCommandRules.MostCommands` ở `server/Zeplao.Api/BotApiAnswers.cs:148`,
> và lệnh dư được trả về trong `details.ignored` với lý do `too_many_commands`.

## 1. Vấn đề

Bot `@topbot` (repo `zeplao/zeplao-bot-boco`) trả lời giá cho **1.523 mã** niêm yết. Theo luật hiện
tại, `/từ` trơn chỉ tới bot **đã khai báo đúng từ đó**, kể cả khi bot đã tắt chế độ riêng tư. Mà
`setCommands` chỉ giữ 100 lệnh, nên bot chỉ khai được 5 lệnh chính (`view`, `ptkt`, `tin`, `vboa`,
`kq`) cộng 95 mã thanh khoản cao nhất.

Hệ quả người dùng gặp: **`/vgc` không trả lời, `!vgc` lại trả lời.** VGC đứng hạng 152 về giá trị
giao dịch nên không nằm trong 95 mã. Còn `!vgc` thì không bot nào khai báo `vgc`, nên tin đi vào
phòng như chữ thường và bot nghe được vì đã tắt chế độ riêng tư. 1.428 mã còn lại đều như vậy:
OCB, HHV, PHR, QNS, VEA, NLG, DIG, NKG, HDG, DBC, BMP…

Người dùng đọc cái này là "lúc được lúc không", không phải "mã này có lệnh riêng, mã kia thì không".

## 2. Đề nghị

### 2.1. Bỏ chỗ đọc lệnh trên đường nóng — nên làm trước, và đáng làm dù không nâng giới hạn

`BotDelivery.cs:503` đang gọi, **mỗi tin nhắn, cho mỗi bot trong phòng**:

```csharp
store.GetBotCommands(botId).Select(one => one.Command).ToList(),
```

`GetBotCommands` (`Data/ChatStoreBots.cs:223`) là `OwnedBy(...).OrderBy(SortOrder).ToList()`. Tức là
mỗi tin nhắn tạo một danh sách đã sắp xếp, rồi tạo thêm một danh sách tên nữa, chỉ để
`BotPrivacy.Sees` trả lời một câu hỏi: từ này có phải lệnh của bot không. Chi phí ấy tỷ lệ với số
lệnh bot khai báo, và phải trả trước cả khi biết tin nhắn có liên quan tới bot hay không.

Đề nghị: giữ sẵn tập tên lệnh theo từng bot, và xoá nó ở đúng một chỗ.

```csharp
// Data/ChatStoreBots.cs
private readonly ConcurrentDictionary<Guid, IReadOnlyCollection<string>> _commandNames = new();

public IReadOnlyCollection<string> GetBotCommandNames(Guid botId)
{
    if (_commandNames.TryGetValue(botId, out var held)) return held;
    var names = new HashSet<string>(
        _botCommands.OwnedBy(botId.ToString("N")).Select(command => command.Command),
        StringComparer.OrdinalIgnoreCase);
    _commandNames[botId] = names;
    return names;
}

private void ReclaimCommandsOf(Guid botId, IReadOnlyList<string>? commands = null, bool gone = false)
{
    _commandNames.TryRemove(botId, out _);   // thêm dòng này ở đầu hàm
    …
}
```

`ReclaimCommandsOf` là chỗ duy nhất cần chạm: mọi đường làm đổi lệnh của một bot đều đã đi qua nó —
`SetBotCommands` (679), tắt bot (708), xoá bot (744), nạp lại (1388), 1404, 1416, và
`ChatStoreReplication.cs:1094`.

Rồi ở `BotDelivery.cs:503` đổi thành `store.GetBotCommandNames(botId),`. `BotPrivacy.Sees` nhận
`IReadOnlyCollection<string>` nên chữ ký không phải sửa, và `HashSet` với `StringComparer.OrdinalIgnoreCase`
còn làm `Contains` nhanh hơn so sánh tuyến tính hiện nay.

### 2.2. Nâng `MostCommands`

`server/Zeplao.Api/BotApiAnswers.cs:148`: `100` → `2000`.

Sau 2.1 thì con số này không còn mua gì trên đường nóng nữa. Với bot của tôi, 1.523 mã cộng 5 lệnh
chính là 1.528 lệnh.

Đo thực tế gói `setCommands` với 1.523 mã:

| Mô tả lệnh | Kích thước gói |
|---|---|
| Như hiện tại ("Giá VIC: /vic cho cả nhóm, !vic chỉ bạn thấy") | 132 KB |
| Rút gọn ("Giá VIC") | 64 KB |

Giới hạn mỗi lần ghi là 1 MB, kể cả khi hàng đợi ghi phồng thêm khoảng một phần ba. Không vướng.

### 2.3. Web: đừng vẽ cả danh sách

`client/src/bots.tsx:833` đang `bot.commands.map(...)` không cắt. Với 1.500 lệnh thì trang hồ sơ bot
không đọc được. Đề nghị: hiện 40 dòng đầu, thêm nút "Xem tất cả (N)", và nếu tiện thì một ô tìm.
Chuỗi chữ nằm ở `client/src/bot-copy.ts` (khối `blocks.commands`, `noCommands`), có cả tiếng Việt và
tiếng Anh.

Ô soạn tin không có danh sách gợi ý khi gõ `/`, nên chỗ đó không ảnh hưởng.

### 2.4. Test cần sửa kèm

- `server/Zeplao.Api.Tests/BotSilentAcceptanceTests.cs:62` — `Past_a_hundred_commands_the_rest_are_left_out_by_index`
  đang khẳng định `Assert.Equal([100, 101], check.Ignored.Select(one => one.Index))`. Viết lại theo
  `BotCommandRules.MostCommands` để hằng số đổi thì test không phải sửa lần nữa.
- Thêm một test cho 2.1: `setCommands` xong thì `GetBotCommandNames` phải đổi theo ngay, và bot bị
  tắt hay bị xoá thì tập rỗng.

## 3. Phương án thay thế, nếu không muốn 1.500 lệnh

Một phiên khác đã nêu, và tôi thấy hợp lý: **cho bot nhận theo tiền tố**, thay vì khai từng mã. Ví
dụ bot khai một lần rằng nó nhận mọi `/từ` chưa ai khai báo trong phòng, và máy chủ phân xử lúc giao
tin bằng tập đã giữ sẵn. Danh sách lệnh vẫn là thứ người ta đọc được, còn phần đuôi dài do máy chủ
quyết.

Đổi lại, đó là thay đổi thiết kế lớn hơn: phải định nghĩa ai thắng khi hai bot cùng nhận tiền tố, và
cần một lối để người dùng biết bot nào sẽ trả lời.

Nếu chọn hướng này thì chỉ cần làm 2.1 và 2.3, bỏ 2.2.

## 4. Việc phía bot, sau khi máy chủ nhận

Một thay đổi nhỏ trong `bocobot.mjs`: `commandsFor` hiện cắt danh sách ở `MOST_COMMANDS = 100`, nâng
theo giới hạn mới rồi khai hết mã. Bot đã tự xếp hạng mã theo giá trị giao dịch và tự gọi
`setCommands` lúc khởi động, nên không cần thao tác tay nào.

## 5. Tôi đã làm gì và chưa làm gì

- Đã dựng một worktree riêng từ `origin/main` và build thử `Zeplao.Api` thành công (30 giây), để chắc
  các đề nghị trên đứng trên đúng cây code đang chạy.
- **Chưa sửa một dòng nào trong repo `zeplao`.** Phiên của tôi bị chặn quyền ghi vào repo dùng chung,
  và tôi không chạy bất kỳ script deploy hay kiểm tra cổng nội bộ nào.
- Các số liệu trong tài liệu này (1.523 mã, hạng của VGC, kích thước gói `setCommands`) đều đo bằng
  dữ liệu thật ngày 16/09/2026.
