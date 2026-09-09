# bocobot

Một con bot trả lời giá chứng khoán trong nhóm chat Cúc Cu. Gõ `!vic` giữa lúc đang nói
chuyện, nó trả về một dòng:

```
VIC 256,1 ▲ +4,74% · KL 7.518.600
```

Một dòng, vì một nhóm chat không phải một cái bảng điện. Ai muốn xem bảng thì đã mở bảng rồi;
thứ người ta hỏi giữa cuộc trò chuyện là mã ấy hôm nay lên hay xuống, và câu trả lời cho việc đó
dài đúng một dòng.

## Dùng thế nào

| Gõ | Được gì |
| --- | --- |
| `!vic` | Một mã, kèm chart biến động giá trong phiên gần nhất và trục giá |
| `!gex 1d`, `!gex 2d`, `!gex 3m`, `!gex 4y` | Một mã, kèm chart theo số ngày/tháng/năm tuỳ gõ |
| `!vic hpg fpt` | Nhiều mã, một tin nhắn, không kèm chart |
| `!tin vic` | 5 bài viết gần nhất của một mã, link được nhúng trong tiêu đề |
| `!vnindex`, `!vn30f1m`, `!fuevfvnd` | Chỉ số, phái sinh, chứng chỉ quỹ — cùng một dấu |
| `@bocobot vic hpg` | Gọi tên, nếu ai đó quen lối ấy |
| Nhắn riêng | Không cần dấu gì cả, gõ `vic` là đủ |

Nhiều nhất **10 mã** một lần hỏi, và câu trả lời luôn là **một tin nhắn** dù hỏi mấy mã. Nền
tảng cho mỗi phòng một tin mỗi giây; ba mã thành ba tin là hai lần chờ và một cuộc trò chuyện bị
đẩy trôi vì một câu hỏi.

Riêng `!tin <mã>` là lệnh đọc tin. Mỗi lần chỉ nhận một mã, để `!tin vic gex` không bị hiểu lẫn
thành hỏi giá ba mã `TIN`, `VIC`, `GEX`. `!tin` đứng một mình vẫn là hỏi giá mã `TIN`. Chart
dài hạn cũng chỉ nhận một mã mỗi lần: `!gex 1y` được, còn hỏi nhiều mã thì bot chỉ trả giá,
không gắn chart riêng.

Kỳ hạn chart nhận từ `1d` tới tối đa `20y`: `d` là ngày, `m` là tháng, `y` là năm. Chữ `n` vẫn
được hiểu là năm, nên `!gex 5n` và `!gex 5y` đều chạy.

## Vì sao là dấu chấm than, không phải gạch chéo

Đây là quyết định chịu lực của con bot này, và nó không phải chuyện gu.

Nền tảng chỉ giao `/xyz` cho bot **đã đăng ký đúng chữ ấy** — không phải cứ có gạch chéo là mọi
bot đều nghe. Luật ấy đúng: bỏ nó đi thì mọi bot trong phòng thức dậy mỗi lần ai đó gõ một gạch
chéo. Nhưng chỗ đăng ký chỉ nhận **100 lệnh**, mà ba sàn có **1.522 mã**.

Không phải suy ra từ tài liệu — tài liệu nói khác. Gửi thử 400 lệnh lên, máy chủ giữ lại đúng
100, không báo lỗi, không nói gì. Nên đường gạch chéo phủ được nhiều nhất 98 mã và bỏ lại 1.424
mã còn lại.

`!vic` thì chỉ là một câu chữ thường. Bot nghe được nó, và nó chạy với mọi mã, không trừ mã nào.

**Đổi lại, bot phải được tắt chế độ riêng tư** — chủ bot bật ở trang bot, và cả nhóm được app
báo cho biết. Bot đọc mọi câu trong phòng.

