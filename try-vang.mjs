// Thử lệnh vàng với dữ liệu thật, không cần bot, không cần token.
//
//   node try-vang.mjs          giá vàng trong nước, in đúng tin nhắn bot sẽ gửi
//   node try-vang.mjs tg       vàng thế giới (XAU) và chỉ số đô la (DXY)
//
// Vàng trong nước từ Mi Hồng (`market/gold.mjs`), thế giới từ Yahoo. Không nguồn nào cần khoá.
import { mihongGold, vnGoldText, worldText, yahooQuotes } from './market/gold.mjs';

const what = process.argv[2]?.toLowerCase();

if (what === 'tg' || what === 'xau' || what === 'dxy') {
  const asked = what === 'tg' ? ['XAU', 'DXY'] : [what.toUpperCase()];
  console.log(worldText(await yahooQuotes().quotes(asked)) ?? '(nguồn không trả lời)');
} else {
  console.log(vnGoldText(await mihongGold().price()) ?? '(nguồn không trả lời)');
}
