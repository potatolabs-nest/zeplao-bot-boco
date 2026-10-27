// Thử lệnh vàng bạc với dữ liệu thật, không cần bot, không cần token.
//
//   node try-vang.mjs          giá vàng trong nước, in đúng tin nhắn bot sẽ gửi
//   node try-vang.mjs bac      giá bạc trong nước
//   node try-vang.mjs tg       vàng thế giới (XAU) và chỉ số đô la (DXY)
//   node try-vang.mjs xag      bạc thế giới
//
// Vàng trong nước từ Mi Hồng, bạc trong nước từ BTMC, thế giới từ Yahoo — xem `market/gold.mjs`.
// Không nguồn nào cần khoá.
import { btmcSilver, mihongGold, vnGoldText, vnSilverText, worldText, yahooQuotes } from './market/gold.mjs';

const what = process.argv[2]?.toLowerCase();

if (what === 'bac') {
  console.log(vnSilverText(await btmcSilver().price()) ?? '(nguồn không trả lời)');
} else if (what === 'tg' || what === 'xau' || what === 'xag' || what === 'dxy') {
  const asked = what === 'tg' ? ['XAU', 'DXY'] : [what.toUpperCase()];
  console.log(worldText(await yahooQuotes().quotes(asked)) ?? '(nguồn không trả lời)');
} else {
  console.log(vnGoldText(await mihongGold().price()) ?? '(nguồn không trả lời)');
}
