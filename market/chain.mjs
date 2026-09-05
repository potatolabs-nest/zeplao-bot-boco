// Nhiều nguồn giá, xếp thành một hàng.
//
// Hỏi nguồn đầu; mã nào nó không có thì đem xuống nguồn sau. Không phải để chịu lỗi — để **phủ
// hết**: feed công khai nhanh và có trần sàn nhưng không có chỉ số với phái sinh, DNSE có chỗ
// ấy nhưng đi một lượt gọi mỗi mã. Xếp hàng đúng thứ tự thì `/vic` đi một đường, `/vnindex` đi
// một đường, và không ai phải nhớ mã nào ở đâu.
//
// Chịu lỗi là hệ quả đi kèm: nguồn đầu chết thì mọi mã rơi xuống nguồn sau, chậm hơn và vẫn trả
// lời. **Chỉ khi không nguồn nào trả lời được gì** thì lỗi mới nổi lên, vì lúc ấy im lặng là
// nói dối: người hỏi cần biết là hỏng, không phải tưởng mã mình gõ không tồn tại.
export function chain(...sources) {
  const list = sources.filter(Boolean);

  return {
    name: list.map((source) => source.name).join(' → '),

    /// Danh sách niêm yết lấy ở nguồn đầu tiên có. Không gộp: cái sàng chỉ cần một danh sách đủ
    /// tốt để khỏi dò, và mã nào không có trong đó vẫn vào được bằng đường dò.
    async universe() {
      for (const source of list) {
        try {
          const symbols = await source.universe();
          if (symbols?.length) return symbols;
        } catch (problem) {
          console.error(`${source.name}: ${problem}`);
        }
      }
      return [];
    },

    async quotes(symbols) {
      const found = [];
      let left = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
      let firstProblem = null;

      for (const source of list) {
        if (!left.length) break;
        try {
          const got = await source.quotes(left);
          const have = new Set(got.map((one) => one.symbol));
          found.push(...got);
          left = left.filter((symbol) => !have.has(symbol));
        } catch (problem) {
          firstProblem ??= problem;
          console.error(`${source.name}: ${problem}`);
        }
      }

      // Không lấy được gì và có nguồn đã ném: đó là hỏng, không phải "mã không tồn tại".
      if (!found.length && firstProblem) throw firstProblem;
      return found;
    },
  };
}
