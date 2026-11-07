'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repair = require('../src/core/repair');
const crash = require('../src/core/crash-guard');

function makeCtx(overrides = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-repair-'));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-app-'));
  for (const rel of ['main.js', 'preload.js', 'renderer/index.html']) {
    fs.mkdirSync(path.dirname(path.join(appDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(appDir, rel), 'ok');
  }
  fs.mkdirSync(path.join(appDir, 'src/core'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'src/core/launcher.js'), 'ok');

  const settingsFile = path.join(userDataDir, 'settings.json');
  const sessionFile = path.join(userDataDir, 'session.json');
  return Object.assign({
    userDataDir,
    appDir,
    settingsFile,
    sessionFile,
    gameDir: path.join(userDataDir, 'game')
  }, overrides);
}

test('健康环境：扫描通过且无需修复', () => {
  const ctx = makeCtx();
  fs.mkdirSync(ctx.gameDir, { recursive: true });
  fs.writeFileSync(ctx.settingsFile, JSON.stringify({
    memoryMB: 2048, source: 'bmclapi', javaPath: '', gameDir: ctx.gameDir, versionId: ''
  }));
  const report = repair.scan(ctx);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.needFix, false);

  const result = repair.repair(ctx);
  assert.strictEqual(result.fixed, 0);
  assert.strictEqual(result.failed, 0);
});

test('配置文件损坏：修复后可用默认配置重建', () => {
  const ctx = makeCtx();
  fs.writeFileSync(ctx.settingsFile, '{ this is broken');
  const before = repair.scan(ctx);
  assert.strictEqual(before.needFix, true);

  const result = repair.repair(ctx);
  assert.ok(result.fixed >= 1);
  const saved = JSON.parse(fs.readFileSync(ctx.settingsFile, 'utf8'));
  assert.strictEqual(saved.source, 'bmclapi');
  assert.strictEqual(saved.memoryMB, 2048);
});

test('内存与下载源越界：修复时归一为合法值', () => {
  const ctx = makeCtx();
  fs.writeFileSync(ctx.settingsFile, JSON.stringify({ memoryMB: 999999, source: 'wtf' }));
  repair.repair(ctx);
  const saved = JSON.parse(fs.readFileSync(ctx.settingsFile, 'utf8'));
  assert.strictEqual(saved.memoryMB, 32768);
  assert.strictEqual(saved.source, 'bmclapi');
});

test('Java 路径失效：清空并改为自动探测', () => {
  const ctx = makeCtx();
  fs.writeFileSync(ctx.settingsFile, JSON.stringify({ javaPath: '/no/such/java', memoryMB: 2048 }));
  const before = repair.scan(ctx);
  const javaItem = before.issues.find((i) => i.id === 'java-path');
  assert.strictEqual(javaItem.status, repair.STATUS.SKIP);

  repair.repair(ctx);
  const saved = JSON.parse(fs.readFileSync(ctx.settingsFile, 'utf8'));
  assert.strictEqual(saved.javaPath, '');
});

test('版本选择失效：清空选择但不动各类游戏目录', () => {
  const ctx = makeCtx();
  fs.mkdirSync(ctx.gameDir, { recursive: true });
  // 另一个真实存在的版本目录，确保不会被误删
  const keepVersion = path.join(ctx.gameDir, 'versions', '1.20.1');
  fs.mkdirSync(keepVersion, { recursive: true });
  fs.writeFileSync(path.join(keepVersion, '1.20.1.json'), '{}');

  fs.writeFileSync(ctx.settingsFile, JSON.stringify({ versionId: '1.19.0', memoryMB: 2048 }));
  repair.repair(ctx);

  const saved = JSON.parse(fs.readFileSync(ctx.settingsFile, 'utf8'));
  assert.strictEqual(saved.versionId, '');
  assert.ok(fs.existsSync(keepVersion), '不得删除游戏版本目录');
});

test('会话残留与临时文件：修复后清理干净', () => {
  const ctx = makeCtx();
  fs.writeFileSync(ctx.settingsFile, JSON.stringify({ memoryMB: 2048 }));
  crash.markSessionStart(ctx.sessionFile, { version: '1.0.1' });
  fs.mkdirSync(path.join(ctx.userDataDir, 'update-tmp'), { recursive: true });
  fs.writeFileSync(path.join(ctx.userDataDir, '.write-test'), 'ok');

  repair.repair(ctx);

  assert.strictEqual(crash.detectPreviousCrash(ctx.sessionFile).crashed, false);
  assert.ok(!fs.existsSync(path.join(ctx.userDataDir, 'update-tmp')));
  assert.ok(!fs.existsSync(path.join(ctx.userDataDir, '.write-test')));
});

test('超大日志：归档为 latest.old.log 并重建空日志', () => {
  const ctx = makeCtx();
  fs.writeFileSync(ctx.settingsFile, JSON.stringify({ memoryMB: 2048 }));
  const big = path.join(ctx.userDataDir, 'latest.log');
  fs.writeFileSync(big, 'x'.repeat(9 * 1024 * 1024));

  repair.repair(ctx);

  assert.ok(fs.existsSync(path.join(ctx.userDataDir, 'latest.old.log')));
  assert.strictEqual(fs.statSync(big).size, 0);
});

test('程序文件缺失：标记为无法自动修复', () => {
  const ctx = makeCtx();
  fs.rmSync(path.join(ctx.appDir, 'main.js'));
  const result = repair.repair(ctx);
  const appItem = result.issues.find((i) => i.id === 'app-files');
  assert.strictEqual(appItem.status, repair.STATUS.FAIL);
  assert.strictEqual(result.ok, false);
});
