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

test('instanceDir：隔离所有实例时返回 versions/<版本>', () => {
  assert.strictEqual(tools.instanceDir('/g', '1.21.3', 'all'), path.join('/g', 'versions', '1.21.3'));
  assert.strictEqual(tools.instanceDir('/g', '1.21.3', 'off'), '/g');
  assert.strictEqual(tools.instanceDir('/g', '1.21.3', 'version'), '/g');
  assert.strictEqual(tools.instanceDir('/g', '', 'all'), '/g');
});

test('isValidGameDir 要求目录内至少有一个可识别版本', () => {
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

test('玩家可以直接指定 versions 目录或单个版本目录', () => {
  const root = makeGameDir(tmpDir('custom'), ['1.20.1', '1.21.4']);
  const versionsDir = path.join(root, 'versions');
  const oneVersion = path.join(versionsDir, '1.20.1');

  assert.strictEqual(tools.normalizeGameDir(versionsDir), path.resolve(root));
  assert.strictEqual(tools.normalizeGameDir(oneVersion), path.resolve(root));
  assert.strictEqual(tools.listVersionsIn(versionsDir).length, 2);
  assert.strictEqual(tools.listVersionsIn(oneVersion).length, 2);
  assert.strictEqual(tools.isValidGameDir(versionsDir), true);
  assert.strictEqual(tools.isValidGameDir(oneVersion), true);

  const found = tools.scanMinecraftDirs({ extra: [versionsDir] });
  assert.ok(found.some((d) => d.path === path.resolve(root) && d.versions === 2));
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

test('curseForgeSearch 按下载量排序并带上 API Key', async () => {
  let seenUrl = '';
  let seenKey = '';
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenKey = (init.headers || {})['x-api-key'] || '';
    return {
      ok: true,
      json: async () => ({
        data: [{
          id: 238222,
          slug: 'jei',
          name: 'Just Enough Items',
          summary: '物品管理器',
          downloadCount: 1200000000,
          logo: { thumbnailUrl: 'https://x/jei.png' },
          categories: [{ name: 'API and Library' }],
          authors: [{ name: 'mezz' }],
          links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' }
        }]
      })
    };
  };
  const hits = await tools.curseForgeSearch('', {
    gameVersion: '1.21.3',
    sort: 'downloads',
    projectType: 'mod',
    apiKey: 'test-key',
    fetchImpl
  });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].id, '238222');
  assert.strictEqual(hits[0].downloads, 1200000000);
  assert.strictEqual(hits[0].source, 'curseforge');
  assert.strictEqual(hits[0].iconUrl, 'https://x/jei.png');
  assert.strictEqual(seenKey, 'test-key');
  assert.ok(seenUrl.includes('gameId=432'));
  assert.ok(seenUrl.includes('classId=6'));
  assert.ok(seenUrl.includes('sortField=6'));
  assert.ok(seenUrl.includes('gameVersion=1.21.3'));
});

test('curseForgeFileUrl 在无 downloadUrl 时按 CDN 规则拼接', () => {
  assert.strictEqual(
    tools.curseForgeFileUrl({ id: 3800001, fileName: 'jei-1.21.3.jar' }),
    'https://edge.forgecdn.net/files/3800/1/jei-1.21.3.jar'
  );
  assert.strictEqual(
    tools.curseForgeFileUrl({ id: 1, fileName: 'x.jar' }),
    ''
  );
  assert.strictEqual(
    tools.curseForgeFileUrl({ id: 9999, fileName: 'a.jar', downloadUrl: 'https://mediafilez.forgecdn.net/files/1/1/a.jar' }),
    'https://edge.forgecdn.net/files/1/1/a.jar'
  );
});

test('curseForgeSearch 遇到 403 提示填写自己的 Key', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403 });
  await assert.rejects(
    () => tools.curseForgeSearch('', { fetchImpl }),
    /API Key 无效/
  );
});

test('searchProjects 默认使用 CurseForge，可切换 Modrinth', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('api.curseforge.com')) {
      return { ok: true, json: async () => ({ data: [{ id: 1, name: 'A', downloadCount: 5, slug: 'a' }] }) };
    }
    return { ok: true, json: async () => ({ hits: [{ project_id: 'p', title: 'P', downloads: 7 }] }) };
  };
  const cf = await tools.searchProjects('', { fetchImpl });
  assert.strictEqual(cf[0].source, 'curseforge');
  const mr = await tools.searchProjects('', { source: 'modrinth', fetchImpl });
  assert.strictEqual(mr[0].source, 'modrinth');
  assert.ok(calls.length >= 2);
});

test('installMod 按项目类型写入对应目录', async () => {
  const root = makeGameDir(tmpDir('install'), ['1.20.1']);
  const fetchImpl = async (url) => ({
    ok: true,
    headers: { get: () => '4' },
    body: null,
    arrayBuffer: async () => Buffer.from('data')
  });
  const result = await tools.installMod(
    { fileUrl: 'https://x/a.zip', fileName: 'a.zip', projectType: 'resourcepack' },
    root,
    { fetchImpl }
  );
  assert.strictEqual(result.type, 'resourcepack');
  assert.strictEqual(path.dirname(result.path), path.join(root, 'resourcepacks'));
});

