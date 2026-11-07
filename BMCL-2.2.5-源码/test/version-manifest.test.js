'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('../src/core/version-manifest');

test('官方源不改写地址', () => {
  const url = 'https://piston-meta.mojang.com/v1/packages/abc/1.20.json';
  assert.strictEqual(vm.rewriteUrl(url, 'official'), url);
});

test('BMCLAPI 源把下载地址改写到镜像', () => {
  assert.strictEqual(
    vm.rewriteUrl('https://piston-meta.mojang.com/v1/packages/abc/1.20.json', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/v1/packages/abc/1.20.json'
  );
  assert.strictEqual(
    vm.rewriteUrl('https://resources.download.minecraft.net/ab/abcdef', 'bmclapi'),
    'https://bmclapi2.bangbang93.com/assets/ab/abcdef'
  );
});

test('rewriteVersionJson 深度重写所有下载地址且不修改原对象', () => {
  const json = {
    id: '1.20.1',
    downloads: { client: { url: 'https://launcher.mojang.com/v1/objects/abc/client.jar' } },
    libraries: [
      { name: 'a', downloads: { artifact: { url: 'https://libraries.minecraft.net/a.jar' } } }
    ]
  };
  const original = JSON.stringify(json);
  const rewritten = vm.rewriteVersionJson(json, 'bmclapi');
  assert.strictEqual(json.downloads.client.url, JSON.parse(original).downloads.client.url);
  assert.strictEqual(rewritten.downloads.client.url, 'https://bmclapi2.bangbang93.com/v1/objects/abc/client.jar');
  // libraries.minecraft.net 不在镜像规则里，保持原样
  assert.strictEqual(
    rewritten.libraries[0].downloads.artifact.url,
    'https://libraries.minecraft.net/a.jar'
  );
});

test('fetchManifest 解析清单并可查找版本', async () => {
  const payload = {
    latest: { release: '1.20.4', snapshot: '23w51b' },
    versions: [
      { id: '1.20.4', type: 'release', url: 'https://piston-meta.mojang.com/x.json', releaseTime: '2023-12-07' }
    ]
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });
  const manifest = await vm.fetchManifest({ source: 'official', fetchImpl });
  assert.strictEqual(manifest.latest.release, '1.20.4');
  assert.strictEqual(vm.findVersion(manifest, '1.20.4').type, 'release');
  assert.strictEqual(vm.latestVersionId(manifest), '1.20.4');
});

test('fetchManifest 在 HTTP 错误时抛出异常', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(vm.fetchManifest({ fetchImpl }), /HTTP 503/);
});