Điều đó dẫn thẳng tới luật thứ hai: **nghe được không phải là được hỏi.** Không có dấu gọi thì
bot im, dù trong câu có tên mã. Cách khác — thấy mã nào thì báo giá mã ấy — đã đo thử và không
dùng được: đem 172 từ tiếng Việt thông dụng viết không dấu đọ với danh sách ba sàn thì **16 từ
trùng mã**, trong đó có `HOM`, `TIN`, `THU`, `TOT`, `TRA`. "hom nay", "tin nay", "thu xem" —
mỗi câu như vậy là một lần bot chen vào chuyện không ai hỏi nó. Một dấu người ta phải cố ý gõ
thì không gõ nhầm bao giờ.

Bot **không đăng ký lệnh nào**, và lúc khởi động nó gửi lên một danh sách rỗng để dọn những gì
đã đăng ký ở lần chạy trước. Riêng `/gia@bocobot vic` vẫn chạy: một lệnh nêu đích danh thì nền
tảng giao thẳng, biết chữ ấy hay không.

## Giá lấy ở đâu

Một **dây nguồn**, không phải một nguồn. Hỏi nguồn đầu; mã nào nó không có thì đem xuống nguồn
sau.

| Thứ tự | Nguồn | Phủ gì | Cần khoá |
| --- | --- | --- | --- |
| 1 | Feed bảng giá công khai | Cổ phiếu ba sàn HOSE / HNX / UPCOM và chứng chỉ quỹ. Có giá khớp, trần, sàn, tham chiếu, khối lượng. Một lượt gọi cho nhiều mã | Không |
| 2 | DNSE — nến ngày | Chỉ số (`VNINDEX`, `VN30`), phái sinh (`VN30F1M`), và mọi thứ nguồn 1 lỡ. Giá hiện tại và giá đóng cửa phiên trước | Không |
| 3 | DNSE — trần sàn tham chiếu | Không trả giá; nó **sửa** giá tham chiếu của nguồn 2 thành số chính thức | Có |

Xếp hàng chứ không phải dự phòng, dù nó cũng làm luôn việc dự phòng: nguồn đầu chết thì mọi mã
rơi xuống nguồn sau, chậm hơn và vẫn trả lời. Chỉ khi **không nguồn nào** trả lời được gì thì
bot mới nói ra là hỏng — vì lúc ấy im lặng là nói dối: người hỏi sẽ tưởng mã mình gõ không tồn
tại.

Bot không biết nguồn nào đang trả lời. Nó nhận một cái hình có đúng hai hàm, `quotes()` và
`universe()`, nên cắm thêm hay đổi nguồn không phải sửa một dòng nào trong phần bot.

### Khoá DNSE

Tầng thứ ba đọc khoá từ **biến môi trường**, và chỉ từ đó:

```
DNSE_API_KEY=...
DNSE_API_SECRET=...
```

Không có chúng thì tầng ấy **không tồn tại** và bot vẫn chạy — chỉ là chỉ số với phái sinh không
có trần sàn. Đó là mặc định, và mặc định ấy là thứ giữ cho repo này không chứa bí mật nào: `git`
bỏ qua `.env`, và không file nào trong repo có khoá.

Tầng này ký request theo HTTP Signature: chuỗi ký gồm dòng yêu cầu, dòng ngày, và dòng `nonce`
khi có; ngày viết đuôi `+0000` chứ không phải `GMT`; chữ ký base64 rồi url-encode; phần khai báo
`headers` **không** kể `nonce` dù `nonce` có trong chuỗi ký. Bốn chỗ ấy sai chỗ nào cũng ra đúng
một kết quả — `401`, không kèm lý do — nên cả bốn đều có bài test ghim lại.

Nó tồn tại để sửa đúng một chỗ, và chỗ đó đáng nói: nguồn nến lấy **giá đóng cửa phiên trước**
làm tham chiếu, đúng mọi ngày trừ ngày chốt quyền. Hôm ấy tham chiếu được điều chỉnh và không
còn bằng giá đóng cửa hôm trước, nên một cổ phiếu đứng giá sẽ hiện lên là giảm mấy phần trăm —
con số sai duy nhất ở đây mà trông hoàn toàn hợp lý.

