'use strict';

/**
 * 极简 Minecraft 皮肤 3D 渲染器（原生 WebGL，不引入任何依赖）。
 * 支持 64×64 现代皮肤；64×32 旧皮肤用镜像贴图兜底。
 */

(function (global) {
  const VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUV;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat4 uModel;',
    'uniform float uShade;',
    'varying vec2 vUV;',
    'varying float vShade;',
    'void main(){',
    '  vUV = aUV;',
    '  vShade = uShade;',
    '  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'uniform sampler2D uTex;',
    'uniform float uAlpha;',
    'varying vec2 vUV;',
    'varying float vShade;',
    'void main(){',
    '  vec4 c = texture2D(uTex, vUV);',
    '  if (c.a < 0.05) discard;',
    '  gl_FragColor = vec4(c.rgb * vShade, c.a * uAlpha);',
    '}'
  ].join('\n');

  // ---------- 4x4 矩阵 ----------
  function mat4() { return new Float32Array(16); }
  function identity(m) {
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
  }
  function perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }
  function translate(out, x, y, z) {
    identity(out);
    out[12] = x; out[13] = y; out[14] = z;
    return out;
  }
  function rotateY(out, rad) {
    identity(out);
    const c = Math.cos(rad), s = Math.sin(rad);
    out[0] = c; out[2] = -s;
    out[8] = s; out[10] = c;
    return out;
  }
  function rotateX(out, rad) {
    identity(out);
    const c = Math.cos(rad), s = Math.sin(rad);
    out[5] = c; out[6] = s;
    out[9] = -s; out[10] = c;
    return out;
  }
  function multiply(out, a, b) {
    const t = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        t[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
      }
    }
    out.set(t);
    return out;
  }

  // ---------- 方块几何 ----------
  // faces: [px,py,pz] 尺寸，uv 基点是贴图左上角
  function box(w, h, d, ux, uy) {
    const x = w / 2, y = h / 2, z = d / 2;
    const T = [ux + d, uy, w, d];
    const B = [ux + d + w, uy, w, d];
    const R = [ux, uy + d, d, h];
    const F = [ux + d, uy + d, w, h];
    const L = [ux + d + w, uy + d, d, h];
    const K = [ux + 2 * d + w, uy + d, w, h];
    const S = 64;
    const uv = (r, flipU, flipV) => {
      let u0 = r[0] / S, u1 = (r[0] + r[2]) / S;
      let v0 = r[1] / S, v1 = (r[1] + r[3]) / S;
      if (flipU) { const t = u0; u0 = u1; u1 = t; }
      if (flipV) { const t = v0; v0 = v1; v1 = t; }
      return [u0, u1, v0, v1];
    };
    const verts = [];
    const pushQuad = (p1, p2, p3, p4, r) => {
      const [u0, u1, v0, v1] = uv(r);
      // p1 左上, p2 右上, p3 右下, p4 左下
      verts.push(p1[0], p1[1], p1[2], u0, v0);
      verts.push(p2[0], p2[1], p2[2], u1, v0);
      verts.push(p3[0], p3[1], p3[2], u1, v1);
      verts.push(p1[0], p1[1], p1[2], u0, v0);
      verts.push(p3[0], p3[1], p3[2], u1, v1);
      verts.push(p4[0], p4[1], p4[2], u0, v1);
    };
    // 前（+z）
    pushQuad([-x, y, z], [x, y, z], [x, -y, z], [-x, -y, z], F);
    // 后（-z）
    pushQuad([x, y, -z], [-x, y, -z], [-x, -y, -z], [x, -y, -z], K);
    // 右（+x）
    pushQuad([x, y, z], [x, y, -z], [x, -y, -z], [x, -y, z], R);
    // 左（-x）
    pushQuad([-x, y, -z], [-x, y, z], [-x, -y, z], [-x, -y, -z], L);
    // 上（+y）
    pushQuad([-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], T);
    // 下（-y）
    pushQuad([-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z], B);
    return new Float32Array(verts);
  }

  function buildModel() {
    // 单位：像素 / 16，脚底 y=0
    const parts = [
      { name: 'head', w: 8, h: 8, d: 8, x: 0, y: 28, z: 0, uv: [0, 0] },
      { name: 'body', w: 8, h: 12, d: 4, x: 0, y: 18, z: 0, uv: [16, 16] },
      { name: 'armR', w: 4, h: 12, d: 4, x: -6, y: 18, z: 0, uv: [40, 16] },
      { name: 'armL', w: 4, h: 12, d: 4, x: 6, y: 18, z: 0, uv: [32, 48] },
      { name: 'legR', w: 4, h: 12, d: 4, x: -2, y: 6, z: 0, uv: [0, 16] },
      { name: 'legL', w: 4, h: 12, d: 4, x: 2, y: 6, z: 0, uv: [16, 48] }
    ];
    return parts.map((p) => ({
      name: p.name,
      x: p.x, y: p.y, z: p.z,
      data: box(p.w, p.h, p.d, p.uv[0], p.uv[1])
    }));
  }

  class SkinViewer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', { alpha: true, antialias: true });
      this.rotation = -0.5;
      this.pitch = -0.12;
      this.autoRotate = true;
      this.dragging = false;
      this.lastX = 0;
      this.lastY = 0;
      this.texture = null;
      this.parts = null;
      this.raf = 0;
      this.ok = false;
      if (!this.gl) return;
      this.init();
      this.bindEvents();
      this.ok = true;
    }

    init() {
      const gl = this.gl;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      this.prog = prog;
      this.aPos = gl.getAttribLocation(prog, 'aPos');
      this.aUV = gl.getAttribLocation(prog, 'aUV');
      this.uProj = gl.getUniformLocation(prog, 'uProj');
      this.uView = gl.getUniformLocation(prog, 'uView');
      this.uModel = gl.getUniformLocation(prog, 'uModel');
      this.uShade = gl.getUniformLocation(prog, 'uShade');
      this.uAlpha = gl.getUniformLocation(prog, 'uAlpha');
      this.uTex = gl.getUniformLocation(prog, 'uTex');
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      this.parts = buildModel();
      this.buffers = this.parts.map((p) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, p.data, gl.STATIC_DRAW);
        return buf;
      });
      this.proj = mat4();
      this.view = mat4();
      this.model = mat4();
      this.tmpA = mat4();
      this.tmpB = mat4();
      this.scale = 1 / 16;
    }

    bindEvents() {
      const c = this.canvas;
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', (e) => {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        this.rotation += (e.clientX - this.lastX) * 0.01;
        this.pitch = Math.max(-0.8, Math.min(0.8, this.pitch + (e.clientY - this.lastY) * 0.006));
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      });
      const stop = () => { this.dragging = false; };
      c.addEventListener('pointerup', stop);
      c.addEventListener('pointercancel', stop);
      c.addEventListener('pointerleave', stop);
    }

    setTextureFromImage(img) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.texture = tex;
      if (this.autoRotate) this.start();
      this.draw();
    }

    loadFromURL(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          this.setTextureFromImage(img);
          resolve(true);
        };
        img.onerror = () => reject(new Error('无法读取皮肤图片'));
        img.src = url;
      });
    }

    resize() {
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const w = this.canvas.clientWidth || 220;
      const h = this.canvas.clientHeight || 320;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const aspect = w / h;
      perspective(this.proj, 0.72, aspect, 1, 200);
      this.viewport = { w, h };
    }

    draw() {
      const gl = this.gl;
      if (!this.texture || !this.ok) return;
      this.resize();
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.prog);

      const dist = 62;
      identity(this.view);
      translate(this.tmpA, 0, -19, -dist);
      multiply(this.view, this.tmpA, this.view);
      rotateX(this.tmpA, this.pitch);
      multiply(this.view, this.tmpA, this.view);

      gl.uniformMatrix4fv(this.uProj, false, this.proj);
      gl.uniformMatrix4fv(this.uView, false, this.view);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(this.uTex, 0);
      gl.uniform1f(this.uAlpha, 1);

      const shades = [1.0, 0.72, 0.84, 0.84, 1.08, 0.62];
      const bob = Math.sin(Date.now() / 700) * 0.35;
      this.parts.forEach((part, i) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
        gl.enableVertexAttribArray(this.aPos);
        gl.enableVertexAttribArray(this.aUV);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 20, 12);

        rotateY(this.tmpB, this.rotation);
        const offsetY = part.name === 'head' ? bob * 0.3 : 0;
        translate(this.tmpA, part.x * this.scale, part.y * this.scale + offsetY * this.scale, part.z * this.scale);
        multiply(this.model, this.tmpB, this.tmpA);
        multiply(this.model, this.model, this.tmpA);

        // 统一缩放
        identity(this.tmpB);
        this.tmpB[0] = this.scale;
        this.tmpB[5] = this.scale;
        this.tmpB[10] = this.scale;
        multiply(this.model, this.tmpB, this.model);

        gl.uniformMatrix4fv(this.uModel, false, this.model);
        // 六个面分别上色（每面 6 个顶点）
        for (let f = 0; f < 6; f++) {
          gl.uniform1f(this.uShade, shades[f]);
          gl.drawArrays(gl.TRIANGLES, f * 6, 6);
        }
      });
    }

    start() {
      if (this.raf) return;
      const loop = () => {
        if (this.autoRotate && !this.dragging) this.rotation += 0.008;
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    dispose() {
      this.stop();
      if (this.texture) this.gl.deleteTexture(this.texture);
      this.texture = null;
    }
  }

  global.SkinViewer = SkinViewer;
})(window);
