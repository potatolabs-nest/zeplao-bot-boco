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
| `/vic` (cả nhóm), `!vic` (chỉ bạn) | Một mã, kèm chart biến động giá trong phiên gần nhất và trục giá |
| `/gex 1d`, `/gex 2d`, `/gex 3m`, `/gex 4y` | Một mã, kèm chart theo số ngày/tháng/năm tuỳ gõ |
| `/vic hpg fpt` | Nhiều mã, một tin nhắn, không kèm chart |
| `!tin vic` | 5 bài viết gần nhất của một mã, link được nhúng trong tiêu đề |
| `!kq vic`, `!kq vic q2`, `!kq vic 2025` | Cơ cấu doanh thu (doanh nghiệp: bán hàng / dịch vụ / xây dựng; ngân hàng: nguồn thu nhập; chứng khoán: nghiệp vụ; bảo hiểm: phí, tài chính…) kèm % đóng góp, so cùng kỳ, DT · LNG · LNST — số liệu BCTC từ Vietcap IQ, mọi mã |
| `!ptkt vic` | Phân tích kỹ thuật một mã: hình chart kèm chỉ báo, đánh giá, độ tin cậy, điểm mua bán |
| `!manh`, `!manh hientai` | Mã dẫn dắt trong VN30 + VNMID, kèm điểm vào và cắt lỗ |
| `!hoiphuc`, `!hoiphuc hientai` | Mã vừa xác nhận đáy trong VN30 + VNMID, kèm điểm mua, chốt lời, cắt lỗ |
| `!dongtien`, `!dongtien hientai`, `!dongtien ngân hàng` | Ngành nào đang hút tiền trên HOSE; kèm tên ngành thì kể từng mã của ngành ấy |
| `/strat`, `!strategy`, `!stragety`, `!chienluoc` | Pha thị trường hiện tại (uptrend / đi ngang / downtrend) và việc nên làm trong pha ấy: tỷ trọng, số lệnh, rủi ro mỗi lệnh, kiểu điểm mua — hình infographic kèm một dòng chú thích |
| `/liqu`, `/thanhkhoan` | Chart thanh khoản VN-Index cộng dồn trong phiên, so với cùng giờ phiên trước — số liệu nến phút của Vietcap |
| `/vang`, `!vang`, `!sjc` | Giá vàng trong nước: vàng miếng SJC và nhẫn tròn trơn 999.9, mỗi thứ hai dòng — một lượng và một chỉ, giá mua vào – bán ra. Số liệu Mi Hồng |
| `/bac`, `!bac` | Giá bạc trong nước: miếng Phú Quý và Rồng Thăng Long Ag 999, một lượng, giá mua vào – bán ra. Số liệu BTMC |
| `/tg`, `!tg`, `!tg xau`, `!tg xag`, `!tg dxy` | Vàng (XAU), bạc (XAG) thế giới và chỉ số đô la (DXY), một dòng mỗi thứ. Số liệu Yahoo |
| `/sugg`, `!sugg` | Quét cả sàn, 10 mã đáng mua nhất lúc gõ theo PTKT. Hình: vị trí 10 mã trên phân bố điểm của cả sàn, và mỗi mã một thanh rủi ro / lời trên chung một trục % kèm lý do; chữ: mỗi mã một dòng mua / chốt / cắt lỗ |
| `/view vnindex`, `/view vn30f1m`, `/view fuevfvnd` — mọi mã, kể cả mã không có lệnh riêng | Chỉ số, phái sinh, chứng chỉ quỹ — cùng một dấu |
| `@bocobot vic hpg` | Gọi tên, nếu ai đó quen lối ấy |

Nhắn riêng với bot cũng theo đúng những lệnh trên: `vic` gõ trần trụi không được trả lời, phải
là `!vic`.

Nhiều nhất **10 mã** một lần hỏi, và câu trả lời luôn là **một tin nhắn** dù hỏi mấy mã. Nền
tảng cho mỗi phòng một tin mỗi giây; ba mã thành ba tin là hai lần chờ và một cuộc trò chuyện bị
đẩy trôi vì một câu hỏi.

