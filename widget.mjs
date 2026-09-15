// Widget của bot — hiện là thẻ giải thích thuật ngữ — gói thành zip và tải lên lúc khởi động.
//
// Không phụ thuộc gói nào, như cả repo: zip ở đây là loại "stored" (không nén), vài chục dòng, đủ
// cho vài KB HTML. Tải lên mỗi lần khởi động là an toàn — một gói giống hệt bản đang chạy được máy
// chủ trả `unchanged: true` và không tốn lượt tải (kuku.vn/bot/doc, "Uploading one"). Nhờ vậy sửa
// `widget/` rồi commit, push là widget đi theo, không cần bước tay nào và không cần token ở CI.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const WIDGET_DIR = fileURLToPath(new URL('./widget/', import.meta.url));

/// Nền tảng tự ghi file này vào mọi gói; gửi kèm thì bị ghi đè, nên không gửi.
const PROVIDED = 'zeplao.js';

const TIMEOUT_MS = 30000;

/** Mọi file sẽ vào gói, theo thứ tự đường dẫn. Dotfile và `__MACOSX` bị máy chủ từ chối nên bỏ. */
export function widgetFiles(dir = WIDGET_DIR) {
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const name = relative(dir, path).split(sep).join('/');
        if (name !== PROVIDED) files.push({ path: name, bytes: readFileSync(path) });
      }
    }
  };
  walk(dir);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(bytes) >>> 0;
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Một file zip "stored" từ `[{ path, bytes }]`.
 *
 * Ngày giờ của mọi file cố định ở 01/01/1980, nên cùng một thư mục luôn ra đúng cùng một chuỗi byte —
 * và máy chủ nhận ra gói không đổi.
 */
export function zip(files) {
  const parts = [];
  const directory = [];
  let offset = 0;

  for (const { path, bytes } of files) {
    const name = Buffer.from(path, 'utf8');
    const crc = crc32(bytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // phiên bản cần để giải nén
    local.writeUInt16LE(0x0800, 6);       // tên file là UTF-8
    local.writeUInt16LE(0, 8);            // stored, không nén
    local.writeUInt16LE(0, 10);           // giờ
    local.writeUInt16LE(0x21, 12);        // ngày: 01/01/1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + bytes.length;
  }

  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, listing, end]);
}

/** Tải `widget/` lên làm widget của bot. Trả về câu trả lời của máy chủ, hoặc ném khi bị từ chối. */
export async function publishWidget({ api, token, dir = WIDGET_DIR, fetchImpl = fetch, timeout = TIMEOUT_MS }) {
  const body = zip(widgetFiles(dir));
  const response = await fetchImpl(`${api}/setWidget`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
    body,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`setWidget trả lời ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