## Con số nghĩa là gì

| | |
| --- | --- |
| Giá | Nghìn đồng, viết theo lối tiếng Việt: `256,1` là 256.100 đồng |
| Khối lượng | **Cổ phiếu**, không phải lô |
| Tăng giảm | So với giá tham chiếu, tự tính lại chứ không đọc của nguồn |
| `▲ ▼ ▬` | Trên, dưới, bằng tham chiếu |
| `TRẦN` `SÀN` | Hết biên độ. Trên bảng điện chúng là màu tím và xanh lơ; trong khung chat không có màu nào, nên thứ duy nhất còn lại để nói là chữ |
| `— chưa khớp` | Chưa có lệnh nào khớp. Không phải giá bằng không |

Hai chỗ đáng đọc kỹ:

**Khối lượng nhân mười.** Feed công khai đếm theo **lô 10 cổ phiếu** và không có dòng nào trong
tài liệu của họ nói vậy; nó lộ ra khi đối chiếu một phiên đã đóng với một nguồn khác. Sai gấp
mười là loại sai không ai nhìn ra — con số vẫn hợp lý, vẫn tăng giảm đúng chiều, chỉ ít đi một
chữ số. Phép nhân ấy nằm ở một chỗ, có tên, và có bài test.

**Dòng cuối nói sàn đang mở hay đã đóng, và nó suy từ đồng hồ.** Nguồn không gửi kèm dấu thời
gian nào: một cái giá của phiên hôm kia trông y hệt một cái giá của mười giây trước. Nên bot xem
đồng hồ Việt Nam — 9:00–11:30 và 13:00–15:00, thứ Hai tới thứ Sáu — rồi nói ra. Đang khớp lệnh
thì nó không nói gì, vì lúc ấy không có gì để cảnh báo.

> **Nó không biết lịch nghỉ lễ.** Mùng một Tết lúc mười giờ sáng, bot sẽ im lặng như một phiên
> đang chạy, trong khi số liệu là của phiên cuối cùng trước Tết. Đây là chỗ hụt đã biết, viết ra
> ở đây vì thứ tệ hơn một giới hạn là một giới hạn không ai nói.

## Chạy

