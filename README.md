# bocobot

Một con bot trả lời giá chứng khoán trong nhóm chat Cúc Cu. Gõ `/vic` giữa lúc đang nói chuyện,
nó trả về một dòng:

```
VIC 256,1 ▲ +4,74% · KL 7.518.600
```

Một dòng, vì một nhóm chat không phải một cái bảng điện. Ai muốn xem bảng thì đã mở bảng rồi;
thứ người ta hỏi giữa cuộc trò chuyện là mã ấy hôm nay lên hay xuống, và câu trả lời cho việc đó
dài đúng một dòng.

Viết theo khuôn của nền tảng bot Cúc Cu: một file chạy được, không phụ thuộc ngoài, không bước
build. Nhận cập nhật bằng một cuộc gọi dài ba mươi giây, trả lời bằng một tin nhắn.

## Dùng thế nào

| Gõ | Được gì |
| --- | --- |
| `/vic` | Một mã |
| `/vic hpg fpt` | Nhiều mã, một tin nhắn |
| `/gia vic hpg` | Như trên, cho ai quen gõ lệnh có tên |
| `@bocobot vic hpg` | Hỏi bằng cách gọi tên, trong câu nói bình thường |
| `/vnindex`, `/vn30f1m` | Chỉ số và phái sinh, cùng một cách gõ |
| `/gia` hoặc `/help@bocobot` | Nó tự nói nó làm được gì |
| Nhắn riêng | Không cần gạch chéo, không cần gọi tên — gõ `vic` là đủ |

Nhiều nhất **10 mã** một lần hỏi, và câu trả lời luôn là **một tin nhắn** dù hỏi mấy mã. Nền
tảng cho mỗi phòng một tin mỗi giây; ba mã thành ba tin là hai lần chờ và một cuộc trò chuyện bị
đẩy trôi vì một câu hỏi.

```
VIC 256,1 ▲ +4,74% · KL 7.518.600
HPG 21,7 ▲ +0,46% · KL 13.920.900
VNINDEX 1.853,08 ▲ +1,39% · KL 618.685.696
Sàn đã đóng cửa · số liệu phiên gần nhất
```

## Thứ khó nhất ở đây không phải giá

**Trong một phòng có ba con bot, mọi tin nhắn bắt đầu bằng `/` đều tới cả ba.** Nền tảng là như
vậy, có chủ ý. Nghĩa là `/tienlen` của người khác cũng rơi vào con bot này. Một con bot giá cổ
phiếu đáp "không tìm thấy mã TIENLEN" mỗi lần ai đó gọi con bot bên cạnh là một con bot bị đá
khỏi phòng trong tuần đầu tiên.

Nên luật là **không chắc thì im**, và nó có ba mức:

| Chữ được gõ | Bot làm gì |
| --- | --- |
| Có trong danh sách niêm yết ba sàn | Hỏi giá ngay |
| Không có, nhưng đúng hình một mã (`FUEVFVND`, `VNINDEX`) | Dò nguồn **đúng một lần**, rồi nhớ câu trả lời nửa ngày |
| Không giống mã (`di`, `ăn`, `123`) | Bỏ qua, không tốn một lượt mạng nào |

Cái mức giữa là chỗ chứng chỉ quỹ và chỉ số đi vào — chúng không có trong danh sách ba sàn —
và cũng là chỗ `/tienlen` đi ra: dò một lần, không có, im mãi mãi.

Còn một luật thứ hai đi kèm, và nó tinh hơn: **mã tra không ra chỉ được nêu tên khi có người
gọi thẳng bot này bằng một lệnh.**

| Câu hỏi | Mã lạ trong đó |
| --- | --- |
| `/gia vic zzz` — lệnh của bot này | `ZZZ — không có dữ liệu` |
| `/zzz@bocobot` — gọi đích danh | `ZZZ — không có dữ liệu` |
| `/zzz` — chưa ai gọi tên ai | Im |
| `@bocobot cho xem vic voi` — một câu nói | Chỉ trả về VIC, không kê `CHO` `XEM` `VOI` thành lỗi |

Thiếu vế đầu thì một câu hỏi lịch sự biến thành một danh sách lỗi kê ra mọi chữ ba ký tự trong
câu. Thiếu vế sau thì bot chen vào mọi lệnh của hàng xóm. Cả hai đều có bài test giữ, và vế sau
đã hỏng thật một lần trước khi có bài test ấy.

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

Lên đúng thì nó in `@<tên bot> đang trực bảng giá` rồi số mã niêm yết nó biết. Bất cứ gì khác là
token sai.

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
| `bocobot.mjs` | Vòng lặp, đọc câu hỏi, luật im lặng, gửi tin |
| `market/quote.mjs` | Chỗ duy nhất hiểu "giá" nghĩa là gì: chuẩn hoá, câu chữ, phiên giao dịch |
| `market/vps.mjs` | Nguồn 1 — feed công khai, kèm bộ nhớ vài giây |
| `market/dnse.mjs` | Nguồn 2 và 3 — nến ngày, và tầng có khoá |
| `market/chain.mjs` | Xếp các nguồn thành một hàng |
| `market/symbols.mjs` | Cái sàng: cái gì là mã, cái gì là lệnh của bot bên cạnh |

`market/quote.mjs` không biết gì về mạng và `bocobot.mjs` không biết gì về nguồn nào đang chạy.
Đó không phải chuyện gọn gàng: một nguồn giá miễn phí là thứ có thể đổi đường dẫn hoặc biến mất
vào bất cứ sáng thứ Hai nào, và khi ấy thứ phải sửa nên là một file.

## Chưa làm

- **Danh mục theo dõi.** `/theodoi vic hpg` rồi `/bang` ra cả bảng. Cần nhớ danh sách theo từng
  phòng, tức là một sổ trên đĩa và một câu hỏi về việc ai được sửa danh sách của phòng.
- **Cảnh báo giá.** `/baogia vic 260`. Kéo theo một vòng lặp nền, chống lặp tin, và một câu hỏi
  khó hơn cả ba: nhắn cho ai khi mã chạm giá lúc hai giờ sáng.
- **Bước giá mua bán.** Nguồn 1 có sẵn ba bước mỗi bên. Không đưa vào vì một dòng là một dòng.
- **Lịch nghỉ lễ**, để dòng cuối thôi nói sai vào mùng một Tết.
