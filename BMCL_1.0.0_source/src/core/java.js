'use strict';

const { execFile } = require('node:child_process');

function parseJavaVersion(output) {
  const text = String(output || '');
  const quoted = text.match(/version\s+"([^"]+)"/i);
  const openJdk = text.match(/openjdk\s+([0-9][^\s]*)/i);
  const version = quoted ? quoted[1] : openJdk ? openJdk[1] : '';
  if (!version) return { version: '', major: 0 };
  const nums = version.split('.');
  let major;
  if (nums[0] === '1') major = parseInt(nums[1], 10) || 0;
  else major = parseInt(nums[0], 10) || 0;
  return { version, major };
}

function probeJava(javaPath, execFileImpl = execFile) {
  return new Promise((resolve) => {
    execFileImpl(javaPath || 'java', ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, javaPath: javaPath || 'java', message: err.message });
        return;
      }
      const info = parseJavaVersion(String(stderr || '') + '\n' + String(stdout || ''));
      resolve({ ok: info.major > 0, javaPath: javaPath || 'java', version: info.version, major: info.major });
    });
  });
}

/** 根据版本需求推荐 Java 主版本 */
function recommendJavaMajor(mcVersion) {
  const m = String(mcVersion || '').match(/^1\.(\d+)/);
  if (!m) return 17;
  const minor = Number(m[1]);
  if (minor <= 16) return 8;
  if (minor <= 20) return 17;
  return 21;
}

module.exports = { parseJavaVersion, probeJava, recommendJavaMajor };
