const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const resourcesDirectory = path.join(__dirname, '..', 'resources');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngSize(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), pngSignature);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('cream D icon source and exported PNG use the approved colors and size', () => {
  const svg = fs.readFileSync(
    path.join(resourcesDirectory, 'icon.svg'),
    'utf8',
  );
  const png = fs.readFileSync(path.join(resourcesDirectory, 'icon.png'));
  assert.match(svg, /#F8F6F1/);
  assert.match(svg, /#E8D9C4/);
  assert.match(svg, /#3C3935/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.deepEqual(readPngSize(png), { width: 1024, height: 1024 });
});

test('Windows ICO exports contain readable 16px and 32px PNG images', () => {
  const iconPath = path.join(resourcesDirectory, 'icon.ico');
  const icon = fs.readFileSync(iconPath);
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const count = icon.readUInt16LE(4);
  const dimensions = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + 16 * index;
    const width = icon[entry] || 256;
    const height = icon[entry + 1] || 256;
    const byteLength = icon.readUInt32LE(entry + 8);
    const offset = icon.readUInt32LE(entry + 12);
    assert.deepEqual(readPngSize(icon.subarray(offset, offset + byteLength)), {
      width,
      height,
    });
    dimensions.push(width);
  }
  assert.ok(dimensions.includes(16));
  assert.ok(dimensions.includes(32));
  assert.deepEqual(
    icon,
    fs.readFileSync(path.join(resourcesDirectory, 'daybyday-tray.ico')),
  );
});

test('macOS ICNS has a valid container and all standard Retina image sizes', () => {
  const icon = fs.readFileSync(path.join(resourcesDirectory, 'icon.icns'));
  assert.equal(icon.toString('ascii', 0, 4), 'icns');
  assert.equal(icon.readUInt32BE(4), icon.length);
  const foundSizes = [];
  let offset = 8;
  while (offset < icon.length) {
    const type = icon.toString('ascii', offset, offset + 4);
    const chunkLength = icon.readUInt32BE(offset + 4);
    assert.ok(chunkLength >= 8);
    const png = icon.subarray(offset + 8, offset + chunkLength);
    foundSizes.push(readPngSize(png).width);
    offset += chunkLength;
    assert.ok(type.startsWith('ic'));
  }
  assert.equal(offset, icon.length);
  for (const size of [16, 32, 64, 128, 256, 512, 1024])
    assert.ok(foundSizes.includes(size));
});

test('Settings uses a live 80-to-130 percent slider and reset button', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'App.tsx'),
    'utf8',
  );
  assert.match(source, /max=\{130\}/);
  assert.match(source, /min=\{80\}/);
  assert.match(source, /step=\{5\}/);
  assert.match(source, /Math\.round\(fontSizeScale \* 100\)/);
  assert.match(source, /t\('Reset'\)/);
  assert.match(source, /'--font-scale': fontSizeScale/);
});
