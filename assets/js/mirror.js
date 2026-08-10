/* ==========================================================================
   MIRROR — a reflection sitting in water you can actually disturb.

   The ripples are not scrolling noise. A height field is stepped through the
   damped wave equation on the GPU every frame:

       next = (left + right + up + down) / 2 - previous,   then damped

   That one line is the whole simulation. Because it is a real wave equation,
   ripples spread at a finite speed, pass through each other, bounce off the
   edges and die out on their own — none of which a noise texture will do.

   The pointer injects a drop; the display pass reads the field's gradient and
   uses it to bend the reflection's texture coordinates.
   ========================================================================== */

(function () {
  'use strict';

  /* Drop your own photo in here and the procedural scene below is skipped.
     Same-origin or CORS-enabled, otherwise WebGL refuses to sample it. */
  var IMAGE_URL = null;

  var canvas  = document.getElementById('gl');
  var stage   = document.querySelector('.stage');
  var copies  = [].slice.call(document.querySelectorAll('[data-copy]'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  var SIM = Math.min(window.innerWidth, window.innerHeight) < 760 ? 192 : 320;

  /* ======================================================================
     The picture. Drawn once to a 2D canvas, then used as a texture.
     ====================================================================== */

  function drawScene() {
    var c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    var x = c.getContext('2d');

    x.fillStyle = '#04070b';
    x.fillRect(0, 0, 1024, 1024);

    // three lit doorways, the tall pair flanking a shorter middle one
    var doors = [
      { x: 118, y: 150, w: 200, h: 700 },
      { x: 706, y: 150, w: 200, h: 700 },
      { x: 432, y: 372, w: 160, h: 478 }
    ];

    doors.forEach(function (d) {
      var g = x.createLinearGradient(d.x, d.y, d.x, d.y + d.h);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.72, '#eaf6ff');
      g.addColorStop(1, '#b9dcf0');
      x.fillStyle = g;
      x.fillRect(d.x, d.y, d.w, d.h);

      // bloom around the opening
      x.save();
      x.globalCompositeOperation = 'lighter';
      x.filter = 'blur(38px)';
      x.fillStyle = 'rgba(150,205,240,.55)';
      x.fillRect(d.x - 40, d.y - 40, d.w + 80, d.h + 80);
      x.restore();
    });

    /* A figure mid-stride in the middle opening. Built from thick round-capped
       strokes rather than one outline — a stick figure with weight reads as a
       person far more reliably than a hand-guessed silhouette does. */
    x.save();
    x.filter = 'blur(1.2px)';
    x.strokeStyle = '#080d14';
    x.fillStyle   = '#080d14';
    x.lineCap = 'round';
    x.lineJoin = 'round';

    // Roughly seven heads tall, which is what stops a stick figure reading as
    // a scarecrow. Everything else hangs off these two points.
    var sho = [512, 494], hip = [512, 676];

    x.beginPath();                             // head
    x.arc(512, 438, 25, 0, Math.PI * 2);
    x.fill();

    x.lineWidth = 15;                          // neck
    x.beginPath();
    x.moveTo(512, 456); x.lineTo(sho[0], sho[1]);
    x.stroke();

    x.lineWidth = 44;                          // torso, tapering to the hips
    x.beginPath();
    x.moveTo(sho[0], sho[1]); x.lineTo(hip[0] - 4, hip[1]);
    x.stroke();

    x.lineWidth = 21;                          // leading arm, reaching forward
    x.beginPath();
    x.moveTo(sho[0] - 14, sho[1] + 8);
    x.lineTo(452, 560);
    x.lineTo(392, 578);
    x.stroke();

    x.beginPath();                             // trailing arm, swung back
    x.moveTo(sho[0] + 14, sho[1] + 8);
    x.lineTo(566, 578);
    x.lineTo(592, 648);
    x.stroke();

    x.lineWidth = 26;                          // front leg, mid-stride
    x.beginPath();
    x.moveTo(hip[0] - 6, hip[1]);
    x.lineTo(474, 768);
    x.lineTo(452, 852);
    x.stroke();

    x.beginPath();                             // back leg, pushing off
    x.moveTo(hip[0] + 6, hip[1]);
    x.lineTo(552, 764);
    x.lineTo(572, 852);
    x.stroke();

    x.lineWidth = 17;                          // a coat tail trailing behind
    x.beginPath();
    x.moveTo(528, 546);
    x.lineTo(572, 682);
    x.lineTo(560, 776);
    x.stroke();
    x.restore();

    // grain, so the flat gradients never band in the reflection
    var img = x.getImageData(0, 0, 1024, 1024);
    var px  = img.data;
    for (var i = 0; i < px.length; i += 4) {
      var n = (Math.random() - 0.5) * 16;
      px[i] += n; px[i + 1] += n; px[i + 2] += n;
    }
    x.putImageData(img, 0, 0);

    return new THREE.CanvasTexture(c);
  }

  var photo;
  if (IMAGE_URL) {
    photo = new THREE.TextureLoader().load(IMAGE_URL);
  } else {
    photo = drawScene();
  }
  photo.wrapS = photo.wrapT = THREE.ClampToEdgeWrapping;
  photo.minFilter = photo.magFilter = THREE.LinearFilter;

  /* ======================================================================
     Renderer and the two buffers the simulation ping-pongs between
     ====================================================================== */

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  var rtOpts = {
    type: THREE.HalfFloatType,          // the field goes negative, so not UnsignedByte
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false
  };

  var rtA = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);
  var rtB = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);
  var rtC = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);

  var simCam = new THREE.Camera();
  var simScene = new THREE.Scene();

  function quad() {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0
    ]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    return g;
  }

  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }';

  var simMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    uniforms: {
      uPrev  : { value: null },
      uCur   : { value: null },
      uTexel : { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uDrop  : { value: new THREE.Vector2(-9, -9) },
      uForce : { value: 0 },
      uRadius: { value: 0.028 }
    },
    fragmentShader: [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform sampler2D uPrev;',
      'uniform sampler2D uCur;',
      'uniform vec2  uTexel;',
      'uniform vec2  uDrop;',
      'uniform float uForce;',
      'uniform float uRadius;',
      'void main(){',
      '  float cur  = texture2D(uCur,  vUv).r;',
      '  float prev = texture2D(uPrev, vUv).r;',
      // four neighbours — this is the laplacian, and the whole simulation
      '  float sum =',
      '      texture2D(uCur, vUv + vec2( uTexel.x, 0.0)).r',
      '    + texture2D(uCur, vUv + vec2(-uTexel.x, 0.0)).r',
      '    + texture2D(uCur, vUv + vec2(0.0,  uTexel.y)).r',
      '    + texture2D(uCur, vUv + vec2(0.0, -uTexel.y)).r;',
      '  float next = sum * 0.5 - prev;',
      '  next *= 0.9915;',                       // damping — without it, it rings forever
      // the pointer pushes the surface down where it touches
      '  float d = distance(vUv, uDrop);',
      '  next -= uForce * smoothstep(uRadius, 0.0, d);',
      '  gl_FragColor = vec4(next, 0.0, 0.0, 1.0);',
      '}'
    ].join('\n')
  });

  simScene.add(new THREE.Mesh(quad(), simMat));

  /* ======================================================================
     Display pass
     ====================================================================== */

  var viewScene = new THREE.Scene();
  var viewCam   = new THREE.Camera();

  var viewMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    uniforms: {
      uPhoto : { value: photo },
      uWave  : { value: null },
      uTexel : { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uRes   : { value: new THREE.Vector2(1, 1) },
      uTime  : { value: 0 },
      uLine  : { value: 0.44 }                   // where the water starts
    },
    fragmentShader: [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform sampler2D uPhoto;',
      'uniform sampler2D uWave;',
      'uniform vec2  uTexel;',
      'uniform vec2  uRes;',
      'uniform float uTime;',
      'uniform float uLine;',

      'vec3 scene(vec2 s){',
      '  s = clamp(s, vec2(0.0), vec2(1.0));',
      '  return texture2D(uPhoto, s).rgb;',
      '}',

      'void main(){',
      '  vec2 uv = vUv;',
      '  float W = uLine;',
      '  vec3 col;',

      '  if(uv.y >= W){',
      /* Above the waterline: the picture, filling the upper band. v runs 0 at
         the waterline so the reflection below joins it seamlessly — the two
         halves have to meet at the same row of the image. */
      '    col = scene(vec2(uv.x, (uv.y - W) / (1.0 - W)));',
      '  } else {',
      // below: the same picture mirrored, then bent by the water
      '    float d = (W - uv.y) / W;',            // 0 at the line, 1 at the bottom

      // the height field's gradient is the surface slope, which is what
      // actually displaces a reflection
      '    float hl = texture2D(uWave, uv + vec2(-uTexel.x, 0.0)).r;',
      '    float hr = texture2D(uWave, uv + vec2( uTexel.x, 0.0)).r;',
      '    float hd = texture2D(uWave, uv + vec2(0.0, -uTexel.y)).r;',
      '    float hu = texture2D(uWave, uv + vec2(0.0,  uTexel.y)).r;',
      '    vec2  grad = vec2(hr - hl, hu - hd);',

      // a slow swell so the water is alive even when nobody touches it
      '    float swell = sin(uv.x * 26.0 + uTime * 1.1) * 0.5',
      '                + sin(uv.x * 61.0 - uTime * 0.7) * 0.25;',

      '    vec2 disp = grad * 0.85 + vec2(0.0, swell * 0.0022);',
      '    disp *= 0.35 + d * 1.25;',            // distortion grows with distance

      '    vec2 s = vec2(uv.x, 1.0 - d * 0.92) + disp;',
      '    col = scene(s);',

      // water is darker, cooler, and loses contrast with depth
      '    col *= mix(0.86, 0.34, d);',
      '    col  = mix(col, col * vec3(0.55, 0.78, 1.0), 0.55);',
      '    col += vec3(0.30, 0.52, 0.70) * clamp(grad.y * 6.0, 0.0, 1.0) * 0.5;',
      '  }',

      // a thin bright seam exactly on the waterline
      '  col += vec3(0.5, 0.72, 0.9) * smoothstep(0.004, 0.0, abs(uv.y - W)) * 0.25;',

      '  col = pow(clamp(col, 0.0, 1.0), vec3(0.95));',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });

  viewScene.add(new THREE.Mesh(quad(), viewMat));

  /* ======================================================================
     Pointer — every move drops something in the water
     ====================================================================== */

  var drop = { x: -9, y: -9, force: 0 };

  function place(e) {
    var r = stage.getBoundingClientRect();
    drop.x = (e.clientX - r.left) / r.width;
    drop.y = 1 - (e.clientY - r.top) / r.height;
    drop.force = 0.055;
  }

  stage.addEventListener('pointermove', place, { passive: true });
  stage.addEventListener('pointerdown', function (e) { place(e); drop.force = 0.16; });

  /* ======================================================================
     Loop
     ====================================================================== */

  var t0 = performance.now();
  var rain = 0;

  function step(now) {
    requestAnimationFrame(step);

    for (var i = 0; i < copies.length; i++) {
      if (copies[i].getBoundingClientRect().top < window.innerHeight * 0.8) {
        copies[i].classList.add('is-in');
      }
    }

    if (!reduced) {
      // an occasional stray drop, so the surface never goes completely flat
      if (--rain <= 0) {
        rain = 90 + Math.random() * 150;
        simMat.uniforms.uDrop.value.set(Math.random(), Math.random() * 0.9);
        simMat.uniforms.uForce.value = 0.03;
        simMat.uniforms.uRadius.value = 0.012;
      } else {
        simMat.uniforms.uDrop.value.set(drop.x, drop.y);
        simMat.uniforms.uForce.value = drop.force;
        simMat.uniforms.uRadius.value = 0.028;
      }

      // prev <- cur <- next, by rotating which target we write into
      simMat.uniforms.uPrev.value = rtA.texture;
      simMat.uniforms.uCur.value  = rtB.texture;
      renderer.setRenderTarget(rtC);
      renderer.render(simScene, simCam);

      var tmp = rtA; rtA = rtB; rtB = rtC; rtC = tmp;

      drop.force *= 0.72;
    }

    viewMat.uniforms.uWave.value = rtB.texture;
    viewMat.uniforms.uTime.value = (now - t0) / 1000;

    renderer.setRenderTarget(null);
    renderer.render(viewScene, viewCam);
  }

  /* ======================================================================
     Size
     ====================================================================== */

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    viewMat.uniforms.uRes.value.set(w, h);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(step);
})();
