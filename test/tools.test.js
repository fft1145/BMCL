'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require('../src/core/tools');

function tmpDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-' + name + '-'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeGameDir(root, versions) {
  const versionsDir = path.join(root, 'versions');
  fs.mkdirSync(versionsDir, { recursive: true });
  for (const id of versions) {
    const versionDir = path.join(versionsDir, id);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, id + '.json'), JSON.stringify({ id, type: 'release' }));
  }
  return root;
}

test('isValidGameDir 只认带 versions/<id>/<id>.json 的目录', () => {
  const root = tmpDir('valid');
  assert.strictEqual(tools.isValidGameDir(root), false);
  assert.strictEqual(tools.isValidGameDir(''), false);

  const emptyVersions = tmpDir('emptyv');
  fs.mkdirSync(path.join(emptyVersions, 'versions'));
  assert.strictEqual(tools.isValidGameDir(emptyVersions), false);

  makeGameDir(root, ['1.21.3-Fabric 0.17.3']);
  assert.strictEqual(tools.isValidGameDir(root), true);
});

test('listVersionsIn 能识别中文/带空格/带点的版本名', () => {
  const root = makeGameDir(tmpDir('list'), ['1.21.3-Fabric 0.17.3', '1.20.1', '26.3']);
  const versions = tools.listVersionsIn(root);
  assert.strictEqual(versions.length, 3);
  const ids = versions.map((v) => v.id).sort();
  assert.deepStrictEqual(ids, ['1.20.1', '1.21.3-Fabric 0.17.3', '26.3']);
  assert.ok(versions.every((v) => v.type === 'release'));
});

test('scanMinecraftDirs 通过 extra 找到自定义游戏目录，并忽略空目录', () => {
  const good = makeGameDir(tmpDir('scan-good'), ['1.20.1', '1.21.1']);
  const bad = tmpDir('scan-bad');
  const found = tools.scanMinecraftDirs({ extra: [good, bad] });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].path, path.resolve(good));
  assert.strictEqual(found[0].versions, 2);
  assert.ok(found[0].sample.includes('1.20.1'));
});

test('cleanJunk 删除 logs/crash-reports 与 .part 残留', async () => {
  const root = makeGameDir(tmpDir('clean'), ['1.20.1']);
  const logs = path.join(root, 'logs');
  const crash = path.join(root, 'crash-reports');
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(crash, { recursive: true });
  fs.writeFileSync(path.join(logs, 'latest.log'), 'x'.repeat(1024));
  fs.writeFileSync(path.join(crash, 'crash-1.txt'), 'y'.repeat(512));
  const part = path.join(root, 'versions', '1.20.1', '1.20.1.jar.part');
  fs.writeFileSync(part, 'z'.repeat(256));

  const result = await tools.cleanJunk(root);
  assert.strictEqual(result.removed, 3);
  assert.ok(result.freed >= 1024 + 512 + 256);
  assert.strictEqual(fs.existsSync(path.join(logs, 'latest.log')), false);
  assert.strictEqual(fs.existsSync(part), false);
  assert.strictEqual(fs.existsSync(logs), true, '目录本身应保留');
});

test('启动计数在 userData 内持久化', () => {
  const dir = tmpDir('count');
  assert.strictEqual(tools.getLaunchCount(dir), 0);
  assert.strictEqual(tools.incrementLaunchCount(dir), 1);
  assert.strictEqual(tools.incrementLaunchCount(dir), 2);
  assert.strictEqual(tools.getLaunchCount(dir), 2);
});

test('listInstalledMods 只列 jar/zip 并按时间倒序', () => {
  const root = makeGameDir(tmpDir('mods'), ['1.20.1']);
  const mods = path.join(root, 'mods');
  fs.mkdirSync(mods);
  fs.writeFileSync(path.join(mods, 'sodium.jar'), 'a');
  fs.writeFileSync(path.join(mods, 'notes.txt'), 'b');
  fs.writeFileSync(path.join(mods, 'pack.zip'), 'c');
  const list = tools.listInstalledMods(root);
  assert.strictEqual(list.length, 2);
  assert.ok(list.every((m) => /\.(jar|zip)$/.test(m.name)));
});

test('downloadFile 拒绝非 http(s) 地址', async () => {
  await assert.rejects(() => tools.downloadFile('', '/tmp/x'), /下载地址无效/);
  await assert.rejects(() => tools.downloadFile('ftp://a/b', '/tmp/x'), /下载地址无效/);
});

test('modrinthSearch 解析命中项并带上 filters', async () => {
  let seenUrl = '';
  const fetchImpl = async (url) => {
    seenUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        hits: [{
          project_id: 'sodium',
          slug: 'sodium',
          title: 'Sodium',
          author: 'jellysquid',
          description: '渲染优化',
          downloads: 1000,
          icon_url: 'https://x/y.png',
          categories: ['optimization']
        }]
      })
    };
  };
  const hits = await tools.modrinthSearch('sodium', { gameVersion: '1.20.1', fetchImpl });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].id, 'sodium');
  assert.ok(seenUrl.includes('project_type%3Amod'));
  assert.ok(seenUrl.includes('versions%3A1.20.1'));
});
