'use strict';

const test = require('node:test');
const assert = require('node:assert');
const terracotta = require('../src/core/terracotta');

test('生成的大厅编号可以解析回原端口', () => {
  for (const port of [100, 25565, 54321, 65535]) {
    const code = terracotta.generateRoomCode(port);
    assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
    const parsed = terracotta.parseRoomCode(code);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.port, port);
    assert.equal(parsed.code, code);
  }
});

test('解析时忽略大小写和前后文本', () => {
  const code = terracotta.generateRoomCode(25566);
  const parsed = terracotta.parseRoomCode('大厅编号：' + code.toLowerCase());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.port, 25566);
});

test('校验位错误会被拒绝', () => {
  const code = terracotta.generateRoomCode(25567);
  const raw = code.replace(/-/g, '');
  const index = terracotta.ALPHABET.indexOf(raw[24]);
  const badRaw = raw.slice(0, 24) + terracotta.ALPHABET[(index + 1) % 34];
  const bad = badRaw.match(/.{5}/g).join('-');
  const parsed = terracotta.parseRoomCode(bad);
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /校验失败/);
});

test('格式错误会被拒绝', () => {
  for (const input of ['', 'ABC', '12345-12345-12345-12345']) {
    const parsed = terracotta.parseRoomCode(input);
    assert.equal(parsed.ok, false);
  }
});

test('加入参数包含端口转发与陶瓦网络名', () => {
  const room = terracotta.parseRoomCode(terracotta.generateRoomCode(25565));
  const args = terracotta.buildJoinArgs(room, 30000, 30001, 'Steve', 'machine');
  assert.ok(args.includes('--network-name=terracotta-mc-' + room.networkName));
  assert.ok(args.includes('--network-secret=' + room.networkSecret));
  assert.ok(args.includes('--port-forward=tcp://127.0.0.1:30000/10.144.144.1:25565'));
  assert.ok(args.includes('--port-forward=udp://127.0.0.1:30000/10.144.144.1:25565'));
  assert.ok(args.includes('--hostname=J|Steve'));
  assert.ok(args.includes('--machine-id=machine'));
});

test('创建参数包含虚拟 IP 与端口白名单', () => {
  const args = terracotta.buildHostArgs(25565, 'abcdefghijklmno', 'abcdefghi', 30001, 'Steve', 'machine');
  assert.ok(args.includes('--network-name=terracotta-mc-abcdefghijklmno'));
  assert.ok(args.includes('--network-secret=abcdefghi'));
  assert.ok(args.includes('--tcp-whitelist=25565'));
  assert.ok(args.includes('--udp-whitelist=25565'));
  assert.ok(args.includes('-i'));
  assert.ok(args.includes('10.144.144.1'));
  assert.ok(args.includes('--hostname=H|Steve'));
});

test('非法端口无法生成编号', () => {
  assert.throws(() => terracotta.generateRoomCode(99), /端口/);
  assert.throws(() => terracotta.generateRoomCode(70000), /端口/);
  assert.throws(() => terracotta.generateRoomCode('abc'), /端口/);
});
