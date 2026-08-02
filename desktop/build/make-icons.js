// Rasterises build/logo.svg into the PNGs the app needs and packs them into
// a multi-resolution Windows .ico.
//
//   npx electron build/make-icons.js
//
// Uses Electron's own renderer, so there's no image-processing dependency.
// ICO entries are PNG-compressed, which Windows has supported since Vista.
//
// One window is created and loaded once, then resized per size — creating a
// fresh window per size intermittently fails with ERR_FAILED.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = __dirname;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function writePage() {
  const svg = fs.readFileSync(path.join(BUILD, 'logo.svg'), 'utf8');
  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    'svg{display:block;width:100vw;height:100vh}</style>' +
    svg;
  const file = path.join(BUILD, '_icon.html');
  fs.writeFileSync(file, html);
  return file;
}

// ICO container: 6-byte header, then one 16-byte directory entry per image,
// then the image payloads.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const at = i * 16;
    const dim = e.size >= 256 ? 0 : e.size; // 0 encodes 256
    dir.writeUInt8(dim, at + 0);
    dir.writeUInt8(dim, at + 1);
    dir.writeUInt8(0, at + 2); // palette entries
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  const file = writePage();
  const max = Math.max(...SIZES);
  const win = new BrowserWindow({
    width: max,
    height: max,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
  });
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 400));

  const entries = [];
  for (const size of SIZES) {
    win.setContentSize(size, size);
    await new Promise((r) => setTimeout(r, 260));
    const png = (await win.webContents.capturePage()).toPNG();
    entries.push({ size, png });
    fs.writeFileSync(path.join(BUILD, `icon-${size}.png`), png);
  }

  fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(entries));
  fs.unlinkSync(file);
  console.log(`wrote icon.ico (${SIZES.join(', ')}) + ${SIZES.length} PNGs`);
  win.destroy();
  app.quit();
});