Tạo bot ở [kuku.vn/bot](https://kuku.vn/bot), lấy token, rồi:

```bash
ZEPLAO_BOT_TOKEN=<token> npm start
```

Lên đúng thì nó in `@<tên bot> đang trực bảng giá` rồi số mã niêm yết nó biết. Nhớ tắt chế độ riêng tư ở trang bot, không thì `!vic` không tới được nó. Bất cứ gì khác là
token sai.

### Bằng image

```bash
docker run -d --name bocobot --restart unless-stopped \
  -e ZEPLAO_BOT_TOKEN=<token> \
  -v bocobot-data:/app/data \
  ghcr.io/hule-prime/zeplao-bot-boco
```

Image dựng lại mỗi lần `main` đổi, sau khi bộ test xanh — xem `.github/workflows/image.yml`.
Thẻ `latest` là bản mới nhất; mỗi commit còn một thẻ riêng theo mã băm, để quay lại được đúng
bản đang chạy chứ không phải bản gần giống nó.

Không có bước cài đặt nào trong đó, vì repo không phụ thuộc gói nào: không `npm install`, không
`node_modules`, không lockfile để mà lệch. Chạy dưới người dùng `node` chứ không phải root, và
`/app/data` là chỗ duy nhất nó ghi — gắn volume vào đó thì khởi động lại không phát lại những
câu hỏi cũ vào phòng.

| Biến môi trường | Để làm gì |
| --- | --- |
| `ZEPLAO_BOT_TOKEN` | Bắt buộc. Token của bot |
| `ZEPLAO_BOT_API` | Nền tảng bot. Mặc định `https://api-bot.kuku.vn` |
| `DNSE_API_KEY`, `DNSE_API_SECRET` | Tuỳ chọn. Bật tầng trần-sàn-tham chiếu |
| `BOCO_STATE` | Chỗ ghi trạng thái. Mặc định `data/state.json` |

Trạng thái giữ đúng **hai** thứ: đã đọc tới cập nhật nào, và đã chào phòng nào. Không có giá nào
được lưu ở đó — thứ duy nhất tệ hơn một con bot không trả lời là một con bot trả lời bằng số của
hôm qua. Cái thứ nhất là thứ ngăn một lần khởi động lại phát lại cả trăm câu hỏi cũ vào phòng;
cái thứ hai ngăn nó chào lại một nhóm mỗi lần có người sửa một dòng mã.

## Test

```bash
npm test
```

Không có mạng trong bộ test. Nền tảng bot là một máy chủ dựng lên trên cổng tự cấp, nguồn giá là
một cái giả đếm số lần bị hỏi, và đồng hồ là tham số.

Phần lớn bài test ở đây kiểm **những gì không xảy ra**: bot không nói gì khi lệnh không phải của
nó, không hỏi lại nguồn khi vừa hỏi xong, không dò lại một chữ đã biết là không phải mã, không
chào lại một phòng đã chào. Không có cách nào kiểm một tin nhắn không được gửi ngoài cách cho nó
đủ thời gian để gửi rồi đếm — nên các bài ấy có một khoảng lặng cố ý, và khoảng lặng ấy không
phải chỗ để cắt cho nhanh.

## Bố cục

| File | Là gì |
| --- | --- |
| `Dockerfile` | Đóng gói, không cài gì, không chạy bằng root |
| `bocobot.mjs` | Vòng lặp, đọc câu hỏi, luật im lặng, gửi tin |
| `market/quote.mjs` | Chỗ duy nhất hiểu "giá" nghĩa là gì: chuẩn hoá, câu chữ, phiên giao dịch |
| `market/chart.mjs` | Nến 5 phút, nến ngày, và SVG chart có trục giá cho một mã |
| `market/news.mjs` | Nguồn tin RSS và câu chữ cho `!tin <mã>` |
| `market/vps.mjs` | Nguồn 1 — feed công khai, kèm bộ nhớ vài giây |
| `market/dnse.mjs` | Nguồn 2 và 3 — nến ngày, và tầng có khoá |
| `market/chain.mjs` | Xếp các nguồn thành một hàng |
| `market/symbols.mjs` | Cái sàng: cái gì là mã, cái gì là lệnh của bot bên cạnh |

`market/quote.mjs` không biết gì về mạng và `bocobot.mjs` không biết gì về nguồn nào đang chạy.
Đó không phải chuyện gọn gàng: một nguồn giá miễn phí là thứ có thể đổi đường dẫn hoặc biến mất
vào bất cứ sáng thứ Hai nào, và khi ấy thứ phải sửa nên là một file.

## Chưa làm

- **Danh mục theo dõi.** `!theodoi vic hpg` rồi `!bang` ra cả bảng. Cần nhớ danh sách theo từng
  phòng, tức là một sổ trên đĩa và một câu hỏi về việc ai được sửa danh sách của phòng.
- **Cảnh báo giá.** `!baogia vic 260`. Kéo theo một vòng lặp nền, chống lặp tin, và một câu hỏi
  khó hơn cả ba: nhắn cho ai khi mã chạm giá lúc hai giờ sáng.
- **Bước giá mua bán.** Nguồn 1 có sẵn ba bước mỗi bên. Không đưa vào vì một dòng là một dòng.
- **Lịch nghỉ lễ**, để dòng cuối thôi nói sai vào mùng một Tết.