Riêng `!tin <mã>` là lệnh đọc tin. Mỗi lần chỉ nhận một mã, để `!tin vic gex` không bị hiểu lẫn
thành hỏi giá ba mã `TIN`, `VIC`, `GEX`. `!tin` đứng một mình được nhắc cú pháp; giá mã `TIN` là `!view tin`. Chart
dài hạn cũng chỉ nhận một mã mỗi lần: `!view gex 1y` được, còn hỏi nhiều mã thì bot chỉ trả giá,
không gắn chart riêng.

`!ptkt <mã>` là phân tích kỹ thuật, cũng mỗi lần một mã. Câu trả lời là **một hình kèm vài dòng
chữ**: hình có bốn ô chung trục ngày — nến 80 phiên với MA20/50/200, vùng mua tô xanh và các vạch
chốt lời, bán, cắt lỗ; khối lượng với đường TB20; RSI(14) với vạch 30 và 70; MACD(12, 26, 9). Nến
tăng rỗng, nến giảm đặc, để người mù màu đỏ-lục vẫn đọc được. Chữ chỉ còn đánh giá, độ tin cậy,
mỗi bước một cụm từ, và điểm mua bán.

Bên dưới là khoảng 300 nến ngày của mã và của VN-Index, đi qua từng bước: xu hướng theo MA, động
lượng theo RSI và MACD, khối lượng 5 phiên so với 20 phiên, Bollinger(20), vị trí trong vùng giá
một năm, sức mạnh so với VN-Index và xu hướng thị trường chung. Mỗi bước một điểm. Tổng từ +3 trở
lên là **tích cực**, từ -3 trở xuống là **tiêu cực**, còn lại là **bình thường**; các bước cùng
chiều nhau tới đâu thì độ tin cậy **cao / trung bình / thấp** tới đó, và dữ liệu ngắn hay thanh
khoản mỏng luôn kéo về thấp. Điểm mua, chốt lời, cắt lỗ đặt theo hỗ trợ/kháng cự từ đỉnh đáy 120
phiên và ATR(14). Không có mô hình ngôn ngữ nào: cùng dữ liệu thì ra cùng nhận định, và đây là tín
hiệu tự động, không phải khuyến nghị.

`!sugg` chạy đúng bài phân tích ấy cho **mọi cổ phiếu có khớp lệnh trong phiên** (chừng 800 mã,
vài giây), nên mã nào nó đưa ra thì `!ptkt` mã ấy ra cùng đánh giá. Được vào danh sách khi: đánh
giá tích cực với tin cậy từ trung bình trở lên; vốn hoá từ 1.000 tỷ (Vietcap; không rõ vốn hoá thì
loại); giá trị giao dịch bình quân 20 phiên từ 3 tỷ; không đứng giá trần; giá chưa chạy quá vùng
mua 5% và lời/lỗ tính từ giá hiện tại từ 1 trở lên — để "mua lúc này" là mua được, không phải mua
đuổi. Xếp theo điểm, rồi độ tin cậy, rồi lời/lỗ. Kết quả nhớ hai phút; ít hơn mười mã đạt thì đưa
ít hơn, không lấp bằng mã bình thường.

Kỳ hạn chart nhận từ `1d` tới tối đa `20y`: `d` là ngày, `m` là tháng, `y` là năm. Chữ `n` vẫn
được hiểu là năm, nên `!gex 5n` và `!gex 5y` đều chạy.

### Lọc cả rổ: `!manh`, `!hoiphuc`, `!dongtien`

Ba lệnh này không nhận mã. Chúng chấm cả một rổ rồi trả về một tin chữ: `!manh` và `!hoiphuc` chấm
VN30 + VNMID, `!dongtien` chấm cả HOSE. Đầu tin là bối cảnh thị trường — VN-Index so với MA20, MA50,
và nhịp kiểu O'Neil (phiên phân phối, ngày xác nhận) — vì lúc thị trường điều chỉnh thì ít mã lọt
là đúng, và tin nhắn phải nói ra điều đó.

