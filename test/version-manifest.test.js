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

test('fetchManifest 主源失败时自动回退备用源', async () => {
  const payload = {
    latest: { release: '1.20.4' },
    versions: [{ id: '1.20.4', type: 'release', url: 'https://piston-meta.mojang.com/x.json' }]
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('bmclapi2')) throw new Error('fetch failed');
    return { ok: true, status: 200, json: async () => payload };
  };
  const manifest = await vm.fetchManifest({ source: 'bmclapi', fetchImpl });
  assert.strictEqual(manifest.source, 'official');
  assert.strictEqual(manifest.usedFallback, true);
});

test('fetchVersionJson 返回 json 与实际使用的源，主源失败时回退', async () => {
  const json = {
    id: '1.20.4',
    downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/abc/client.jar' } }
  };
  const version = { id: '1.20.4', url: 'https://piston-meta.mojang.com/v1/packages/x/1.20.4.json' };
  const fetchImpl = async (url) => {
    if (String(url).includes('bmclapi2')) throw new Error('fetch failed');
    return { ok: true, status: 200, json: async () => json };
  };
  const r = await vm.fetchVersionJson(version, { source: 'bmclapi', fetchImpl });
  assert.strictEqual(r.source, 'official');
  assert.strictEqual(r.usedFallback, true);
  assert.strictEqual(r.json.downloads.client.url, json.downloads.client.url);
});

test('candidateUrls 同时给出主地址与镜像地址', () => {
  assert.deepStrictEqual(
    vm.candidateUrls('https://piston-data.mojang.com/v1/objects/abc/client.jar', 'official'),
    [
      'https://piston-data.mojang.com/v1/objects/abc/client.jar',
      'https://bmclapi2.bangbang93.com/v1/objects/abc/client.jar'
    ]
  );
  assert.deepStrictEqual(
    vm.candidateUrls('https://bmclapi2.bangbang93.com/v1/objects/abc/client.jar', 'bmclapi'),
    [
      'https://bmclapi2.bangbang93.com/v1/objects/abc/client.jar',
      'https://piston-data.mojang.com/v1/objects/abc/client.jar'
    ]
  );
  assert.deepStrictEqual(
    vm.candidateUrls('https://bmclapi2.bangbang93.com/assets/ab/cdef', 'bmclapi'),
    [
      'https://bmclapi2.bangbang93.com/assets/ab/cdef',
      'https://resources.download.minecraft.net/ab/cdef'
    ]
  );
  // 不参与镜像的地址只保留一个，避免重复尝试
  assert.strictEqual(vm.candidateUrls('https://libraries.minecraft.net/x.jar', 'official').length, 1);
});
