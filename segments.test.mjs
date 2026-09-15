// Bộ đọc báo cáo bộ phận: đọc số, đơn vị, đối chiếu tổng, chạy lần lượt các mẫu, bộ nhớ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { crossCheck, parseAmount, readSegments, segmentCache, unitFactor } from './market/segments.mjs';

test('số tiền kiểu báo cáo Việt Nam: dấu chấm hàng nghìn, ngoặc là âm, gạch là không', () => {
  assert.equal(parseAmount('1.234.567.890'), 1234567890);
  assert.equal(parseAmount('1,234,567'), 1234567);
  assert.equal(parseAmount('(12.345)'), -12345);
  assert.equal(parseAmount('-'), 0);
  assert.equal(parseAmount('987'), 987);
  assert.equal(parseAmount('Doanh thu'), null);
  assert.equal(parseAmount('12.34'), null);   // không phải kiểu hàng nghìn
});

test('đơn vị tính của bảng', () => {
  assert.equal(unitFactor('Đơn vị tính: VND'), 1);
  assert.equal(unitFactor('Đơn vị: triệu đồng'), 1e6);
  assert.equal(unitFactor('ĐƠN VỊ TÍNH : nghìn VND'), 1e3);
  assert.equal(unitFactor('Đơn vị tính: tỷ đồng'), 1e9);
  assert.equal(unitFactor('không có dòng đơn vị'), 1);
});

test('đối chiếu: tổng các mảng phải khớp doanh thu báo cáo trong ngưỡng', () => {
  const segments = [{ name: 'A', value: 60 }, { name: 'B', value: 39 }];
  assert.equal(crossCheck(segments, 100).ok, true);
  assert.equal(crossCheck(segments, 110).ok, false);
  assert.equal(crossCheck(segments, null).ok, false);
});

test('chạy lần lượt các mẫu, lấy mẫu đầu tiên có tổng khớp, bỏ qua mẫu đọc sai hay ném', () => {
  const cases = [
    { name: 'ném', read() { throw new Error('vỡ'); } },
    { name: 'không nhận ra', read: () => [] },
    { name: 'đọc sai cột', read: () => [{ name: 'A', value: 10 }, { name: 'B', value: 5 }] },
    { name: 'đúng', read: () => [{ name: 'Bán lẻ xăng dầu', value: 70 }, { name: 'Dầu nhờn', value: 30 }] },
  ];
  const result = readSegments('…', { total: 100, cases });
  assert.equal(result.reader, 'đúng');
  assert.deepEqual(result.tried.map((one) => [one.reader, one.ok]), [['đọc sai cột', false], ['đúng', true]]);

  const none = readSegments('…', { total: 100, cases: cases.slice(0, 3) });
  assert.equal(none.segments, null);
});

test('bộ nhớ theo mã và kỳ, sống qua lần mở lại', () => {
  const path = join(tmpdir(), `segments-${randomUUID()}.json`);
  const cache = segmentCache(path);
  assert.equal(cache.get('oil', 2026, 2), null);
  cache.set('oil', 2026, 2, { segments: [{ name: 'Bán lẻ', value: 1 }] });
  assert.deepEqual(segmentCache(path).get('OIL', 2026, 2), { segments: [{ name: 'Bán lẻ', value: 1 }] });
  assert.equal(segmentCache(path).get('OIL', 2026, null), null);
});
