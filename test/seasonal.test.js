'use strict';

const test = require('node:test');
const assert = require('node:assert');

const seasonal = require('../src/core/seasonal');
const settings = require('../src/core/settings');

test('4 月 1 日自动识别愚人节', () => {
  const festival = seasonal.resolveFestival('auto', new Date(2026, 3, 1, 10, 0, 0));
  assert.strictEqual(festival.id, 'april');
  assert.strictEqual(festival.active, true);
  assert.ok(festival.toasts.length > 0);
  assert.ok(festival.bugs.length > 0);
  assert.ok(festival.tribute.includes('81192'));
});

test('自动模式先检测地区，只有中文环境触发', () => {
  const day = new Date(2026, 3, 1, 10, 0, 0);
  assert.strictEqual(seasonal.resolveFestival('auto', day, 'zh-CN').id, 'april');
  assert.strictEqual(seasonal.resolveFestival('auto', day, 'zh-TW').id, 'april');
  assert.strictEqual(seasonal.resolveFestival('auto', day, 'zh-HK').id, 'april');
  assert.strictEqual(seasonal.resolveFestival('auto', day, 'en-US').active, false);
  assert.strictEqual(seasonal.resolveFestival('auto', day, 'ja-JP').active, false);
  // 手动指定时不受地区限制
  assert.strictEqual(seasonal.resolveFestival('april', day, 'en-US').id, 'april');
});

test('春节窗口覆盖除夕到正月十五', () => {
  const newYearEve = seasonal.resolveFestival('auto', new Date(2026, 1, 16, 12, 0, 0), 'zh-CN');
  assert.strictEqual(newYearEve.id, 'spring');
  const lastDay = seasonal.resolveFestival('auto', new Date(2026, 2, 3, 12, 0, 0), 'zh-CN');
  assert.strictEqual(lastDay.id, 'spring');
  const normalDay = seasonal.resolveFestival('auto', new Date(2026, 5, 1, 12, 0, 0), 'zh-CN');
  assert.strictEqual(normalDay.id, '');
  assert.strictEqual(seasonal.resolveFestival('auto', new Date(2026, 1, 17, 12, 0, 0), 'en-US').active, false);
});

test('手动指定节日与关闭', () => {
  assert.strictEqual(seasonal.resolveFestival('april', new Date(2026, 9, 1)).id, 'april');
  assert.strictEqual(seasonal.resolveFestival('spring', new Date(2026, 9, 1)).id, 'spring');
  assert.strictEqual(seasonal.resolveFestival('off', new Date(2026, 3, 1)).active, false);
  assert.strictEqual(seasonal.resolveFestival('auto', new Date(2026, 9, 1)).active, false);
});

test('春节祝福语按天轮换且不为空', () => {
  const a = seasonal.resolveFestival('spring', new Date(2026, 1, 17));
  const b = seasonal.resolveFestival('spring', new Date(2026, 1, 18));
  assert.ok(a.greeting.length > 0);
  assert.strictEqual(a.greetings.length, seasonal.GREETINGS.length);
  assert.notStrictEqual(a.greeting, b.greeting);
  assert.ok(a.videoUrl.includes('bilibili.com'));
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

test('语言与节日设置只接受白名单值', () => {
  assert.strictEqual(settings.normalize({ language: 'ja-JP' }).language, 'ja-JP');
  assert.strictEqual(settings.normalize({ language: 'xx-XX' }).language, 'auto');
  assert.strictEqual(settings.normalize({ language: 'auto' }).language, 'auto');
  assert.strictEqual(settings.normalize({ festivalMode: 'april' }).festivalMode, 'april');
  assert.strictEqual(settings.normalize({ festivalMode: 'nope' }).festivalMode, 'auto');
});