Ngay sau đó là **pha thị trường** và việc nên làm trong pha ấy (`market/strategy.mjs`):
**downtrend** khi nhịp đang điều chỉnh, hoặc VN-Index và MA20 cùng dưới MA50; **uptrend** khi cả
hai trên MA50 và nhịp đã xác nhận; còn lại là **đi ngang**. Mỗi pha một mức tỷ trọng cổ phiếu, số
mã, tỷ trọng mỗi mã và kiểu điểm mua ưu tiên (uptrend: breakout; đi ngang: pullback; downtrend: giữ
tiền, chỉ pullback mã RS cao). `!strategy` chỉ in hành động của **pha hiện tại** — một hình
infographic (thanh ba pha có pha hiện tại tô đặc, lý do, thước tỷ trọng cổ phiếu, sáu ô: số mã, tỷ
trọng mỗi mã, rủi ro mỗi lệnh, số lệnh mới, cắt lỗ, mua thêm; điểm mua, chốt lời, việc lúc này,
điều kiện chuyển pha) kèm một dòng chú thích; bản chữ đầy đủ chỉ gửi khi máy chủ không nhận hình. Đây là quy tắc quản lý vốn, chưa backtest.

- **`!manh`** — ba tầng. Lọc cứng: đủ thanh khoản, ở kênh trên, gần đỉnh, nằm trong nhóm mạnh nhất
  rổ theo sức mạnh tương đối. Chấm nền: đường RS, giữ giá khi VN-Index giảm… Điểm vào: pivot là đỉnh
  nền; mã được xếp **vượt nền / vùng mua / đã chạy xa / nền chưa xong / nền rộng**, kèm cắt lỗ.
  Mã đã chạy xa hoặc nền rộng được ghi thêm vùng chờ về MA10–MA20, nếu cắt lỗ tính từ MA20 còn
  trong ngưỡng rủi ro — chỉ để theo dõi, chưa backtest. Cuối tin luôn có mục **Theo dõi**: mã thiếu
  đúng một điều kiện dẫn dắt, RS từ 70, chưa chạy quá pivot — để canh điểm mua trước khi mã mạnh hẳn.
- **`!hoiphuc`** — ngược lại: mã ở xa đỉnh, đã tạo đáy đo được (dưới MA200 hoặc cách đỉnh 52 tuần
  từ 25%; đáy 60 phiên chưa bị phá; đáy sau cao hơn đáy trước; giá trên MA20 và MA20 đã quay lên).
  Mua khi vượt pivot với khối lượng, cắt lỗ dưới đáy sau, chốt lời trước kháng cự gần nhất, không
  quá +10%. Một mã hồi hết đường, lấy lại MA200 và về gần đỉnh, là lúc nó chuyển sang `!manh`.
  Cuối tin luôn có mục **Theo dõi**: mã thiếu đúng một điều kiện xác nhận đáy.
- **`!dongtien`** — thước đo là **tỷ trọng** giá trị giao dịch: ngành hút tiền là ngành có phần
  trong GTGD 5 phiên lớn hơn phần của nó trong 60 phiên trước. Tiền vào mà giá không lên được tách
  riêng thành "có thể đang bị bán ra". Mã VN30 + VNMID được ghi kèm trạng thái `!manh` / `!hoiphuc`.
  `!dongtien ngân hàng` (một phần tên ngành, có dấu hay không) kể mọi mã đủ thanh khoản của ngành.

