'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectContext, isAllowed, ruleMatches } = require('../src/core/rules');

const winCtx = { os: { name: 'windows', arch: 'x86_64', version: '10.0' }, features: {} };
const linuxCtx = { os: { name: 'linux', arch: 'x86_64', version: '6.0' }, features: {} };

test('没有 rules 时默认允许', () => {
  assert.strictEqual(isAllowed(undefined, winCtx), true);
  assert.strictEqual(isAllowed([], winCtx), true);
});

test('allow windows 规则只在 Windows 生效', () => {
  const rules = [{ action: 'allow', os: { name: 'windows' } }];
  assert.strictEqual(isAllowed(rules, winCtx), true);
  assert.strictEqual(isAllowed(rules, linuxCtx), false);
});

test('disallow 规则优先于前面的 allow', () => {
  const rules = [
    { action: 'allow' },
    { action: 'disallow', os: { name: 'linux' } }
  ];
  assert.strictEqual(isAllowed(rules, winCtx), true);
  assert.strictEqual(isAllowed(rules, linuxCtx), false);
});

test('features 规则按布尔值匹配', () => {
  const ctx = { os: winCtx.os, features: { has_custom_resolution: true } };
  assert.strictEqual(ruleMatches({ action: 'allow', features: { has_custom_resolution: true } }, ctx), true);
  assert.strictEqual(ruleMatches({ action: 'allow', features: { has_custom_resolution: false } }, ctx), false);
});

test('detectContext 把平台映射为 Mojang 名称', () => {
  assert.strictEqual(detectContext('win32', 'x64').os.name, 'windows');
  assert.strictEqual(detectContext('darwin', 'arm64').os.name, 'osx');
  assert.strictEqual(detectContext('linux', 'x64').os.arch, 'x86_64');
});
