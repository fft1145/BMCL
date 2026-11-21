'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const java = require('../src/core/java');
const javaDownload = require('../src/core/java-download');

function makeJdk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-jdk-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const exe = path.join(bin, process.platform === 'win32' ? 'java.exe' : 'java');
  fs.writeFileSync(exe, '');
  return { root, bin, exe };
}

test('parseJavaVersion 识别常见版本格式', () => {
  assert.deepStrictEqual(java.parseJavaVersion('openjdk version "21.0.1" 2024-10-15'), { version: '21.0.1', major: 21 });
  assert.deepStrictEqual(java.parseJavaVersion('java version "1.8.0_381"'), { version: '1.8.0_381', major: 8 });
  assert.strictEqual(java.parseJavaVersion('not java').major, 0);
});

test('resolveJavaExecutable：安装目录自动进入 bin 查找', () => {
  const jdk = makeJdk();
  assert.strictEqual(java.resolveJavaExecutable(jdk.root), jdk.exe);
  assert.strictEqual(java.resolveJavaExecutable(jdk.bin), jdk.exe);
  assert.strictEqual(java.resolveJavaExecutable(jdk.exe), jdk.exe);
  assert.strictEqual(java.resolveJavaExecutable(jdk.root + path.sep), jdk.exe);
});

test('resolveJavaExecutable：留空回落到系统 PATH', () => {
  assert.strictEqual(java.resolveJavaExecutable(''), 'java');
  assert.strictEqual(java.resolveJavaExecutable('   '), 'java');
  assert.strictEqual(java.resolveJavaExecutable('/no/such/java-path'), '/no/such/java-path');
});

test('probeJava 使用归一化后的可执行文件', async () => {
  const jdk = makeJdk();
  let seen = '';
  const result = await java.probeJava(jdk.root, (target, args, opts, cb) => {
    seen = target;
    cb(null, '', 'openjdk version "17.0.9" 2023-10-17');
  });
  assert.strictEqual(seen, jdk.exe);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.javaPath, jdk.exe);
  assert.strictEqual(result.major, 17);
});

test('pickRuntimeForMajor：优先完全一致，其次更高的版本', () => {
  const runtimes = [
    { name: 'jre-legacy', label: 'Java 8', version: '1.8.0_74' },
    { name: 'java-runtime-alpha', label: 'Java 16', version: '16.0.1' },
    { name: 'java-runtime-beta', label: 'Java 17', version: '17.0.1' },
    { name: 'java-runtime-gamma', label: 'Java 17', version: '17.0.8' },
    { name: 'java-runtime-delta', label: 'Java 21', version: '21.0.3' }
  ];
  assert.strictEqual(javaDownload.pickRuntimeForMajor(runtimes, 21).name, 'java-runtime-delta');
  assert.strictEqual(javaDownload.pickRuntimeForMajor(runtimes, 8).name, 'jre-legacy');
  assert.strictEqual(javaDownload.pickRuntimeForMajor(runtimes, 22), null);
  assert.strictEqual(javaDownload.pickRuntimeForMajor([], 17), null);
});

test('runtimeMajor 解析运行时版本号', () => {
  assert.strictEqual(javaDownload.runtimeMajor({ version: '1.8.0_74' }), 8);
  assert.strictEqual(javaDownload.runtimeMajor({ version: '21.0.3' }), 21);
  assert.strictEqual(javaDownload.runtimeMajor({}), 0);
});