Câu trả lời là **một hình kèm chữ**, trong cùng một tin như `!ptkt`. Hình `!dongtien` là mọi ngành
xếp hạng, mỗi ngành một thanh dài theo mức đổi tỷ trọng: đặc xanh là hút tiền, sọc cam là giao
dịch tăng mà giá giảm, nhạt là rút tiền — ba kiểu thanh khác nhau, không chỉ khác màu. Chữ thì phải
cắt còn vài ngành cho vừa 2000 ký tự, còn hình có đủ cả sàn. Hình `!manh` / `!hoiphuc` là lưới tối đa
8 ô, mỗi mã một chart giá 60 phiên với vạch pivot (đứt), cắt lỗ (liền đỏ) và, với `!hoiphuc`, mức bán
(chấm xanh) — nhìn là thấy mã nào đang sát pivot, mã nào cắt lỗ sâu. Không có mã nào để vẽ thì chỉ
gửi chữ. `!dongtien <ngành>` là danh sách mã, chỉ có chữ.

Mặc định là **bản cuối ngày**, chỉ dùng nến đã đóng. Thêm `hientai` là chấm cả cây nến của phiên đang
chạy, khối lượng ước cả phiên theo nhịp cùng giờ 20 phiên trước; `!manh` / `!hoiphuc` khi đó in thêm
mã nào mới lọt, mã nào rớt so với bản cuối ngày. Chưa có phiên hôm nay thì bot nói ra và trả bản
cuối ngày.

Một lần chấm là vài trăm lượt hỏi nến, nên bot giữ lại: nến ngày 30 phút, dùng chung cho cả ba lệnh;
bài đã chấm 30 phút, bản `hientai` 3 phút; hai người hỏi cùng lúc thì chờ chung một lần chấm. Ngưỡng
nằm ở `DEFAULTS` trong `market/strength.mjs`, `market/rebound.mjs`, `market/flow.mjs`; thử với dữ liệu
thật, không cần bot, bằng `node try-manh.mjs`, `try-hoiphuc.mjs`, `try-dongtien.mjs` (hai file đầu
nhận `--thongke` để đếm số mã đạt từng tiêu chí), backtest bằng `try-manh-backtest.mjs`,
`try-hoiphuc-backtest.mjs`. Đây là tín hiệu tự động, không phải khuyến nghị.

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


### Chú thích thuật ngữ

Những từ chuyên môn trong câu trả lời — `MA20`, `MA50`, `MA200`, `RSI`, `MACD`, `Bollinger`, `TB20`,
`KL`, `TC`, `TRẦN`, `SÀN`, `R:R`, `Chốt lời`, `Cắt lỗ`, `VN-Index`, `PTKT` — bấm vào được: mỗi từ mở
một thẻ nhỏ giải thích nó, kèm công thức và ví dụ khi có. Thẻ là view `term` của widget trong
`widget/`; chữ trên thẻ đi trong chính tin nhắn (`market/glossary.mjs`), nên trang không cần biết
thuật ngữ nào. Bot tự gói `widget/` và tải lên (`setWidget`) mỗi lần khởi động — gói không đổi thì
máy chủ trả `unchanged`. Máy chủ từ chối chú thích (chưa có widget, view đổi tên) thì bot gửi lại
câu trả lời không kèm chú thích, không bao giờ im. Tin có hình (chart, PTKT) thì web không cho
bấm vào chữ, nên bot gửi hình thành một tin riêng rồi chữ ngay sau, thuật ngữ bấm được như mọi tin chữ.

### Khai báo lệnh trước (từ 15/09/2026)

Nền tảng giờ chỉ giao `/từ` và `!từ` cho bot **đã khai báo** `từ` bằng `setCommands`, tối đa 100
lệnh. Bot khai báo các lệnh chính — `view` (giá mọi mã), `ptkt`, `tin`, `kq`, `manh`, `hoiphuc`,
`dongtien`, `board` (và hai tên khác `bangdien`, `vboa`), `bang`, và tên của chính nó (hướng dẫn) — rồi lấp phần còn lại bằng các mã giao dịch nhiều tiền nhất phiên gần nhất, xếp
theo giá × khối lượng lúc khởi động. Gõ `/` là gửi cho cả nhóm (`/vic`, `/ptkt vic`, `/vboa bank`),
gõ `!` là chỉ người gõ thấy (`!vic`, `!ptkt vic`). Mã không nằm trong danh sách lệnh vẫn hỏi được
bằng `/view xyz` hoặc `!view xyz`. Câu trả lời cho `!` là tin cho một người (`onlyForUserId`); bot đọc
lệnh máy chủ đã tách qua `command`, `commandArgs`, `commandPrefix`.

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

