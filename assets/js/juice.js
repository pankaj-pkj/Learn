/* ==========================================================================
   RAW Pressery — fruit orbiting the bottle
   A tilted ring of particles in 3D, projected by hand and split into two
   canvases: the half behind the bottle and the half in front of it. That
   split is the whole trick — it is what makes the swirl read as going round
   the bottle rather than sitting flat on top of it.
   ========================================================================== */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var TAU  = Math.PI * 2;
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* ======================================================================
     Flavours
     ====================================================================== */

  var FLAVOURS = [
    {
      word: 'Pomegranate',
      head: 'Ruby Pomegranate.', sub: "Nature's jewel.",
      body: 'Freshly pressed pomegranate, nothing added, delivering a tart and sweet perfection.',
      headR: 'Heart healthy goodness.',
      bodyR: 'Punicalagins and anthocyanins, the two things in this fruit worth learning to pronounce.',
      price: '₹150', unit: '/ 500 ml',
      a: '#d5133b', b: '#4a0410', glow: '#ff2f57', page: '#12030a'
    },
    {
      word: 'Valencia',
      head: 'Explosion of flavor.', sub: 'Sun, bottled.',
      body: 'Late-harvest Valencia oranges pressed within four hours of picking, pulp left in.',
      headR: 'Vitamin C, the long way.',
      bodyR: 'No concentrate, no reconstitution. What comes out of the fruit is what goes in the bottle.',
      price: '₹130', unit: '/ 500 ml',
      a: '#ff7a0d', b: '#4d1c00', glow: '#ffa227', page: '#140702'
    },
    {
      word: 'Cold Brew Berry',
      head: 'Deep and quiet.', sub: 'For the evening.',
      body: 'Blackcurrant and blueberry, steeped cold overnight so nothing sharp survives the night.',
      headR: 'Antioxidants, unbothered.',
      bodyR: 'Never heated, so the anthocyanins that make it purple are still doing their job.',
      price: '₹170', unit: '/ 500 ml',
      a: '#8a1fd6', b: '#230447', glow: '#b04dff', page: '#0b0316'
    }
  ];

  var index = 0;

  /* ======================================================================
     Elements
     ====================================================================== */

  var scene  = document.querySelector('[data-scene]');
  var back   = document.querySelector('.swirl--back');
  var front  = document.querySelector('.swirl--front');
  var bottle = document.querySelector('[data-bottle]');
  var sayL   = document.querySelector('.say--l');
  var sayR   = document.querySelector('.say--r');
  var dotsEl = document.querySelector('[data-dots]');

  var el = {
    word:  document.querySelector('[data-word]'),
    headL: document.querySelector('[data-head-l]'),
    subL:  document.querySelector('[data-sub-l]'),
    bodyL: document.querySelector('[data-body-l]'),
    price: document.querySelector('[data-price]'),
    headR: document.querySelector('[data-head-r]'),
    bodyR: document.querySelector('[data-body-r]')
  };

  var ctxB = back.getContext('2d');
  var ctxF = front.getContext('2d');

  /* ======================================================================
     The ring
     ====================================================================== */

  var bits  = [];
  var TILT  = 0.62;                 // how far the ring leans away from us
  var FOCAL = 900;

  function build() {
    bits = [];
    var small = window.innerWidth < 700;

    /* Two populations. The "liquid" one is fat, soft and hugs the ring line
       tightly — overlapped, it reads as a continuous ribbon of juice. The
       "seeds" scatter a little wider and carry the sharp wet highlights. */
    add(small ? 150 : 300, {
      rMin: 0.94, rMax: 1.06, spread: 0.10,
      sMin: 22,   sMax: 52,   liquid: true
    });
    add(small ? 120 : 240, {
      rMin: 0.80, rMax: 1.20, spread: 0.26,
      sMin: 2.2,  sMax: 8.0,  liquid: false
    });

    function add(n, o) {
      for (var i = 0; i < n; i++) {
        bits.push({
          ang:    Math.random() * TAU,
          r:      rand(o.rMin, o.rMax),
          tube:   rand(-o.spread, o.spread),
          lift:   rand(-o.spread, o.spread),
          size:   rand(o.sMin, o.sMax),
          liquid: o.liquid,
          spin:   rand(0.88, 1.12),      // near-uniform, so the ribbon holds
          wob:    Math.random() * TAU
        });
      }
    }
  }

  /* ======================================================================
     Draw
     ====================================================================== */

  var dpr = 1;
  var W = 0, H = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = scene.clientWidth;
    H = scene.clientHeight;

    [back, front].forEach(function (c) {
      c.width  = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    });
    ctxB.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxF.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hex(h, alpha) {
    var v = parseInt(h.slice(1), 16);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + alpha + ')';
  }

  var theta = 0;          // global rotation of the ring
  var drift = 0;          // extra spin fed by dragging

  function draw() {
    ctxB.clearRect(0, 0, W, H);
    ctxF.clearRect(0, 0, W, H);

    var cx   = W / 2;
    var cy   = H / 2;
    var base = Math.min(W, H) * 0.34;
    var f    = FLAVOURS[index];

    var sinT = Math.sin(TILT);
    var cosT = Math.cos(TILT);

    // Project everything first, then paint back-to-front. Painter's algorithm:
    // without the sort the ring looks like confetti, with it it looks solid.
    var out = [];

    for (var i = 0; i < bits.length; i++) {
      var p  = bits[i];
      var a  = p.ang + theta * p.spin;
      var wob = Math.sin(a * 3 + p.wob) * 0.06;

      var x = Math.cos(a) * base * (p.r + wob);
      var z = Math.sin(a) * base * (p.r + wob);
      var y = (p.lift + Math.sin(a * 2 + p.wob) * 0.09) * base
            + p.tube * base * 0.5;

      // lean the ring back around the X axis
      var y2 = y * cosT - z * sinT;
      var z2 = y * sinT + z * cosT;

      var s  = FOCAL / (FOCAL + z2);

      out.push({
        x: cx + x * s,
        y: cy + y2 * s,
        s: p.size * s,
        z: z2,
        liquid: p.liquid
      });
    }

    out.sort(function (m, n) { return n.z - m.z; });   // far first

    for (var k = 0; k < out.length; k++) {
      var o   = out[k];
      // Anything behind the ring's centre goes on the back canvas
      var ctx = o.z > 0 ? ctxB : ctxF;

      // Far side of the ring sits back into the dark, near side comes forward
      var depth = 1 - Math.min(1, Math.max(0, o.z) / (base * 1.6));
      var alpha = lerp(0.30, 1, depth);

      if (o.liquid) {
        // Soft, heavily overlapped — a hundred of these make one ribbon
        var g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.s);
        g.addColorStop(0,    hex(f.a, alpha * 0.30));
        g.addColorStop(0.6,  hex(f.a, alpha * 0.13));
        g.addColorStop(1,    hex(f.b, 0));
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.s, 0, TAU);
        ctx.fillStyle = g;
        ctx.fill();
        continue;
      }

      var gs = ctx.createRadialGradient(o.x - o.s * 0.3, o.y - o.s * 0.35, o.s * 0.1, o.x, o.y, o.s);
      gs.addColorStop(0,    hex(f.glow, alpha));
      gs.addColorStop(0.55, hex(f.a,    alpha * 0.95));
      gs.addColorStop(1,    hex(f.b,    alpha * 0.75));

      ctx.beginPath();
      ctx.arc(o.x, o.y, o.s, 0, TAU);
      ctx.fillStyle = gs;
      ctx.fill();

      // wet highlight
      if (o.s > 3.2) {
        ctx.beginPath();
        ctx.arc(o.x - o.s * 0.32, o.y - o.s * 0.36, o.s * 0.24, 0, TAU);
        ctx.fillStyle = 'rgba(255,240,240,' + (alpha * 0.6).toFixed(3) + ')';
        ctx.fill();
      }
    }
  }

  /* ======================================================================
     Drag
     ====================================================================== */

  var dragging = false, lastX = 0, dragged = 0, pid = null;

  scene.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button, a')) return;
    dragging = true; lastX = e.clientX; dragged = 0; pid = e.pointerId;
    scene.setPointerCapture(e.pointerId);
    scene.classList.add('is-dragging');
  });

  scene.addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== pid) return;
    var dx = e.clientX - lastX;
    lastX = e.clientX;
    dragged += dx;
    drift += dx * 0.0016;
  });

  function endDrag(e) {
    if (!dragging || (e && pid !== null && e.pointerId !== pid)) return;
    dragging = false; pid = null;
    scene.classList.remove('is-dragging');
    // a firm swipe changes flavour
    if (dragged < -90) go(1);
    else if (dragged > 90) go(-1);
  }
  scene.addEventListener('pointerup', endDrag);
  scene.addEventListener('pointercancel', endDrag);
  scene.addEventListener('lostpointercapture', endDrag);

  /* ======================================================================
     Flavour switching
     ====================================================================== */

  var swapping = false;

  function paint(f) {
    var root = document.documentElement.style;
    root.setProperty('--a', f.a);
    root.setProperty('--b', f.b);
    root.setProperty('--glow', f.glow);
    document.body.style.background = f.page;
  }

  function write(f) {
    el.word.textContent  = f.word;
    el.headL.textContent = f.head;
    el.subL.textContent  = f.sub;
    el.bodyL.textContent = f.body;
    el.price.innerHTML   = f.price + ' <i>' + f.unit + '</i>';
    el.headR.textContent = f.headR;
    el.bodyR.textContent = f.bodyR;
  }

  function go(step) {
    if (swapping) return;
    swapping = true;

    index = (index + step + FLAVOURS.length) % FLAVOURS.length;

    sayL.classList.add('is-out');
    sayR.classList.add('is-out');
    bottle.classList.add('is-out');

    // give the ring a shove in the direction of travel
    drift += step * 0.10;

    setTimeout(function () {
      var f = FLAVOURS[index];
      write(f);
      paint(f);
      markDots();
      sayL.classList.remove('is-out');
      sayR.classList.remove('is-out');
      bottle.classList.remove('is-out');
      swapping = false;
    }, reduced ? 0 : 340);
  }

  /* ======================================================================
     Controls
     ====================================================================== */

  document.querySelector('.arrow--prev').addEventListener('click', function () { go(-1); });
  document.querySelector('.arrow--next').addEventListener('click', function () { go(1); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  go(-1);
    if (e.key === 'ArrowRight') go(1);
  });

  FLAVOURS.forEach(function (f, i) {
    var li = document.createElement('li');
    var b  = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', f.word);
    b.addEventListener('click', function () {
      if (i !== index) go(i - index);
    });
    li.appendChild(b);
    dotsEl.appendChild(li);
  });

  function markDots() {
    var bs = dotsEl.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('is-live', i === index);
  }

  /* ======================================================================
     Loop
     ====================================================================== */

  function frame() {
    requestAnimationFrame(frame);
    drift *= 0.95;
    theta += (reduced ? 0 : 0.0022) + drift;
    draw();
  }

  var t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () { resize(); build(); }, 140);
  });

  resize();
  build();
  write(FLAVOURS[0]);
  paint(FLAVOURS[0]);
  markDots();
  frame();
})();
