'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const installer = require('../src/core/installer');

const sample = {
  id: '1.20.1',
  downloads: {
    client: { url: 'https://x/client.jar', sha1: 'aaa', size: 100 }
  },
  assetIndex: { id: '5', url: 'https://x/index.json', sha1: 'bbb', size: 20 },
  libraries: [
    {
      name: 'com.example:demo:1.0',
      downloads: { artifact: { url: 'https://x/demo.jar', path: 'com/example/demo/1.0/demo-1.0.jar', sha1: 'ccc', size: 10 } }
    },
    {
      name: 'org.lwjgl:lwjgl:3.3.1:natives-windows',
      rules: [{ action: 'allow', os: { name: 'windows' } }],
      downloads: { artifact: { url: 'https://x/native-win.jar', path: 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar', sha1: 'ddd', size: 5 } }
    }
  ]
};

function options(platform) {
  return {
    platform,
    arch: 'x64',
    versionsDir: '/tmp/v',
    librariesDir: '/tmp/l',
    assetsDir: '/tmp/a',
    source: 'official'
  };
}

test('buildDownloadPlan 生成客户端、库、资源索引', () => {
  const plan = installer.buildDownloadPlan(sample, options('linux'));
  assert.strictEqual(plan.files.length, 3); // client + 官方库 + asset index，Windows 原生库被规则排除
  assert.ok(plan.files.some((f) => f.kind === 'client'));
  assert.ok(plan.files.some((f) => f.kind === 'asset-index'));
  assert.ok(plan.files.every((f) => f.path.replace(/\\/g, '/').startsWith('/tmp/')));
});

test('buildDownloadPlan 在 Windows 上包含 natives 库', () => {
  const plan = installer.buildDownloadPlan(sample, options('win32'));
  assert.strictEqual(plan.files.length, 4);
  assert.ok(plan.files.some((f) => f.path.includes('natives-windows')));
});

test('buildAssetPlan 按哈希目录生成下载地址', () => {
  const index = {
    objects: {
      'minecraft/sounds/a.ogg': { hash: 'abcd1234', size: 7 }
    }
  };
  const plan = installer.buildAssetPlan(index, { assetsDir: '/tmp/a', source: 'bmclapi' });
  assert.strictEqual(plan.files.length, 1);
  assert.strictEqual(plan.files[0].url, 'https://bmclapi2.bangbang93.com/assets/ab/abcd1234');
  assert.strictEqual(plan.files[0].path, path.join('/tmp/a', 'objects', 'ab', 'abcd1234'));
});

test('downloadFile 写入文件并校验 sha1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-dl-'));
  const body = Buffer.from('hello world');
  const sha1 = crypto.createHash('sha1').update(body).digest('hex');
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  });
  const file = { url: 'https://x/hello', path: path.join(dir, 'hello.txt'), sha1 };
  const result = await installer.downloadFile(file, { fetchImpl });
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(fs.readFileSync(file.path, 'utf8'), 'hello world');

  const again = await installer.downloadFile(file, { fetchImpl });
  assert.strictEqual(again.skipped, true);
});

test('downloadFile 校验失败时报错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-dl-bad-'));
  const body = Buffer.from('tampered');
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  });
  await assert.rejects(
    installer.downloadFile({ url: 'https://x', path: path.join(dir, 'a.bin'), sha1: '0000' }, { fetchImpl }),
    /校验失败/
  );
});