### Vàng bạc không đi qua dây nguồn ấy

`!vang`, `!bac` và `!tg` có nguồn riêng, vì vàng bạc không phải những cái mã có sàn. Nhét `XAU` vào
dây nguồn trên thì bộ đọc mã sẽ đem nó đi hỏi DNSE — và DNSE không có XAU, XAG lẫn DXY, cả ba đều
trả `400`. Nên các lệnh ấy có bộ đọc riêng, chạy **trước** `askedFor`, cùng chỗ với `!tin` và `!ptkt`.

Ba nguồn, và cả ba đều không cần khoá:

| Nguồn | Cho | Gọi thế nào |
| --- | --- | --- |
| Mi Hồng `api.mihong.com/v1/gold-prices?market=domestic` | Vàng trong nước: SJC, nhẫn 999.9 | Một lượt, không header gì |
| BTMC `api.btmc.vn/api/BTMCAPI/getpricebtmc` | Bạc trong nước: Phú Quý, Rồng Thăng Long | Một lượt, **bắt buộc có `?key=`** (giá trị nào cũng chạy) |
| Yahoo `query1.finance.yahoo.com/v8/finance/chart/{mã}` | XAU, XAG và DXY | Một lượt mỗi mã, **phải kèm `User-Agent`** |

**Vàng và bạc trong nước đi hai nguồn khác nhau, và đó không phải tuỳ tiện.** Mi Hồng trả một lượt
gọn gàng, có cả SJC lẫn nhẫn — nhưng nó **không có bạc**: `market=silver` trả `400`, và danh sách
`goldCode` hợp lệ chỉ có mười mã vàng. BTMC thì có bạc. Đổi lại, túi dữ liệu của BTMC khó đọc hơn:
một bản ghi phẳng với **tên trường tự đánh số** (`@n_95`, `@pb_95`, rồi `@n_460`, `@pb_460` ở dòng
khác), nên trường phải tìm theo **tiền tố** — đọc cứng `@n_95` thì hôm sau nguồn đổi thứ tự là ra
`undefined` cho mọi dòng, và cái sai ấy im lặng.

Bốn chỗ dưới đây là chỗ dễ sai, và cả bốn đều im lặng khi sai:

**Giá vàng Mi Hồng là đồng một CHỈ, không phải một lượng.** `14050000` đọc lên y như một cái giá một
lượng rẻ mạt. Đối chiếu ba nguồn: Mi Hồng niêm yết SJC 1 chỉ 14.200.000 bán ra; BTMC cũng niêm
yết SJC đúng 14.200.000 cho sản phẩm "0.1" của họ, tức một phần mười lượng; và trên thế giới vàng
lúc ấy $4.030 một ounce — một lượng là 1,2056 ounce, tỷ giá 25.831, ra 125,5 triệu, cộng chênh
lệch SJC quen thuộc là vừa khớp. Một lượng mười chỉ, nên SJC bán ra **142.000.000 đồng một lượng**.
Phép nhân mười ấy nằm một chỗ, ở `vnGold`, và có bài test ghim lại.

