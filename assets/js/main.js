/* ==========================================================================
   ZOI ICE TEA — scroll engine
   Every animation is scrubbed from scroll position, so it plays forwards and
   backwards and never drifts out of sync with the page.
   ========================================================================== */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- small helpers ---------------------------------------------------- */

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp  = function (a, b, t) { return a + (b - a) * t; };

  /** Progress of a scroll track: 0 when its top hits the viewport top,
   *  1 when its bottom does. */
  function trackProgress(el) {
    var r = el.getBoundingClientRect();
    var travel = r.height - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp(-r.top / travel, 0, 1);
  }

  /** Remap p from [a,b] onto [0,1], clamped. */
  function phase(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }

  /** Ease a 0..1 phase into a 0..1..0 window (fade in, hold, fade out). */
  function window01(p, inA, inB, outA, outB) {
    return Math.min(phase(p, inA, inB), 1 - phase(p, outA, outB));
  }

  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  /* ======================================================================
     Menu
     ====================================================================== */

  var menuBtn = document.querySelector('.menu');
  var drawer  = document.querySelector('.drawer');

  function setMenu(open) {
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      drawer.hidden = false;
      requestAnimationFrame(function () { drawer.classList.add('is-open'); });
      document.body.style.overflow = 'hidden';
    } else {
      drawer.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(function () {
        if (menuBtn.getAttribute('aria-expanded') === 'false') drawer.hidden = true;
      }, 450);
    }
  }

  menuBtn.addEventListener('click', function () {
    setMenu(menuBtn.getAttribute('aria-expanded') !== 'true');
  });
  drawer.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') setMenu(false);
  });

  /* ======================================================================
     Ice shatter — procedural shards on canvas, scrubbed by hero progress
     ====================================================================== */

  var canvas = document.querySelector('.shards');
  var ctx    = canvas.getContext('2d');
  var shards = [];
  var dpr    = 1;

  function buildShards() {
    shards = [];
    var count = window.innerWidth < 700 ? 34 : 58;

    for (var i = 0; i < count; i++) {
      // Points start on a rough ring around the block and fly outward.
      var ang  = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      var seed = Math.random();
      var pts  = [];
      var n    = 3 + (Math.random() * 3 | 0);          // 3–5 sided splinters
      var size = lerp(9, 46, Math.pow(seed, 1.7));

      for (var k = 0; k < n; k++) {
        var a = (k / n) * Math.PI * 2 + Math.random() * 0.9;
        var r = size * lerp(0.45, 1, Math.random());
        pts.push([Math.cos(a) * r, Math.sin(a) * r * lerp(0.6, 1.25, Math.random())]);
      }

      shards.push({
        pts:   pts,
        ang:   ang,
        // start radius (inside the block) and how far it travels
        r0:    lerp(0.04, 0.30, Math.random()),
        r1:    lerp(0.55, 1.55, Math.pow(Math.random(), 0.7)),
        drift: (Math.random() - 0.5) * 0.55,
        spin:  (Math.random() - 0.5) * 7,
        rot0:  Math.random() * Math.PI * 2,
        depth: lerp(0.55, 1.4, Math.random()),          // parallax + scale
        delay: Math.random() * 0.32,                    // staggered break-up
        alpha: lerp(0.35, 0.9, Math.random())
      });
    }
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(canvas.clientWidth  * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawShards(p) {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (p <= 0.001) return;

    var cx    = w / 2;
    var cy    = h / 2;
    var reach = Math.max(w, h) * 0.62;

    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      var t = easeOut(clamp((p - s.delay) / (1 - s.delay), 0, 1));
      if (t <= 0) continue;

      var rad = lerp(s.r0, s.r1, t) * reach * s.depth;
      var ang = s.ang + s.drift * t;
      var x   = cx + Math.cos(ang) * rad;
      // a little gravity so shards arc rather than fly flat
      var y   = cy + Math.sin(ang) * rad * 0.82 + Math.pow(t, 2) * h * 0.16;

      // fade out as they leave, and never draw off-canvas work
      var a = s.alpha * Math.min(1, t * 5) * (1 - Math.pow(t, 2.6));
      if (a <= 0.01) continue;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';   // ice catches light, never darkens
      ctx.translate(x, y);
      ctx.rotate(s.rot0 + s.spin * t);
      ctx.scale(s.depth, s.depth);

      ctx.beginPath();
      ctx.moveTo(s.pts[0][0], s.pts[0][1]);
      for (var k = 1; k < s.pts.length; k++) ctx.lineTo(s.pts[k][0], s.pts[k][1]);
      ctx.closePath();

      var g = ctx.createLinearGradient(-24, -24, 24, 24);
      g.addColorStop(0,   'rgba(255,255,255,' + (a * 0.95).toFixed(3) + ')');
      g.addColorStop(0.45,'rgba(198,234,255,' + (a * 0.55).toFixed(3) + ')');
      g.addColorStop(1,   'rgba(122,186,240,' + (a * 0.28).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fill();

      ctx.lineWidth   = 1;
      ctx.strokeStyle = 'rgba(240,252,255,' + (a * 0.9).toFixed(3) + ')';
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ======================================================================
     Per-frame scroll render
     ====================================================================== */

  var hero      = document.querySelector('.hero');
  var heroTitle = document.querySelector('[data-hero="title"]');
  var heroIce   = document.querySelector('[data-hero="ice"]');
  var heroMeta  = document.querySelector('[data-hero="meta"]');
  var heroCue   = document.querySelector('[data-hero="cue"]');
  var heroWash  = document.querySelector('[data-hero="wash"]');
  var iceBlock  = document.querySelector('.ice__block');

  var deep      = document.querySelector('.deep');
  var deepWord  = document.querySelector('[data-deep="word"]');
  var fan       = document.querySelector('[data-deep="fan"]');
  var fanCards  = Array.prototype.slice.call(document.querySelectorAll('.fan__card'));
  var flavours  = document.querySelector('[data-deep="flavours"]');

  var parallaxEls = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));

  function renderHero() {
    var p = trackProgress(hero);

    /* 0.00 → 0.16  can settles, headline drifts apart
       0.16 → 0.68  ice shatters
       0.70 → 1.00  everything lifts away and the blue washes in            */

    var shatter = phase(p, 0.16, 0.68);
    var exit    = phase(p, 0.70, 1.00);

    heroTitle.style.transform =
      'translate3d(0,' + (-p * 22).toFixed(2) + 'vh,0) scale(' + (1 + p * 0.14).toFixed(4) + ')';
    heroTitle.style.opacity = (1 - phase(p, 0.72, 0.99)).toFixed(3);

    var iceScale = lerp(1, 1.34, easeOut(shatter)) * (1 - exit * 0.22);
    heroIce.style.transform =
      'translate3d(0,' + (-exit * 26).toFixed(2) + 'vh,0) scale(' + iceScale.toFixed(4) + ') rotate(' + (p * 7).toFixed(2) + 'deg)';
    heroIce.style.opacity = (1 - phase(p, 0.80, 1.00)).toFixed(3);

    // the block itself dissolves as the shards take over
    iceBlock.style.opacity   = (1 - phase(p, 0.18, 0.50)).toFixed(3);
    iceBlock.style.transform = 'scale(' + lerp(1, 1.18, shatter).toFixed(4) + ')';

    heroWash.style.opacity = phase(p, 0.74, 1.00).toFixed(3);

    var metaOut = phase(p, 0.08, 0.28);
    heroMeta.style.opacity   = (1 - metaOut).toFixed(3);
    heroMeta.style.transform = 'translate3d(0,' + (metaOut * 30).toFixed(1) + 'px,0)';
    heroCue.style.opacity    = (1 - phase(p, 0.02, 0.16)).toFixed(3);

    drawShards(shatter);
  }

  function renderDeep() {
    var p = trackProgress(deep);

    /* 0.00 → 0.20  EXPERIENCE
       0.16 → 0.60  cards fan out of the stack, then re-stack
       0.58 → 1.00  Unique Flavors                                          */

    var wordA = window01(p, 0.00, 0.07, 0.12, 0.18);
    deepWord.style.opacity   = wordA.toFixed(3);
    deepWord.style.transform =
      'translate3d(0,' + ((0.5 - p) * 90).toFixed(1) + 'px,0) scale(' + (0.94 + wordA * 0.06).toFixed(3) + ')';

    var fanA = window01(p, 0.14, 0.22, 0.46, 0.54);
    fan.style.opacity = fanA.toFixed(3);

    // spread runs 0 → 1 → 0 across the fan's life so the deck opens and closes
    var spread = easeOut(window01(p, 0.16, 0.34, 0.38, 0.52));

    // How far apart the deck opens, capped so five cards still fit a phone
    var reach = Math.min(205, window.innerWidth * 0.145);

    for (var i = 0; i < fanCards.length; i++) {
      var card = fanCards[i];
      var idx  = parseFloat(card.style.getPropertyValue('--i'));
      var x    = idx * lerp(6, reach, spread);
      var y    = Math.abs(idx) * lerp(4, -26, spread) + (1 - spread) * 10;
      var rot  = idx * lerp(1.5, 7, spread);
      var rotY = idx * lerp(0, -13, spread);
      var z    = lerp(0, 60, spread) * (2 - Math.abs(idx));

      card.style.transform =
        'translate3d(calc(-50% + ' + x.toFixed(1) + 'px), calc(-50% + ' + y.toFixed(1) + 'px), ' + z.toFixed(1) + 'px)' +
        ' rotate(' + rot.toFixed(2) + 'deg) rotateY(' + rotY.toFixed(2) + 'deg)';
      card.style.zIndex = String(10 - Math.abs(idx));
    }

    var flavA = phase(p, 0.54, 0.68);
    flavours.style.opacity   = flavA.toFixed(3);
    flavours.style.transform = 'translate3d(0,' + ((1 - flavA) * 46).toFixed(1) + 'px,0)';
    flavours.style.pointerEvents = flavA > 0.5 ? 'auto' : 'none';
  }

  function renderParallax() {
    if (window.innerWidth <= 900) return;
    for (var i = 0; i < parallaxEls.length; i++) {
      var el = parallaxEls[i];
      var r  = el.getBoundingClientRect();
      var mid = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
      var amt = parseFloat(el.dataset.parallax) || 0;
      el.style.transform = 'translate3d(0,' + (mid * amt * -160).toFixed(1) + 'px,0)';
    }
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      renderHero();
      renderDeep();
      renderParallax();
      ticking = false;
    });
  }

  /* ======================================================================
     Reveal on enter
     ====================================================================== */

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('[data-reveal]').forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  var yr = document.querySelector('[data-year]');
  if (yr) yr.textContent = new Date().getFullYear();

  function boot() {
    resizeCanvas();
    buildShards();
    onScroll();
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(boot, 140);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('load', boot);
  boot();

  if (reduced) {
    // Still scrub, just skip the idle motion — handled in CSS. Nothing to do here.
  }
})();
