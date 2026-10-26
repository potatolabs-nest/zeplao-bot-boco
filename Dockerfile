# Con bot, đóng gói.
#
#   docker run -d --name bocobot --restart unless-stopped \
#     -e ZEPLAO_BOT_TOKEN=<token> \
#     -v bocobot-data:/app/data \
#     ghcr.io/hule-prime/zeplao-bot-boco
#
# Không có bước cài đặt nào, vì repo này không phụ thuộc gói nào cả: không `npm install`, không
# `node_modules`, không lockfile để mà lệch. Cả image là Node và sáu file — nên nó dựng trong
# vài giây và không có gì trong đó để mà cũ đi ngoài chính Node.
FROM node:24-alpine

# Chạy dưới người dùng `node` có sẵn trong image, không phải root. Một con bot là mã nói chuyện
# với internet suốt ngày; nó không có việc gì cần tới root, và ngày nó bị lợi dụng thì cái không
# cần ấy là thứ duy nhất đứng giữa.
WORKDIR /app

# Chỉ những thứ chạy. Bộ test không lên image — nó chạy ở CI, nơi hỏng thì người ta đọc được.
COPY package.json bocobot.mjs widget.mjs ./
COPY market ./market
COPY widget ./widget

# Chỗ ghi trạng thái, và là **thứ duy nhất** bot ghi. Tạo sẵn và trao cho `node` ở đây, vì một
# tiến trình không phải root thì không tự tạo được thư mục dưới `/app` do root sở hữu — và cái
# hỏng ấy chỉ lộ ra ở dòng log đầu tiên sau khi container đã chạy được vài giây.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data
ENV BOCO_STATE=/app/data/state.json

USER node

# Không có `npm start` ở giữa. `npm` là một tiến trình nữa đứng chắn giữa systemd và bot: nó
# nhận SIGTERM rồi quyết định làm gì với nó, và thứ bot cần là tín hiệu ấy đến thẳng nơi có chỗ
# cho nó đáp xuống.
CMD ["node", "bocobot.mjs"]
