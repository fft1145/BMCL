'use strict';

/**
 * 陶瓦联机（Terracotta）房号解析与生成。
 *
 * 房号由 25 个 Base34 字符组成（每 5 个一组，用 - 分隔）：
 *   - 0..14  网络名称（15 位）
 *   - 15..23 网络密钥（9 位）
 *   - 24     校验位（前 24 位数值和 mod 34）
 * 端口由前 24 位编码值对 65536 取模得到，因此房号与端口是一一对应的。
 */

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_PATTERN = /(?:[0-9A-Z]{5}-){4}[0-9A-Z]{5}/i;
const RELAY = 'tcp://public.easytier.top:11010';
const HOST_IP = '10.144.144.1';

function invalid(message) {
  return { ok: false, message };
}

function formatCode(raw) {
  const groups = [];
  for (let i = 0; i < 25; i += 5) groups.push(raw.slice(i, i + 5));
  return groups.join('-');
}

/**
 * 解析陶瓦房号。
 * @param {string} input
 * @returns {{ok:true, code:string, networkName:string, networkSecret:string, port:number}
 *          | {ok:false, message:string}}
 */
function parseRoomCode(input) {
  const text = String(input || '').toUpperCase();
  const match = text.match(CODE_PATTERN);
  if (!match) {
    return invalid('大厅编号格式不正确，应形如 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX');
  }
  const raw = match[0].replace(/-/g, '').replace(/I/g, '1').replace(/O/g, '0');
  if (raw.length !== 25) return invalid('大厅编号长度不正确');

  let value = 0n;
  let sum = 0;
  for (let i = 0; i < 24; i++) {
    const digit = ALPHABET.indexOf(raw[i]);
    if (digit < 0) return invalid('大厅编号包含无效字符：' + raw[i]);
    value += BigInt(digit) * (34n ** BigInt(i));
    sum = (sum + digit) % 34;
  }
  const check = ALPHABET.indexOf(raw[24]);
  if (check < 0) return invalid('大厅编号包含无效字符：' + raw[24]);
  if (check !== sum) return invalid('大厅编号校验失败，请确认没有输错或漏字符');

  const port = Number(value % 65536n);
  if (port < 100) return invalid('大厅编号中的端口无效');

  return {
    ok: true,
    code: formatCode(raw),
    networkName: raw.slice(0, 15).toLowerCase(),
    networkSecret: raw.slice(15, 25).toLowerCase(),
    port
  };
}

/** 34 的幂对 65536 取模（只有前 16 位非零） */
const POW_MOD = Array.from({ length: 24 }, (_, i) => Number((34n ** BigInt(i)) % 65536n));

function randomChars(count, random) {
  let out = '';
  for (let i = 0; i < count; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/**
 * 生成指定端口的陶瓦房号。
 * 端口只由网络名称与前 9 位密钥中的第 1 位决定，其余密钥位可随机，
 * 因此随机名称直到 (名称值 + 首位密钥 * 34^15) mod 65536 命中目标端口。
 * @param {number} port 目标端口（100-65535）
 * @param {() => number} [random] 便于测试注入
 */
function generateRoomCode(port, random = Math.random) {
  const target = Number(port);
  if (!Number.isInteger(target) || target < 100 || target > 65535) {
    throw new Error('端口必须是 100-65535 之间的整数');
  }
  for (let attempt = 0; attempt < 400000; attempt++) {
    const name = randomChars(15, random);
    let base = 0;
    for (let i = 0; i < 15; i++) {
      base = (base + ALPHABET.indexOf(name[i]) * POW_MOD[i]) % 65536;
    }
    const need = (target - base + 65536) % 65536;
    if (need !== 0 && need !== 32768) continue;
    const first = randomChars(1, random);
    let firstIndex = ALPHABET.indexOf(first);
    if ((firstIndex % 2) !== (need === 32768 ? 1 : 0)) firstIndex = (firstIndex + 1) % 34;
    const secret = ALPHABET[firstIndex] + randomChars(8, random);
    const raw = name + secret;
    let sum = 0;
    for (let i = 0; i < 24; i++) sum = (sum + ALPHABET.indexOf(raw[i])) % 34;
    return formatCode(raw + ALPHABET[sum]);
  }
  throw new Error('生成大厅编号失败，请重试');
}

function networkNameOf(room) {
  return 'terracotta-mc-' + room.networkName;
}

/** 加入大厅时发给 EasyTier 的参数 */
function buildJoinArgs(room, localPort, rpcPort, username, machineId) {
  const name = networkNameOf(room);
  const args = [
    '--no-tun',
    '--network-name=' + name,
    '--network-secret=' + room.networkSecret,
    '--relay-network-whitelist=' + name,
    '--private-mode=true',
    '-d',
    '--tcp-whitelist=0',
    '--udp-whitelist=0',
    '--port-forward=tcp://127.0.0.1:' + localPort + '/' + HOST_IP + ':' + room.port,
    '--port-forward=udp://127.0.0.1:' + localPort + '/' + HOST_IP + ':' + room.port,
    '-p', RELAY,
    '--rpc-portal=127.0.0.1:' + rpcPort,
    '--hostname=J|' + username,
    '--machine-id=' + machineId,
    '--enable-quic-proxy',
    '--enable-kcp-proxy',
    '--encryption-algorithm=chacha20',
    '--compression=zstd',
    '--multi-thread'
  ];
  return args;
}

/** 创建大厅时发给 EasyTier 的参数 */
function buildHostArgs(port, networkName, networkSecret, rpcPort, username, machineId) {
  const name = 'terracotta-mc-' + networkName;
  return [
    '--no-tun',
    '--network-name=' + name,
    '--network-secret=' + networkSecret,
    '--relay-network-whitelist=' + name,
    '--private-mode=true',
    '-i', HOST_IP,
    '--tcp-whitelist=' + port,
    '--udp-whitelist=' + port,
    '-p', RELAY,
    '--rpc-portal=127.0.0.1:' + rpcPort,
    '--hostname=H|' + username,
    '--machine-id=' + machineId,
    '--enable-quic-proxy',
    '--enable-kcp-proxy',
    '--encryption-algorithm=chacha20',
    '--compression=zstd',
    '--multi-thread'
  ];
}

module.exports = {
  ALPHABET,
  RELAY,
  HOST_IP,
  parseRoomCode,
  generateRoomCode,
  buildJoinArgs,
  buildHostArgs,
  networkNameOf
};