**Bạc BTMC thì ngược lại: đơn vị ghi sẵn trong tên sản phẩm** ("BẠC MIẾNG PHÚ QUÝ Ag 999 **1
LƯỢNG**"), nên ở đó **không** có phép nhân nào — chọn đúng dòng "1 LƯỢNG" rồi đọc thẳng, thay vì
lấy một dòng rồi đoán quy ước của bảng. Nguồn có cả `1 KG`, `0,5 KG`, `5 LƯỢNG`; chọn nhầm dòng
`5 LƯỢNG` thì giá vọt lên năm lần mà trông vẫn hoàn toàn hợp lý. Đối chiếu: dòng "5 LƯỢNG" của Rồng
Thăng Long là 9.005.000, đúng năm lần dòng "1 LƯỢNG" 1.801.000 — và đúng bằng năm lần phép tính
của bot.

**Yahoo đóng cửa với một request không `User-Agent`** — nó trả `429`, và `429` đọc lên như bị chặn
vì hạn mức. Không phải: chỉ là cửa trước không mở cho một request trần trụi.

**`meta.chartPreviousClose` không phải giá phiên liền trước.** Nó là giá đóng cửa của phiên *trước
cả cây nến đầu tiên trong khung*, nên với khung 5 ngày nó bằng chính cây nến đầu. Lấy nó làm tham
chiếu thì mức tăng giảm là của cả tuần mà gọi tên là của hôm nay. Tham chiếu đúng là **cây nến đã
đóng gần nhất**, tức cây áp cuối — và chỉ số có ngày nghỉ nên mảng `close` có chỗ `null`, phải bỏ
đi trước khi đếm.

Cũng vì thế mà `!tg` là một **prefix** chứ không phải `!xau` trơn: bot này phục vụ một phòng trong
nước, `XAU` lại đúng hình một mã cổ phiếu, nên phần thị trường ngoài đứng sau một chữ riêng. `!tg`
trơn là vàng với đô la — hai thứ trả lời cùng một câu, vì vàng tính bằng đô la nên đồng đô la mạnh
lên là một cái gió ngược; `!tg xau`, `!tg xag` hay `!tg dxy` là một thứ, và gõ được cùng lúc. **Bạc
không vào mặc định**: nó là chỉ số thứ ba, và một dòng thừa trong câu trả lời của người chỉ hỏi vàng
là một dòng người ta phải bỏ qua. Vàng bạc trong nước thì không cần prefix — đó là việc chính.

Bạc trong nước có hai thương hiệu và **không gộp chúng**: Phú Quý với Rồng Thăng Long chênh nhau gần
2% một lượng, và người mua bạc miếng quan tâm thương hiệu nào mua lại được. Gộp thành một dòng là bỏ
mất đúng thứ họ cần biết.

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
| `market/liquidity.mjs` | Thanh khoản VN-Index cho `!liqu`: nến phút Vietcap, so cùng giờ, chart SVG |
| `market/gold.mjs` | Vàng bạc cho `!vang` (Mi Hồng), `!bac` (BTMC) và `!tg` (Yahoo: XAU, XAG, DXY) |
| `market/suggest.mjs` | Quét cả sàn cho `!sugg`: lọc, xếp hạng, câu chữ |
| `market/symbols.mjs` | Cái sàng: cái gì là mã, cái gì là lệnh của bot bên cạnh |
| `market/strength.mjs` | Bộ lọc `!manh`, và nến phiên đang chạy dựng từ nến 5 phút |
| `market/rebound.mjs` | Bộ lọc `!hoiphuc` |
| `market/flow.mjs` | Dòng tiền theo ngành cho `!dongtien` |
| `market/strategy.mjs` | Pha thị trường, bảng hành động theo pha cho `!strategy` và đầu tin `!manh` / `!hoiphuc` |
| `market/pulse.mjs` | Nhịp thị trường: phiên phân phối, ngày xác nhận |
| `market/screens.mjs` | Phần mạng của ba bộ lọc trên: đi lấy nến cả rổ, giữ lại, chờ chung |
| `market/screens-chart.mjs` | Hình SVG của ba bộ lọc: thanh dòng tiền theo ngành, lưới chart nhỏ cho từng mã |
| `try-*.mjs` | Chạy thử một lệnh với dữ liệu thật, không cần bot; `*-backtest.mjs` để chỉnh ngưỡng |

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
