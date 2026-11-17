'use strict';

const test = require('node:test');
const assert = require('node:assert');

const seasonal = require('../src/core/seasonal');
const settings = require('../src/core/settings');

test('愚人节只在中文环境启用', () => {
  const date = new Date(2026, 3, 1);
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-CN', date }).active, true);
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-TW', date }).active, true);
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-HK', date }).active, true);
  assert.strictEqual(seasonal.getInfo({ locale: 'en-US', date }).active, false);
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-CN', date: new Date(2026, 3, 2) }).active, false);
});

test('春节窗口覆盖除夕到正月初六', () => {
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-CN', date: new Date(2026, 1, 16) }).season, 'spring');
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-CN', date: new Date(2026, 1, 17) }).season, 'spring');
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-CN', date: new Date(2026, 1, 22) }).season, 'spring');
  assert.strictEqual(seasonal.getInfo({ locale: 'zh-CN', date: new Date(2026, 1, 25) }).season, '');
});

test('版本级设置合并到全局但不污染其他版本', () => {
  const base = settings.normalize({
    memoryMB: 4096,
    playerName: 'Global',
    versionSettings: {
      '1.20.1': { memoryMB: 8192, javaPath: 'D:/jdk17/bin/java.exe' }
    }
  });
  const merged = settings.forVersion(base, '1.20.1');
  assert.strictEqual(merged.memoryMB, 8192);
  assert.strictEqual(merged.playerName, 'Global');
  assert.strictEqual(merged.javaPath, 'D:/jdk17/bin/java.exe');
  const other = settings.forVersion(base, '1.19.2');
  assert.strictEqual(other.memoryMB, 4096);
  assert.strictEqual(other.javaPath, '');
  assert.strictEqual(base.memoryMB, 4096);
});

test('语言设置只接受白名单值', () => {
  assert.strictEqual(settings.normalize({ language: 'ja-JP' }).language, 'ja-JP');
  assert.strictEqual(settings.normalize({ language: 'xx-XX' }).language, 'auto');
  assert.strictEqual(settings.normalize({ language: 'auto' }).language, 'auto');
});
