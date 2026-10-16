// Thử !ptkt tại chỗ, không cần bot, không cần token kuku — chỉ gọi thẳng nguồn DNSE công khai.
//
//   node try-ptkt.mjs vic
//
// In chữ ra console, lưu hình SVG ra file cạnh đó để mở bằng trình duyệt.
import { writeFileSync } from 'node:fs';
import { technicalAnalysis, technicalMessage, technicalSvg } from './market/technical.mjs';

const symbol = process.argv[2] ?? 'vic';
const ptkt = technicalAnalysis(); // dùng fetch thật, đồng hồ thật — như bot đang chạy live

const { report } = ptkt;
const result = await report(symbol);

if (typeof result === 'string') {
  console.log('--- Không phân tích được, chỉ có một dòng lý do ---');
  console.log(result);
} else {
  console.log(result.text);
  writeFileSync(`ptkt-${symbol}.svg`, result.image.svg);
  console.log(`\n→ hình lưu ở ptkt-${symbol}.svg, mở bằng trình duyệt để xem`);
}
