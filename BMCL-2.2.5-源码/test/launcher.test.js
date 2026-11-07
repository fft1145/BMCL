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

test('mergeVersionJson 合并 inheritsFrom：库去重、参数拼接、子版本覆盖主类', () => {
  const parent = {
    id: '1.21.3',
    mainClass: 'net.minecraft.client.main.Main',
    assetIndex: { id: '21', url: 'https://x/21.json' },
    downloads: { client: { url: 'https://x/client.jar', sha1: 'a', size: 1 } },
    arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}'] },
    libraries: [
      { name: 'com.mojang:brigadier:1.0.18', downloads: { artifact: { path: 'com/mojang/brigadier/1.0.18/brigadier-1.0.18.jar' } } },
      { name: 'org.ow2.asm:asm:9.5', downloads: { artifact: { path: 'org/ow2/asm/asm/9.5/asm-9.5.jar' } } }
    ]
  };
  const child = {
    id: '1.21.3-Fabric 0.17.3',
    inheritsFrom: '1.21.3',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    arguments: { jvm: ['-DFabricMcEmu=net.minecraft.client.main.Main'], game: [] },
    libraries: [
      { name: 'net.fabricmc:fabric-loader:0.17.3', url: 'https://maven.fabricmc.net/' },
      { name: 'org.ow2.asm:asm:9.6', url: 'https://maven.fabricmc.net/' }
    ]
  };

  const merged = launcher.mergeVersionJson(parent, child);
  assert.strictEqual(merged.id, '1.21.3-Fabric 0.17.3');
  assert.strictEqual(merged.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
  assert.strictEqual(merged.inheritsFrom, undefined);
  assert.deepStrictEqual(merged.assetIndex, parent.assetIndex);
  assert.strictEqual(merged.downloads.client.url, 'https://x/client.jar');
  // 库：同名 group:artifact 只保留一个版本（子版本覆盖父版本），避免重复类
  assert.strictEqual(merged.libraries.length, 3);
  assert.ok(merged.libraries.some((l) => l.name === 'org.ow2.asm:asm:9.6'));
  assert.strictEqual(merged.libraries.some((l) => l.name === 'org.ow2.asm:asm:9.5'), false);
  // 参数：父在前、子在后
  assert.deepStrictEqual(merged.arguments.jvm, ['-cp', '${classpath}', '-DFabricMcEmu=net.minecraft.client.main.Main']);
  assert.deepStrictEqual(merged.arguments.game, ['--username', '${auth_player_name}']);
});

test('dedupeLibraries 同一 group:artifact 只留一个，classifier 不合并', () => {
  const libs = [
    { name: 'org.ow2.asm:asm:9.3', downloads: { artifact: { path: 'org/ow2/asm/asm/9.3/asm-9.3.jar' } } },
    { name: 'org.ow2.asm:asm:9.9', downloads: { artifact: { path: 'org/ow2/asm/asm/9.9/asm-9.9.jar' } } },
    { name: 'org.lwjgl:lwjgl:3.3.1' },
    { name: 'org.lwjgl:lwjgl:3.3.1:natives-windows' }
  ];
  const out = launcher.dedupeLibraries(libs);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].name, 'org.ow2.asm:asm:9.9');
  assert.ok(out.some((l) => l.name === 'org.lwjgl:lwjgl:3.3.1'));
  assert.ok(out.some((l) => l.name === 'org.lwjgl:lwjgl:3.3.1:natives-windows'));
});

test('Fabric 继承合并后 classpath 只有一个 ASM，避免 duplicate ASM classes', () => {
  const merged = launcher.mergeVersionJson(
    {
      id: '1.20.1',
      mainClass: 'net.minecraft.client.main.Main',
      libraries: [
        { name: 'org.ow2.asm:asm:9.3', downloads: { artifact: { path: 'org/ow2/asm/asm/9.3/asm-9.3.jar' } } }
      ]
    },
    {
      id: '1.20.1-Fabric 0.17.3',
      inheritsFrom: '1.20.1',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [
        { name: 'org.ow2.asm:asm:9.9', downloads: { artifact: { path: 'org/ow2/asm/asm/9.9/asm-9.9.jar' } } }
      ]
    }
  );
  const paths = launcher.collectLibraryPaths(merged, '/libs', { os: { name: 'windows', arch: 'x86_64', version: '' }, features: {} });
  const asm = paths.filter((p) => /[\\/]asm-9\.\d+\.jar$/.test(p));
  assert.strictEqual(asm.length, 1);
  assert.ok(asm[0].includes('asm-9.9.jar'));
});

test('mergeVersionJson 结果可直接构造启动命令', () => {
  const merged = launcher.mergeVersionJson(
    {
      id: '1.21.3',
      mainClass: 'net.minecraft.client.main.Main',
      minecraftArguments: '--username ${auth_player_name} --gameDir ${game_directory}'
    },
    { id: '1.21.3-Fabric', inheritsFrom: '1.21.3', mainClass: 'KnotClient', libraries: [] }
  );
  const cmd = launcher.buildCommand({
    versionJson: merged,
    versionId: '1.21.3-Fabric',
    playerName: 'Steve',
    uuid: '0',
    gameDir: '/g',
    classpath: 'cp',
    nativesDir: 'n',
    ctx: detectContext('linux', 'x64')
  });
  assert.ok(cmd.args.includes('KnotClient'));
  assert.ok(cmd.args.includes('Steve'));
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
