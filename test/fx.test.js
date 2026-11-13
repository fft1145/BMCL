'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const settings = require('../src/core/settings');
const themes = require('../src/core/themes');
const javaScan = require('../src/core/java-scan');
const skinStore = require('../src/core/skin-store');

test('2.3.0 设置项有默认值且能被纠正', () => {
  const out = settings.normalize({
    themePreset: '不存在的主题',
    wallpaper: { type: 'video', path: 'x.mp4', dim: 9, blur: -3 },
    musicVolume: 5,
    aiBaseUrl: 'ftp://bad'
  });
  assert.strictEqual(out.themePreset, 'default');
  assert.strictEqual(out.wallpaper.type, 'video');
  assert.ok(out.wallpaper.dim <= 0.8);
  assert.ok(out.wallpaper.blur >= 0);
  assert.strictEqual(out.musicVolume, 1);
  assert.strictEqual(out.aiBaseUrl, settings.DEFAULTS.aiBaseUrl);
  assert.ok(out.customTheme.accent.startsWith('#'));
});

test('自定义主题包含全部配色字段', () => {
  const out = settings.normalize({ customTheme: { bg: '#000000', accent: 'bad-color' } });
  assert.strictEqual(out.customTheme.bg, '#000000');
  assert.strictEqual(out.customTheme.accent, settings.DEFAULTS.customTheme.accent);
});

test('主题预设都能解析出完整变量', () => {
  const presets = themes.list();
  assert.ok(presets.length >= 5);
  for (const preset of presets) {
    const vars = themes.resolve(preset.key, null);
    assert.ok(vars.vars.bg && vars.vars.text && vars.vars.accent);
  }
  const custom = themes.resolve('custom', settings.DEFAULTS.customTheme);
  assert.strictEqual(custom.vars.bg, settings.DEFAULTS.customTheme.bg);
});

test('Java 目录扫描只返回可执行文件，重复扫描按路径去重', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-java-'));
  const bin = path.join(root, 'jdk-17', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const fake = path.join(bin, process.platform === 'win32' ? 'javaw.exe' : 'java');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(fake, 0o755);
  fs.mkdirSync(path.join(root, 'empty'));
  const found = javaScan.findJavaExecutables(root);
  assert.ok(found.length >= 1);
  assert.ok(found[0].toLowerCase().includes('java'));
  const merged = javaScan.mergeScans([{ path: fake, major: 17 }], [{ path: fake, major: 17 }]);
  assert.strictEqual(merged.length, 1);
});

test('按版本需求挑选 Java', () => {
  const list = [
    { path: 'a', major: 8, ok: true },
    { path: 'b', major: 17, ok: true },
    { path: 'c', major: 21, ok: true }
  ];
  assert.strictEqual(javaScan.pickForMajor(list, 17).path, 'b');
  assert.strictEqual(javaScan.pickForMajor(list, 11).path, 'b');
  assert.strictEqual(javaScan.pickForMajor(list, 30).path, 'c');
});

test('皮肤历史保存与删除', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-skin-'));
  const png = path.join(dir, 'skin.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const item = skinStore.add(dir, png, { name: '测试皮肤', variant: 'slim' });
  assert.ok(fs.existsSync(item.file));
  assert.strictEqual(skinStore.list(dir).length, 1);
  assert.strictEqual(skinStore.get(dir, item.id).name, '测试皮肤');
  skinStore.remove(dir, item.id);
  assert.strictEqual(skinStore.list(dir).length, 0);
});
