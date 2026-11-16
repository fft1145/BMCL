'use strict';

const test = require('node:test');
const assert = require('node:assert');
const seasonal = require('../src/core/seasonal');

test('4 月 1 日自动识别愚人节', () => {
  const festival = seasonal.resolveFestival('auto', new Date(2026, 3, 1, 10, 0, 0));
  assert.strictEqual(festival.id, 'april');
  assert.strictEqual(festival.active, true);
  assert.ok(festival.toasts.length > 0);
  assert.ok(festival.bugs.length > 0);
});

test('春节窗口覆盖除夕到正月十五', () => {
  const newYearEve = seasonal.resolveFestival('auto', new Date(2026, 1, 16, 12, 0, 0));
  assert.strictEqual(newYearEve.id, 'spring');
  const lastDay = seasonal.resolveFestival('auto', new Date(2026, 2, 3, 12, 0, 0));
  assert.strictEqual(lastDay.id, 'spring');
  const normalDay = seasonal.resolveFestival('auto', new Date(2026, 5, 1, 12, 0, 0));
  assert.strictEqual(normalDay.id, '');
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
});
