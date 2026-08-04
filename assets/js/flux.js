/* ==========================================================================
   FLUX — a raymarched blob, drawn entirely in a fragment shader.

   There is no geometry in this scene beyond one fullscreen triangle. The shape
   is a signed distance function: for any point in space it returns how far the
   surface is. Marching along a ray until that distance reaches zero finds the
   surface, and the gradient of the field at that point is the normal.

   Because the shape is a formula, "splitting the blob apart" is just moving
   two numbers — no rig, no morph targets, no keyframes.
   ========================================================================== */

(function () {
  'use strict';

  var canvas  = document.getElementById('gl');
  var veil    = document.querySelector('[data-veil]');
  var copies  = [].slice.call(document.querySelectorAll('[data-copy]'));
  var meters  = {
    spread: document.querySelector('[data-m="spread"]'),
    blend : document.querySelector('[data-m="blend"]'),
    steps : document.querySelector('[data-m="steps"]')
  };
  var values  = {
    spread: document.querySelector('[data-v="spread"]'),
    blend : document.querySelector('[data-v="blend"]'),
    steps : document.querySelector('[data-v="steps"]')
  };

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp  = function (a, b, t) { return a + (b - a) * t; };

  /* Raymarching costs a full march per pixel, so pixels are the budget. Phones
     get fewer of them and a shorter march; this is the difference between
     smooth and a slideshow. */
  var small = Math.min(window.innerWidth, window.innerHeight) < 760;
  var STEPS = small ? 48 : 84;
  var SCALE = small ? 0.6 : 0.85;

  /* ======================================================================
     Shader
     ====================================================================== */

  var VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec2  uRes;',
    'uniform float uTime;',
    'uniform float uScroll;',
    'uniform vec2  uPointer;',

    /* Polynomial smooth minimum. Plain min() gives a hard crease where two
       shapes meet; this one rounds the join, which is what makes separate
       spheres read as one body of liquid. */
    'float smin(float a, float b, float k){',
    '  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);',
    '  return mix(b, a, h) - k*h*(1.0-h);',
    '}',

    'float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }',

    // The whole object, as one function of position.
    'float map(vec3 p){',
    '  float spread = mix(0.30, 1.75, uScroll);',   // scroll pulls them apart
    '  float k      = mix(0.85, 0.30, uScroll);',   // and weakens the blend
    '  float d = 1e9;',
    '  for(int i = 0; i < 7; i++){',
    '    float fi = float(i);',
    '    float a  = uTime * 0.32 + fi * 0.8976;',
    '    vec3  c  = vec3(',
    '      cos(a) * spread,',
    '      sin(a * 1.37 + fi) * spread * 0.62,',
    '      sin(a) * spread',
    '    );',
    '    float r = 0.52 - fi * 0.022;',
    '    d = smin(d, length(p - c) - r, k);',
    '  }',
    // a slow ripple across the surface so it never looks like plastic
    '  d += sin(p.x * 6.0 + uTime) * sin(p.y * 5.0 - uTime * 0.7) * sin(p.z * 6.0) * 0.014;',
    '  return d;',
    '}',

    // Normal by central differences on the field.
    'vec3 normalAt(vec3 p){',
    '  vec2 e = vec2(0.0015, 0.0);',
    '  return normalize(vec3(',
    '    map(p + e.xyy) - map(p - e.xyy),',
    '    map(p + e.yxy) - map(p - e.yxy),',
    '    map(p + e.yyx) - map(p - e.yyx)',
    '  ));',
    '}',

    /* A procedural environment, so there is no HDR to download. A cool sky, a
       warm floor bounce, and one bright band that reads as a studio softbox. */
    'vec3 env(vec3 d, vec3 lightDir){',
    '  float up = d.y;',
    // A dark room with one bright softbox overhead. Chrome only looks like
    // chrome when what it mirrors has hard light/dark structure — a smooth
    // gradient reflects back as matte putty.
    // A crisp horizon between a dim floor and a dim ceiling. This one hard
    // edge does more for the metal than any amount of shading.
    '  float hz = smoothstep(-0.015, 0.015, up);',
    '  vec3 c = mix(vec3(0.013, 0.009, 0.006), vec3(0.015, 0.022, 0.036), hz);',
    // narrow overhead softbox — narrow is the point, a wide one paints stripes
    '  float box = smoothstep(0.70, 0.79, up) * (1.0 - smoothstep(0.95, 1.0, up));',
    '  c += vec3(1.0, 0.98, 0.95) * box * 3.4;',
    // a cool strip lower down, so there is a second thing to catch
    '  float strip = smoothstep(0.26, 0.32, up) * (1.0 - smoothstep(0.41, 0.47, up));',
    '  c += vec3(0.30, 0.60, 0.95) * strip * 1.2;',
    // a vertical bar: varies with x, which breaks the latitude banding
    '  float ax = abs(d.x);',
    '  float bar = smoothstep(0.58, 0.70, ax) * (1.0 - smoothstep(0.88, 0.97, ax));',
    '  c += vec3(0.92, 0.55, 0.30) * bar * 0.34 * (1.0 - hz * 0.55);',
    '  c += vec3(1.0, 0.95, 0.86) * pow(max(dot(d, lightDir), 0.0), 90.0) * 5.0;',
    '  return c;',
    '}',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',

    '  vec3 ro = vec3(0.0, 0.0, 4.2);',
    '  vec3 rd = normalize(vec3(uv, -1.45));',

    // the pointer nudges the camera rather than the object — feels like parallax
    '  float px = uPointer.x * 0.28, py = uPointer.y * 0.20;',
    '  ro.xz = mat2(cos(px), -sin(px), sin(px), cos(px)) * ro.xz;',
    '  rd.xz = mat2(cos(px), -sin(px), sin(px), cos(px)) * rd.xz;',
    '  ro.y += py; rd.y += py * 0.35;',

    '  vec3 lightDir = normalize(vec3(0.55 + uPointer.x * 0.5, 0.72 - uPointer.y * 0.4, 0.42));',

    '  float t = 0.0;',
    '  float hit = 0.0;',
    '  for(int i = 0; i < STEP_COUNT; i++){',
    '    vec3 p = ro + rd * t;',
    '    float d = map(p);',
    '    if(d < 0.0012){ hit = 1.0; break; }',
    '    t += d * 0.85;',                        // slightly under-relaxed, avoids overshoot
    '    if(t > 9.0) break;',
    '  }',

    '  vec3 col = vec3(0.0);',

    '  if(hit > 0.5){',
    '    vec3 p = ro + rd * t;',
    '    vec3 n = normalAt(p);',
    '    vec3 v = -rd;',

    '    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);',
    '    vec3  refl = reflect(rd, n);',

    // Metal is almost pure reflection. Fresnel does not add light here, it
    // decides how much of the room survives at grazing angles.
    '    vec3 base = env(refl, lightDir) * mix(0.72, 1.35, fres);',
    '    float spec = pow(max(dot(reflect(-lightDir, n), v), 0.0), 180.0);',

    '    col  = base;',
    '    col += vec3(1.0, 0.96, 0.9) * spec * 4.0;',
    '    col += vec3(0.16, 0.52, 0.78) * fres * 0.28;',   // cool rim, the page accent
    // a touch of ambient occlusion from how fast the field falls away
    '    float ao = clamp(map(p + n * 0.14) / 0.14, 0.0, 1.0);',
    '    col *= mix(0.55, 1.0, ao);',
    '  } else {',
    // background: a soft vignette with the same palette, so nothing looks pasted on
    '    float r = length(uv);',
    '    col = mix(vec3(0.0034,0.0042,0.0068), vec3(0.0008,0.0010,0.0018), smoothstep(0.1, 1.1, r));',
    '  }',

    // filmic-ish curve, then a dither so the dark gradient never bands
    '  col = col / (col + vec3(0.85));',
    '  col = pow(col, vec3(0.4545));',
    '  col += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) * 0.012;',

    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n').replace('STEP_COUNT', String(STEPS));

  /* ======================================================================
     Scene — one fullscreen triangle, nothing else
     ====================================================================== */

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * SCALE);

  var scene  = new THREE.Scene();
  var camera = new THREE.Camera();          // no projection needed, the shader does it

  var uniforms = {
    uRes    : { value: new THREE.Vector2(1, 1) },
    uTime   : { value: 0 },
    uScroll : { value: 0 },
    uPointer: { value: new THREE.Vector2(0, 0) }
  };

  // A single oversized triangle beats a quad: no diagonal seam, one less vertex.
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0,   3, -1, 0,   -1, 3, 0
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,   2, 0,   0, 2
  ]), 2));

  scene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader  : VERT,
    fragmentShader: FRAG,
    uniforms      : uniforms,
    depthTest     : false,
    depthWrite    : false
  })));

  /* ======================================================================
     Input
     ====================================================================== */

  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  window.addEventListener('pointermove', function (e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  var scrollP = 0, scrollNow = 0;

  function readScroll() {
    var max = document.body.scrollHeight - window.innerHeight;
    scrollP = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;

    for (var i = 0; i < copies.length; i++) {
      if (copies[i].getBoundingClientRect().top < window.innerHeight * 0.78) {
        copies[i].classList.add('is-in');
      }
    }
  }

  /* ======================================================================
     Loop
     ====================================================================== */

  var t0 = performance.now();
  var shown = false;

  function frame(now) {
    requestAnimationFrame(frame);
    readScroll();

    scrollNow = lerp(scrollNow, scrollP, 0.06);

    pointer.x = lerp(pointer.x, pointer.tx, 0.05);
    pointer.y = lerp(pointer.y, pointer.ty, 0.05);

    uniforms.uTime.value    = reduced ? 0 : (now - t0) / 1000;
    uniforms.uScroll.value  = scrollNow;
    uniforms.uPointer.value.set(pointer.x, pointer.y);

    renderer.render(scene, camera);

    // the readout mirrors the two numbers the shader actually uses
    if (meters.spread) {
      var spread = lerp(0.30, 1.75, scrollNow);
      var blend  = lerp(0.85, 0.30, scrollNow);
      meters.spread.style.setProperty('--v', (scrollNow * 100).toFixed(1) + '%');
      meters.blend.style.setProperty('--v', ((1 - scrollNow) * 100).toFixed(1) + '%');
      meters.steps.style.setProperty('--v', '100%');
      values.spread.textContent = spread.toFixed(2);
      values.blend.textContent  = blend.toFixed(2);
      values.steps.textContent  = String(STEPS);
    }

    if (!shown) { shown = true; veil.classList.add('is-gone'); }
  }

  /* ======================================================================
     Size
     ====================================================================== */

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(
      Math.round(w * renderer.getPixelRatio()),
      Math.round(h * renderer.getPixelRatio())
    );
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
