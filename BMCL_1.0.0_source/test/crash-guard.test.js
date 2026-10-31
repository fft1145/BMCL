'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crash = require('../src/core/crash-guard');

test('启动器异常退出检测', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-crash-')), 'session.json');
  crash.markSessionStart(file, { version: '1.0.0' });
  const detected = crash.detectPreviousCrash(file);
  assert.strictEqual(detected.crashed, true);

  crash.markSessionEnd(file);
  const clean = crash.detectPreviousCrash(file);
  assert.strictEqual(clean.crashed, false);
});

test('parseCrashReport 提取描述与 Caused by', () => {
  const report = [
    '# There is a problem with your game',
    'Description: Updating screen events',
    '',
    'java.lang.NullPointerException: Cannot invoke ...',
    '  at net.minecraft.client.Minecraft.tick(Minecraft.java:123)',
    'Caused by: java.lang.OutOfMemoryError: Java heap space'
  ].join('\n');
  const parsed = crash.parseCrashReport(report);
  assert.strictEqual(parsed.description, 'Updating screen events');
  assert.ok(parsed.causes[0].includes('OutOfMemoryError'));
  assert.ok(parsed.stack[0].includes('Minecraft.tick'));
});

test('diagnose 识别内存不足', () => {
  const result = crash.diagnose({
    crashReport: 'Description: Rendering overlay\nCaused by: java.lang.OutOfMemoryError: Java heap space',
    latestLog: '[main/ERROR]: java.lang.OutOfMemoryError: Java heap space'
  });
  assert.strictEqual(result.causes[0].cause, '内存不足');
  assert.ok(result.causes[0].suggestion.includes('内存'));
});

test('diagnose 识别 Java 版本不匹配与驱动问题', () => {
  const javaResult = crash.diagnose({
    latestLog: 'java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version'
  });
  assert.ok(javaResult.causes.some((c) => c.cause === 'Java 版本不匹配'));

  const glResult = crash.diagnose({
    latestLog: '[Render thread/ERROR]: GLFW error 65542: WGL: The driver does not appear to support OpenGL'
  });
  assert.ok(glResult.causes.some((c) => c.cause === '显卡 / OpenGL 驱动问题'));
});

test('diagnoseGameDir 读取 latest.log 与崩溃报告', () => {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-game-'));
  fs.mkdirSync(path.join(gameDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'logs', 'latest.log'), 'java.lang.OutOfMemoryError: Java heap space');
  const result = crash.diagnoseGameDir(gameDir, { exitCode: 1 });
  assert.strictEqual(result.exitCode, 1);
  assert.ok(result.summary.includes('内存不足'));
});
