'use strict';

const test = require('node:test');
const assert = require('node:assert');
const launcher = require('../src/core/launcher');
const { detectContext } = require('../src/core/rules');

const modernJson = {
  id: '1.20.1',
  mainClass: 'net.minecraft.client.main.Main',
  arguments: {
    jvm: [
      '-Djava.library.path=${natives_directory}',
      '-cp',
      '${classpath}',
      { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-Dbmcl.os=windows' },
      { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-Dbmcl.os=mac' }
    ],
    game: [
      '--username', '${auth_player_name}',
      '--version', '${version_name}',
      '--gameDir', '${game_directory}',
      '--assetsDir', '${assets_root}',
      '--assetIndex', '${assets_index_name}',
      '--uuid', '${auth_uuid}',
      '--accessToken', '${auth_access_token}'
    ]
  }
};

test('离线 UUID 稳定且符合格式', () => {
  const a = launcher.offlineUuid('fft1145');
  const b = launcher.offlineUuid('fft1145');
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notStrictEqual(a, launcher.offlineUuid('other'));
});

test('buildCommand 生成完整 JVM + 主类 + 游戏参数', () => {
  const ctx = detectContext('linux', 'x64');
  const cmd = launcher.buildCommand({
    versionJson: modernJson,
    versionId: '1.20.1',
    javaPath: '/usr/bin/java',
    playerName: 'fft1145',
    uuid: launcher.offlineUuid('fft1145'),
    gameDir: '/tmp/game',
    assetsDir: '/tmp/assets',
    classpath: '/tmp/a.jar:/tmp/client.jar',
    nativesDir: '/tmp/natives',
    memoryMB: 4096,
    ctx
  });
  assert.strictEqual(cmd.javaPath, '/usr/bin/java');
  assert.ok(cmd.args.includes('-Xmx4096M'));
  assert.ok(cmd.args.includes('-cp'));
  assert.ok(cmd.args.includes('/tmp/a.jar:/tmp/client.jar'));
  assert.ok(cmd.args.includes('net.minecraft.client.main.Main'));
  assert.ok(cmd.args.includes('--username'));
  assert.ok(cmd.args.includes('fft1145'));
  const index = cmd.args.indexOf('net.minecraft.client.main.Main');
  assert.ok(index > 0);
  assert.ok(cmd.args.includes('--version'));
  assert.ok(cmd.args.includes('1.20.1'));
  // Linux 下不应出现 Windows 专属参数
  assert.strictEqual(cmd.args.includes('-Dbmcl.os=windows'), false);
});

test('Windows 上下发 Windows 专属参数', () => {
  const ctx = detectContext('win32', 'x64');
  const cmd = launcher.buildCommand({
    versionJson: modernJson,
    versionId: '1.20.1',
    playerName: 'p',
    uuid: '0',
    classpath: 'cp',
    nativesDir: 'n',
    memoryMB: 2048,
    ctx
  });
  assert.ok(cmd.args.includes('-Dbmcl.os=windows'));
  assert.strictEqual(cmd.args.includes('-Dbmcl.os=mac'), false);
});

test('兼容旧版 minecraftArguments', () => {
  const oldJson = {
    id: '1.7.10',
    mainClass: 'net.minecraft.client.main.Main',
    minecraftArguments: '--username ${auth_player_name} --session ${auth_access_token} --gameDir ${game_directory}'
  };
  const cmd = launcher.buildCommand({
    versionJson: oldJson,
    versionId: '1.7.10',
    playerName: 'Steve',
    uuid: '0',
    accessToken: '0',
    gameDir: '/g',
    classpath: 'cp',
    nativesDir: 'n',
    memoryMB: 1024
  });
  assert.ok(cmd.args.includes('--username'));
  assert.ok(cmd.args.includes('Steve'));
  assert.ok(cmd.args.includes('--session'));
});

test('collectLibraryPaths 只收集规则允许的库', () => {
  const json = {
    libraries: [
      { name: 'a:a:1', downloads: { artifact: { path: 'a/a/1/a-1.jar' } } },
      {
        name: 'b:b:1',
        rules: [{ action: 'disallow', os: { name: 'linux' } }],
        downloads: { artifact: { path: 'b/b/1/b-1.jar' } }
      },
      { name: 'c:c:1:natives-windows', downloads: { artifact: { path: 'c/c/1/c-1-natives-windows.jar' } } }
    ]
  };
  const ctx = { os: { name: 'windows', arch: 'x86_64', version: '' }, features: {} };
  const paths = launcher.collectLibraryPaths(json, '/libs', ctx);
  assert.strictEqual(paths.length, 2);
  assert.ok(paths[0].endsWith('a-1.jar'));
});
