// @ts-check
// WebGL2 paper renderer: two-sided paper (front/back colour, printed content via sheet UVs and
// gl_FrontFacing — `art`, placed artwork and annotations composited per side by printed.js),
// hemisphere + key light with translucency and procedural grain, one directional PCF shadow map
// (pop-ups cast shadows), a ground plane, and an optional crease overlay.
// Buffers are allocated once per mesh size and refreshed with bufferSubData every frame.

import { OrbitCamera } from './camera.js';
import { hexToLinear, DEG } from './math.js';
import { MAX_SHEETS, PAPER_VS, PAPER_FS, GROUND_VS, GROUND_FS, DEPTH_VS, DEPTH_FS, LINE_VS, LINE_FS } from './shaders.js';
import { computeBounds, lightViewProj, computeNormals, normalsMissing, readTheme, LIGHT_DIR } from './scene.js';
import { artLayerSize, drawLayer, hasPrinted, planSheet } from './printed.js';

/** @param {HTMLCanvasElement} [canvas] */
export function hasWebGL2(canvas) {
  try {
    const c = canvas || document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onWarn?: (msg: string) => void}} [opts]
 * @returns {import('./index.js').Renderer}
 */
export function createWebGLRenderer(canvas, opts = {}) {
  const warn = opts.onWarn || (() => {});
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const camera = new OrbitCamera();
  const paper = program(gl, PAPER_VS, PAPER_FS);
  const ground = program(gl, GROUND_VS, GROUND_FS);
  const depth = program(gl, DEPTH_VS, DEPTH_FS);
  const line = program(gl, LINE_VS, LINE_FS);
  let theme = readTheme(canvas);

  // --- shadow map ---
  const SHADOW = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // --- art texture array: two layers per sheet (front, back), all the same square size, sized by
  // artLayerSize (≤ 2048 px, ≤ 64 MB in all); a 1×1 placeholder until a document prints anything.
  let artTex = gl.createTexture();
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  function allocArt(layers, size) {
    gl.deleteTexture(artTex);
    artTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, artTex);
    // Mipmapped: annotation text stays clean when a large sheet is seen small.
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size, Math.max(1, layers));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, size > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  allocArt(0, 1);

  // --- paper mesh buffers ---
  const vao = gl.createVertexArray();
  const bufs = { pos: gl.createBuffer(), nrm: gl.createBuffer(), uv: gl.createBuffer(), sheet: gl.createBuffer(), idx: gl.createBuffer() };
  let cap = { verts: 0, idx: 0 }, indexCount = 0, indexType = gl.UNSIGNED_INT, lastIndices = null;
  let sheetF32 = new Float32Array(0), normalsScratch = new Float32Array(0);
  gl.bindVertexArray(vao);
  for (const [loc, buf, size] of [[0, bufs.pos, 3], [1, bufs.nrm, 3], [2, bufs.uv, 2], [3, bufs.sheet, 1]]) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
  gl.bindVertexArray(null);

  // --- ground quad (rebuilt when the scene radius changes notably) ---
  const groundVao = gl.createVertexArray(), groundBuf = gl.createBuffer();
  gl.bindVertexArray(groundVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 18 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const groundData = new Float32Array(18);

  // --- crease overlay ---
  const lineVao = gl.createVertexArray(), linePos = gl.createBuffer(), lineCol = gl.createBuffer();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, linePos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineCol); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let lineCap = 0;

  const front = new Float32Array(MAX_SHEETS * 3), back = new Float32Array(MAX_SHEETS * 3), info = new Float32Array(MAX_SHEETS * 4);
  const lightMat = new Float32Array(16);
  let destroyed = false;
  let generation = 0;   // bumps on every setSheets: late image loads of an older document are ignored

  function uploadMesh(r) {
    const nv = r.positions.length / 3;
    if (nv > cap.verts) {
      cap.verts = nv;
      for (const [buf, comps] of [[bufs.pos, 3], [bufs.nrm, 3], [bufs.uv, 2], [bufs.sheet, 1]]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, nv * comps * 4, gl.DYNAMIC_DRAW);
      }
      sheetF32 = new Float32Array(nv);
      normalsScratch = new Float32Array(nv * 3);
      lastIndices = null;
    }
    const f32 = (a) => (a instanceof Float32Array ? a : Float32Array.from(a));
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32(r.positions));
    let normals = r.normals;
    if (normalsMissing(normals, nv * 3)) normals = computeNormals(r.positions, r.indices, normalsScratch.subarray(0, nv * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs.nrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32(normals));
    if (r.indices !== lastIndices || r.indices.length !== indexCount) {
      // Topology (UVs, sheet ids, indices) changes only when the engine rebuilds its mesh.
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv); gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32(r.uvs));
      for (let i = 0; i < nv; i++) sheetF32[i] = r.sheetIds[i];
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.sheet); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sheetF32.subarray(0, nv));
      const idx = r.indices instanceof Uint16Array || r.indices instanceof Uint32Array ? r.indices : Uint32Array.from(r.indices);
      indexType = idx instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
      if (idx.length > cap.idx) { cap.idx = idx.length; gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW); }
      else gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, idx);
      indexCount = idx.length;
      lastIndices = r.indices;
    }
  }

  function uploadOverlay(ov) {
    const n = ov.positions.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, linePos);
    if (n > lineCap) { lineCap = n; gl.bufferData(gl.ARRAY_BUFFER, n * 4, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, lineCol); gl.bufferData(gl.ARRAY_BUFFER, n * 4, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, linePos); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ov.positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, ov.colors);
  }

  function setGround(bounds) {
    const R = bounds.radius * 4 + 200, c = bounds.center, y = -0.15;
    const q = [[-R, -R], [R, -R], [R, R], [-R, -R], [R, R], [-R, R]];
    q.forEach(([x, z], i) => { groundData[i * 3] = c[0] + x; groundData[i * 3 + 1] = y; groundData[i * 3 + 2] = c[2] + z; });
    gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, groundData);
    return R;
  }

  const renderer = {
    kind: 'webgl2',
    camera,
    canvas,

    /** @param {ReturnType<typeof import('./scene.js').sheetsFromDocument>} sheets @param {string} [baseUrl] */
    setSheets(sheets, baseUrl) {
      const gen = ++generation;
      front.fill(0); back.fill(0); info.fill(0);
      const list = sheets.slice(0, MAX_SHEETS);
      list.forEach((s, i) => {
        front.set(hexToLinear(s.front), i * 3); back.set(hexToLinear(s.back), i * 3);
        info.set([s.size[0], s.size[1], s.grainDeg * DEG, 0], i * 4);
      });
      const wantsArt = list.some((s) => hasPrinted(s, 'front') || hasPrinted(s, 'back'));
      const size = wantsArt ? artLayerSize(list.length * 2, maxTexture) : 1;
      allocArt(wantsArt ? list.length * 2 : 0, size);
      if (!wantsArt) return;
      const base = baseUrl || location.href;
      const plans = list.map((s) => planSheet(s, size, base));
      const rejected = plans.reduce((n, p) => n + p.rejected.length, 0);
      if (rejected) warn(`Skipped ${rejected} printed image(s) with a disallowed URL (allowed: relative paths, data:image/svg+xml, data:image/png).`);
      /** @type {{layer: number, sheet: number, bit: number, ops: import('./printed.js').DrawOp[]}[]} */
      const layers = [];
      plans.forEach((p, i) => {
        if (p.front.length) layers.push({ layer: i * 2, sheet: i, bit: 1, ops: p.front });
        if (p.back.length) layers.push({ layer: i * 2 + 1, sheet: i, bit: 2, ops: p.back });
      });
      const scratch = document.createElement('canvas');
      scratch.width = scratch.height = size;
      const ctx = scratch.getContext('2d');
      if (!ctx) { warn('Printed content skipped: no 2-D canvas for compositing.'); return; }
      /** @type {Map<string, HTMLImageElement>} */
      const images = new Map();
      let uploadWarned = false, loadWarned = false;   // one warning each per document, no spam
      const upload = (L) => {
        if (gen !== generation || destroyed) return;
        try {
          drawLayer(ctx, L.ops, images, size);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, artTex);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // clean edges under LINEAR filtering
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, L.layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
          info[L.sheet * 4 + 3] = (info[L.sheet * 4 + 3] | L.bit);
        } catch (e) {
          if (!uploadWarned) warn(`Printed content upload failed: ${e instanceof Error ? e.message : e}`);
          uploadWarned = true;
        }
      };
      layers.forEach(upload);      // texts (and the transparent background) show at once
      const srcs = new Set(layers.flatMap((L) => L.ops.filter((op) => op.kind !== 'text').map((op) => /** @type {any} */ (op).src)));
      for (const src of srcs) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (gen !== generation || destroyed) return;
          images.set(src, img);
          layers.filter((L) => L.ops.some((op) => op.kind !== 'text' && /** @type {any} */ (op).src === src)).forEach(upload);
        };
        img.onerror = () => {
          if (gen !== generation || destroyed || loadWarned) return;
          loadWarned = true;
          warn('A printed image failed to load; the sheet shows without it.');
        };
        img.src = src;
      }
    },

    refreshTheme() { theme = readTheme(canvas); },

    resize() {
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      // Capped: a runaway layout must never allocate a giant backing buffer.
      const w = Math.min(4096, Math.max(1, Math.round(canvas.clientWidth * dpr))), h = Math.min(4096, Math.max(1, Math.round(canvas.clientHeight * dpr)));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    },

    /**
     * @param {{positions: ArrayLike<number>, normals?: ArrayLike<number>, uvs: ArrayLike<number>, sheetIds: ArrayLike<number>, indices: ArrayLike<number>}} r
     * @param {{positions: Float32Array, colors: Float32Array} | null} overlay
     */
    draw(r, overlay) {
      if (destroyed) return;
      renderer.resize();
      uploadMesh(r);
      const bounds = computeBounds(r.positions);
      camera.update(canvas.width / canvas.height);
      lightViewProj(bounds, lightMat);
      const groundR = setGround(bounds);

      // 1. shadow pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
      gl.viewport(0, 0, SHADOW, SHADOW);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      gl.useProgram(depth.p);
      gl.uniformMatrix4fv(depth.u.uLightViewProj, false, lightMat);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // 2. main pass
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...theme.clear.map((c) => c ** (1 / 2.2)), 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, artTex);

      gl.useProgram(ground.p);
      gl.uniformMatrix4fv(ground.u.uViewProj, false, camera.viewProj);
      gl.uniformMatrix4fv(ground.u.uLightViewProj, false, lightMat);
      gl.uniform1i(ground.u.uShadow, 0); gl.uniform1f(ground.u.uShadowTexel, 1.5 / SHADOW);
      gl.uniform3fv(ground.u.uTable, theme.table); gl.uniform3fv(ground.u.uClear, theme.clear);
      gl.uniform3fv(ground.u.uCenter, bounds.center); gl.uniform1f(ground.u.uRadius, groundR);
      gl.bindVertexArray(groundVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.useProgram(paper.p);
      gl.uniformMatrix4fv(paper.u.uViewProj, false, camera.viewProj);
      gl.uniformMatrix4fv(paper.u.uLightViewProj, false, lightMat);
      gl.uniform3fv(paper.u.uFront, front); gl.uniform3fv(paper.u.uBack, back); gl.uniform4fv(paper.u.uSheetInfo, info);
      gl.uniform1i(paper.u.uShadow, 0); gl.uniform1i(paper.u.uArt, 1); gl.uniform1f(paper.u.uShadowTexel, 1.0 / SHADOW);
      gl.uniform3fv(paper.u.uLightDir, LIGHT_DIR); gl.uniform3fv(paper.u.uEye, camera.eye());
      gl.uniform3fv(paper.u.uSky, theme.sky); gl.uniform3fv(paper.u.uGround, theme.ground);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);

      if (overlay && overlay.positions.length) {
        uploadOverlay(overlay);
        gl.useProgram(line.p);
        gl.uniformMatrix4fv(line.u.uViewProj, false, camera.viewProj);
        gl.bindVertexArray(lineVao);
        gl.drawArrays(gl.LINES, 0, overlay.positions.length / 3);
      }
      gl.bindVertexArray(null);
      return bounds;
    },

    destroy() {
      destroyed = true;
      for (const b of Object.values(bufs)) gl.deleteBuffer(b);
      [groundBuf, linePos, lineCol].forEach((b) => gl.deleteBuffer(b));
      [vao, groundVao, lineVao].forEach((v) => gl.deleteVertexArray(v));
      [paper, ground, depth, line].forEach((pr) => gl.deleteProgram(pr.p));
      gl.deleteTexture(shadowTex); gl.deleteTexture(artTex); gl.deleteFramebuffer(shadowFbo);
    },
  };
  return renderer;
}
