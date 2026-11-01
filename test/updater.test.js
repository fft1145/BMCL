'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updater = require('../src/core/updater');

test('更新白名单只允许启动器文件', () => {
  assert.strictEqual(updater.isPathAllowedForUpdate('main.js'), true);
  assert.strictEqual(updater.isPathAllowedForUpdate('renderer/app.js'), true);
  assert.strictEqual(updater.isPathAllowedForUpdate('src/core/launcher.js'), true);
  assert.strictEqual(updater.isPathAllowedForUpdate('launcher-version.json'), true);

  const forbidden = [
    'saves/level.dat',
    '.minecraft/options.txt',
    'options.txt',
    'mods/foo.jar',
    'versions/1.20.1/1.20.1.jar',
    'libraries/com/a.jar',
    'assets/objects/ab/cd',
    'logs/latest.log',
    'crash-reports/crash-1.txt',
    '../../Windows/system32/evil.dll',
    '/etc/passwd',
    'renderer/../../saves/x'
  ];
  for (const p of forbidden) {
    assert.strictEqual(updater.isPathAllowedForUpdate(p), false, '应拒绝 ' + p);
  }
});

test('版本号比较', () => {
  assert.strictEqual(updater.compareVersions('1.2.3', '1.2.2'), 1);
  assert.strictEqual(updater.compareVersions('v1.2.0', '1.2.0'), 0);
  assert.strictEqual(updater.compareVersions('1.0.1', '1.1'), -1);
  assert.strictEqual(updater.compareVersions('1.10', '1.9'), 1);
});

test('parseRelease 与 findUpdateAsset', () => {
  const release = updater.parseRelease({
    tag_name: 'v1.2.0',
    name: 'BMCL 1.2.0',
    body: 'notes',
    html_url: 'https://github.com/fft1145/BMCL/releases/tag/v1.2.0',
    assets: [{ name: 'fft1145-1.2.0-win.zip', browser_download_url: 'https://x/a.zip' }]
  });
  assert.strictEqual(release.version, '1.2.0');
  assert.strictEqual(updater.findUpdateAsset(release.assets).name, 'fft1145-1.2.0-win.zip');
});

test('findUpdateAsset 优先固定名 exe，其次兼容旧 exe / zip', () => {
  const fixed = updater.findUpdateAsset([
    { name: 'fft1145-1.2.0-portable.exe', url: 'https://x/old.exe' },
    { name: 'fft1145-portable.exe', url: 'https://x/fixed.exe' }
  ]);
  assert.strictEqual(fixed.name, 'fft1145-portable.exe');

  const legacyExe = updater.findUpdateAsset([
    { name: 'fft1145-1.1.0-portable.exe', url: 'https://x/legacy.exe' }
  ]);
  assert.strictEqual(legacyExe.name, 'fft1145-1.1.0-portable.exe');

  const zipOnly = updater.findUpdateAsset([
    { name: 'fft1145-1.0.0-win.zip', url: 'https://x/old.zip' }
  ]);
  assert.strictEqual(zipOnly.name, 'fft1145-1.0.0-win.zip');
});

test('checkForUpdate 发现更高版本', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tag_name: 'v1.3.0',
      html_url: 'https://github.com/fft1145/BMCL/releases/tag/v1.3.0',
      body: '',
      assets: [{ name: 'fft1145-1.3.0-win.zip', browser_download_url: 'https://x/1.3.zip' }]
    })
  });
  const result = await updater.checkForUpdate({ currentVersion: '1.2.0', fetchImpl });
  assert.strictEqual(result.hasUpdate, true);
  assert.strictEqual(result.asset.url, 'https://x/1.3.zip');

  const same = await updater.checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.strictEqual(same.hasUpdate, false);
});

test('validateUpdateTree 拒绝包含游戏文件的更新包', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-up-'));
  fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'saves'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'renderer', 'app.js'), 'ok');
  fs.writeFileSync(path.join(dir, 'main.js'), 'ok');
  fs.writeFileSync(path.join(dir, 'saves', 'level.dat'), 'game data');

  const audit = updater.validateUpdateTree(dir);
  assert.strictEqual(audit.ok, false);
  assert.deepStrictEqual(audit.blocked, ['saves/level.dat']);
});

test('applyUpdateTree 在校验失败时整次中止', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-src-'));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-app-'));
  fs.writeFileSync(path.join(src, 'main.js'), 'new');
  fs.mkdirSync(path.join(src, 'saves'), { recursive: true });
  fs.writeFileSync(path.join(src, 'saves', 'level.dat'), 'evil');
  fs.writeFileSync(path.join(appDir, 'main.js'), 'old');

  await assert.rejects(updater.applyUpdateTree(src, appDir), /更新被拒绝/);
  assert.strictEqual(fs.readFileSync(path.join(appDir, 'main.js'), 'utf8'), 'old', '更新中止后原文件不能被修改');
});

test('applyUpdateTree 正常覆盖启动器文件', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-src-ok-'));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-app-ok-'));
  fs.writeFileSync(path.join(src, 'main.js'), 'new');
  fs.mkdirSync(path.join(src, 'renderer'), { recursive: true });
  fs.writeFileSync(path.join(src, 'renderer', 'app.js'), 'new app');
  fs.writeFileSync(path.join(appDir, 'main.js'), 'old');

  const result = await updater.applyUpdateTree(src, appDir);
  assert.strictEqual(result.updated, 2);
  assert.strictEqual(fs.readFileSync(path.join(appDir, 'main.js'), 'utf8'), 'new');
});

test('checkDownloadAllowed：网络异常判定为被禁止，正常响应判定为可用', async () => {
  const failFetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const blocked = await updater.checkDownloadAllowed({ fetchImpl: failFetch, urls: ['https://x'] });
  assert.strictEqual(blocked.allowed, false);

  const okFetch = async () => ({ status: 200 });
  const allowed = await updater.checkDownloadAllowed({ fetchImpl: okFetch, urls: ['https://x'] });
  assert.strictEqual(allowed.allowed, true);
});
