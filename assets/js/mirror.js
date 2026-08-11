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

  /* Your photo goes here; set it to null to fall back to the procedural scene
     further down. Same-origin or CORS-enabled, otherwise WebGL refuses to
     sample it.

     One rule about what you feed in: the picture must be the DRY half only.
     If it already has water in it — most hero shots of this kind do — crop it
     off at the waterline first, otherwise this page reflects a reflection and
     you get two sets of ripples fighting each other. */
  var IMAGE_URL = 'assets/images/hall.jpg';

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

    /* A limb is a tapered quad — wide at the joint, narrow at the end — with a
       disc capping each end. Uniform round strokes read as a stick figure;
       taper is most of what makes a silhouette look like a body. */
    function limb(ax, ay, bx, by, wa, wb) {
      var dx = bx - ax, dy = by - ay;
      var L  = Math.hypot(dx, dy) || 1;
      var nx = -dy / L, ny = dx / L;
      x.beginPath();
      x.moveTo(ax + nx * wa, ay + ny * wa);
      x.lineTo(bx + nx * wb, by + ny * wb);
      x.lineTo(bx - nx * wb, by - ny * wb);
      x.lineTo(ax - nx * wa, ay - ny * wa);
      x.closePath();
      x.fill();
      x.beginPath(); x.arc(ax, ay, wa, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(bx, by, wb, 0, Math.PI * 2); x.fill();
    }

    // Legs first, then the coat over them, then arms on top — back to front.
    limb(500, 654, 468, 762, 20, 14);          // front thigh
    limb(466, 764, 452, 846, 17, 12);          // front shin
    limb(452, 846, 414, 856, 12, 10);          // front boot
    limb(518, 654, 550, 756, 20, 14);          // back thigh
    limb(552, 758, 572, 844, 16, 12);          // back shin
    limb(572, 844, 606, 854, 12, 10);          // back boot

    /* The coat: shoulders down past the knee, flaring behind. Kept narrow —
       an earlier version was so wide it swallowed the whole body. */
    x.beginPath();
    x.moveTo(486, 508);
    x.lineTo(538, 508);
    x.bezierCurveTo(556, 560, 566, 636, 564, 700);
    x.bezierCurveTo(563, 736, 556, 766, 546, 790);
    x.lineTo(524, 782);
    x.bezierCurveTo(532, 742, 534, 700, 529, 664);
    x.lineTo(496, 670);
    x.bezierCurveTo(486, 638, 482, 566, 486, 508);
    x.closePath();
    x.fill();

    limb(510, 474, 512, 510, 10, 25);          // neck into shoulders
    limb(512, 510, 506, 658, 25, 18);          // torso under the coat

    /* Hood — narrow, and tipped forward over the face. An earlier one was as
       wide as the shoulders, which read as a mushroom rather than a head. */
    x.beginPath();
    x.moveTo(492, 486);
    x.bezierCurveTo(482, 452, 492, 422, 514, 420);
    x.bezierCurveTo(534, 418, 544, 438, 542, 460);
    x.bezierCurveTo(540, 480, 528, 494, 512, 496);
    x.closePath();
    x.fill();

    // leading arm, reaching out and slightly down
    limb(488, 518, 430, 558, 15, 11);
    limb(428, 558, 370, 576, 13, 9);

    // trailing arm, swung back behind the body
    limb(536, 520, 578, 584, 14, 10);
    limb(580, 584, 598, 652, 12, 9);

    // something long carried in the trailing hand
    limb(598, 652, 578, 766, 5, 4);
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

  /* The photo's aspect decides how it is fitted into the band above the water.
     It is only known once the file has decoded, so it starts at a sane default
     and the loader corrects it. */
  var imgAspect = 0.74;

  var photo;
  if (IMAGE_URL) {
    photo = new THREE.TextureLoader().load(
      IMAGE_URL,
      function (t) {
        if (t.image && t.image.height) {
          imgAspect = t.image.width / t.image.height;
          viewMat.uniforms.uImgAspect.value = imgAspect;
        }
      },
      undefined,
      function () {
        /* Opened straight off the disk, most likely: a browser treats one
           file:// path as cross-origin to another and refuses to hand the
           pixels to WebGL. Rather than show a blank page, fall back to the
           scene that is drawn in code. */
        photo.image = drawScene().image;
        photo.needsUpdate = true;
        imgAspect = 1;
        viewMat.uniforms.uImgAspect.value = 1;
      }
    );
  } else {
    photo = drawScene();
    imgAspect = 1;
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
      uLine  : { value: 0.44 },                  // where the water starts
      uImgAspect: { value: imgAspect }
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
      'uniform float uImgAspect;',

      'vec3 scene(vec2 s){',
      '  s = clamp(s, vec2(0.0), vec2(1.0));',
      '  return texture2D(uPhoto, s).rgb;',
      '}',

      /* Cover-fit. The photo is portrait and the band above the water usually
         is not, so one axis has to be cropped rather than squashed. Returns how
         much of the image's width and height stay visible.

         The crop is anchored to the BOTTOM of the image, not the centre: the
         image's last row has to land exactly on the waterline, otherwise the
         reflection starts from a different part of the picture than the one it
         is supposed to be mirroring. */
      'vec2 coverFit(){',
      '  float band = uRes.x / max(uRes.y * (1.0 - uLine), 1.0);',
      '  vec2 s = vec2(1.0);',
      '  if(band > uImgAspect) s.y = uImgAspect / band;',
      '  else                  s.x = band / uImgAspect;',
      '  return s;',
      '}',

      'void main(){',
      '  vec2 uv = vUv;',
      '  float W = uLine;',
      '  vec3 col;',

      '  vec2 fit = coverFit();',
      '  float u  = (uv.x - 0.5) * fit.x + 0.5;',

      /* The height field covers the whole viewport, not just the water, so the
         disturbance is read once here and used on both sides of the line. Below
         it bends a reflection; above it bends the picture itself, which is what
         makes the figure melt when you drag across it. */
      '  float hl = texture2D(uWave, uv + vec2(-uTexel.x, 0.0)).r;',
      '  float hr = texture2D(uWave, uv + vec2( uTexel.x, 0.0)).r;',
      '  float hd = texture2D(uWave, uv + vec2(0.0, -uTexel.y)).r;',
      '  float hu = texture2D(uWave, uv + vec2(0.0,  uTexel.y)).r;',
      '  vec2  grad = vec2(hr - hl, hu - hd);',
      '  float h    = texture2D(uWave, uv).r;',

      '  if(uv.y >= W){',
      /* Above the waterline: the picture, filling the upper band. v runs 0 at
         the waterline so the reflection below joins it seamlessly — the two
         halves have to meet at the same row of the image. */
      '    vec2 s = vec2(u, (uv.y - W) / (1.0 - W) * fit.y);',

      /* Dry, so no chop — only what the pointer put there. It is pushed harder
         than the water because there is no ambient ripple to ride on, and the
         picture has to visibly move to read as liquid. */
      '    s += grad * 2.6;',
      '    col = scene(s);',

      // a highlight along the disturbance, so it reads on the dark walls too
      '    col += vec3(0.24, 0.46, 0.62) * clamp(abs(h) * 3.2, 0.0, 1.0) * 0.45;',
      '  } else {',
      // below: the same picture mirrored, then bent by the water
      '    float d = (W - uv.y) / W;',            // 0 at the line, 1 at the bottom

      /* The streaks are the whole look. They come from displacing the sample
         HORIZONTALLY by an amount that changes fast as you move down — each
         row slides a different way, so a bright column smears into a ribbon.
         Low frequency near the waterline, tighter further down, the way real
         chop foreshortens with distance. */
      /* Perspective. Evenly spaced waves on a flat plane crowd together as
         they recede, so the phase runs on 1/distance, not on screen position.
         That single reciprocal gives dense ripples at the waterline opening
         out towards the viewer — the thing that makes water look like water
         rather than a wobbling texture. */
      '    float q = 8.0 / (d + 0.030);',

      '    float chop =',
      '        sin(q * 0.55 - uTime * 2.30) * 0.55',
      '      + sin(q * 1.20 + uTime * 1.40) * 0.34',
      '      + sin(q * 2.40 - uTime * 3.30) * 0.20',
      '      + sin(q * 0.30 + uv.x * 8.0 - uTime * 0.90) * 0.60',
      '      + sin(q * 4.30 + uv.x * 3.0 + uTime * 4.10) * 0.11;',

      // a much smaller vertical wobble — without it the streaks look like paper
      '    float lift = sin(q * 0.85 + uv.x * 12.0 - uTime * 1.7) * 0.4',
      '               + sin(q * 2.05 - uTime * 2.6) * 0.2;',

      /* Right at the waterline the ripples are finer than a pixel, so drawing
         them there is just aliasing. Fade them in over the first few percent —
         which is also what the horizon does in real life. */
      '    float near = smoothstep(0.0, 0.075, d);',

      '    vec2 disp;',
      /* The ambient chop has to stay legible near the waterline too, and the
         pointer's contribution has to stay small enough not to smear it out —
         a big smooth displacement swallows the fine streaks entirely. */
      '    disp.x = chop * 0.030 * (0.22 + d * 1.20) * near + grad.x * 0.75;',
      '    disp.y = lift * 0.0030 * (0.20 + d)       * near + grad.y * 0.40;',

      /* Sampling less of the picture over more of the screen stretches the
         reflection downward, which is what a shallow viewing angle does. */
      '    col = scene(vec2(u, d * 0.55 * fit.y) + disp);',

      // deeper water is darker, cooler and lower contrast
      '    float shade = mix(0.95, 0.30, d);',
      '    col = (col - 0.5) * mix(1.10, 0.82, d) + 0.5;',   // hold contrast up top
      '    col *= shade;',
      '    col  = mix(col, col * vec3(0.52, 0.74, 1.0), 0.6);',

      // the crest of each wave catches a little sky
      '    col += vec3(0.24, 0.44, 0.62) * clamp(chop, 0.0, 1.0) * 0.13 * near * (1.0 - d);',
      '    col += vec3(0.30, 0.52, 0.70) * clamp(grad.y * 5.0, 0.0, 1.0) * 0.45;',
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
