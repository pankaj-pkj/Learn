/* ==========================================================================
   AMBIENT — music and water, both synthesised in the browser.

   Drop <script src="assets/js/ambient.js"></script> on a page and that is the
   whole integration: this file builds its own control, injects its own styles,
   and starts itself.

   Nothing is recorded and nothing is downloaded, so there is no licence to
   honour and no bytes to ship.

   ── Why it is different every time ──
   The key, the chord progression, the tempo, the arpeggio pattern and the
   timbre are all chosen at random when the page loads. Two visits are never
   the same piece. The randomness is bounded — the chords are drawn from
   progressions that work and the notes from one scale — so it wanders without
   ever going wrong.

   ── Water ──
   A real droplet is not a "plop". It is a short click as the surface breaks,
   then a bubble trapped underneath ringing as it shrinks — which makes the
   pitch sweep *up*, not down. Get that backwards and it sounds like a cartoon.
   Pages can call `ambient.drop(x)` and `ambient.swish(speed, x)`; mirror.js
   drives both from the same pointer that disturbs the water.

   ── Starting on its own ──
   A browser will not let a page make noise before the visitor interacts with
   it, and no flag opts out. This tries at load, then starts at the first
   click, tap or keypress anywhere on the page.
   ========================================================================== */

(function (global) {
  'use strict';

  var STORE = 'ambient-muted';

  var pick = function (a) { return a[(Math.random() * a.length) | 0]; };
  var rand = function (a, b) { return a + Math.random() * (b - a); };

  /* ======================================================================
     Material
     ====================================================================== */

  // semitone offsets from the root, per chord — all minor-key colours that
  // sit next to each other without needing any voice leading
  var PROGRESSIONS = [
    [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 5], [-5, -1, 2, 7]],
    [[0, 3, 7, 14], [5, 8, 12, 15], [-2, 3, 5, 10], [0, 3, 7, 12]],
    [[0, 7, 12, 15], [-3, 4, 9, 12], [-5, 2, 7, 11], [-7, 0, 5, 12]]
  ];

  // scale degrees the plucks may use, so they always belong to the harmony
  var SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];

  var ROOTS = [130.81, 146.83, 155.56, 174.61, 196.00];   // C3 … G3

  var semi = function (root, n) { return root * Math.pow(2, n / 12); };

  /* ======================================================================
     Engine
     ====================================================================== */

  function Ambient() {
    this.ctx = null;
    this.playing = false;
    this.timers = [];
  }

  function impulse(ctx, seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function noiseBuffer(ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function pan(ctx, x) {
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = x;
      return p;
    }
    var q = ctx.createPanner();          // Safari fallback
    q.panningModel = 'equalpower';
    q.setPosition(x, 0, 1 - Math.abs(x));
    return q;
  }

  Ambient.prototype.build = function () {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;

    var ctx = this.ctx = new AC();
    var self = this;

    /* ---- the piece this visit gets ------------------------------------- */

    var root = pick(ROOTS);
    var prog = pick(PROGRESSIONS);
    var bpm  = rand(52, 72);
    var beat = 60 / bpm;
    var padWave = pick(['sawtooth', 'triangle', 'sawtooth']);
    var chordHold = beat * pick([8, 12, 16]);

    this.seed = { root: Math.round(root), bpm: Math.round(bpm), wave: padWave };

    /* ---- bus ------------------------------------------------------------ */

    var master = this.master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // a gentle ceiling, so a cluster of plucks and a splash never add up to a
    // spike — this is the difference between "soft" and "soft until it isn't"
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.3;
    comp.connect(master);

    var verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 4.2, 2.4);
    var wet = ctx.createGain(); wet.gain.value = 0.8;
    verb.connect(wet); wet.connect(comp);

    var dry = ctx.createGain(); dry.gain.value = 0.7;
    dry.connect(comp);

    /* A ping-pong delay on a dotted eighth. More than anything else here,
       this is what makes a few sparse notes feel like a piece of music. */
    var dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    dl.delayTime.value = beat * 0.75;
    dr.delayTime.value = beat * 0.75;
    var fb = ctx.createGain(); fb.gain.value = 0.36;
    var damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 2400;   // echoes darken

    dl.connect(pan(ctx, -0.75)).connect(comp);
    dl.connect(dr);
    dr.connect(pan(ctx, 0.75)).connect(comp);
    dr.connect(damp); damp.connect(fb); fb.connect(dl);

    var echoIn = ctx.createGain(); echoIn.gain.value = 0.55;
    echoIn.connect(dl);

    function send(node, echo) {
      node.connect(dry);
      node.connect(verb);
      if (echo) node.connect(echoIn);
    }

    /* ---- pad: four voices that glide between chords --------------------- */

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    lp.Q.value = 0.7;
    send(lp, false);

    var sweep = ctx.createOscillator();
    sweep.frequency.value = rand(0.02, 0.05);
    var sweepAmt = ctx.createGain();
    sweepAmt.gain.value = 700;
    sweep.connect(sweepAmt); sweepAmt.connect(lp.frequency); sweep.start();

    var slots = [];
    for (var v = 0; v < 4; v++) {
      var spread = (v - 1.5) / 1.5 * 0.55;              // wide, but not hard L/R
      var vg = ctx.createGain();
      vg.gain.value = 0.088;
      vg.connect(pan(ctx, spread)).connect(lp);

      var oscs = [];
      for (var k = 0; k < 2; k++) {
        var o = ctx.createOscillator();
        o.type = padWave;
        o.frequency.value = semi(root, prog[0][v]);
        o.detune.value = k ? 7 : -7;
        o.connect(vg); o.start();
        oscs.push(o);
      }

      // a slow independent tremolo so the voices never lock into one beat
      var lfo = ctx.createOscillator();
      lfo.frequency.value = rand(0.04, 0.09);
      var la = ctx.createGain(); la.gain.value = 0.02;
      lfo.connect(la); la.connect(vg.gain); lfo.start();

      slots.push(oscs);
    }

    var chordIndex = 0;
    var chord = prog[0];

    function moveChord() {
      chordIndex = (chordIndex + 1) % prog.length;
      chord = prog[chordIndex];
      var t = ctx.currentTime;
      for (var i = 0; i < slots.length; i++) {
        var f = semi(root, chord[i]);
        slots[i].forEach(function (o) {
          // a glide, not a jump — the chord change should never be an edit
          o.frequency.setTargetAtTime(f, t, 1.4);
        });
      }
      self.timers.push(setTimeout(moveChord, chordHold * 1000));
    }
    this.timers.push(setTimeout(moveChord, chordHold * 1000));

    /* ---- plucks --------------------------------------------------------- */

    var patterns = [
      [0, 1, 2, 1, 3, 2], [0, 2, 1, 3], [3, 1, 2, 0, 1], [0, 3, 2, 3, 1, 2]
    ];
    var pattern = pick(patterns);
    var step = 0;

    function pluck() {
      var t = ctx.currentTime;

      // most steps are rests: sparse is what makes it calm rather than busy
      if (Math.random() < 0.62) {
        var deg = chord[pattern[step % pattern.length]];
        if (Math.random() < 0.25) deg += 12;             // occasional octave up
        var f = semi(root, deg + pick([0, 0, 0, 12]));

        var o = ctx.createOscillator();
        o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
        o.frequency.value = f;

        // a second voice a fifth up at low level gives the note a bell edge
        var o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 1.5;

        var g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(rand(0.09, 0.15), t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + rand(2.4, 4.0));

        var g2 = ctx.createGain(); g2.gain.value = 0.18;
        o2.connect(g2); g2.connect(g);

        o.connect(g);
        send(g.connect(pan(ctx, rand(-0.5, 0.5))), true);

        o.start(t); o.stop(t + 4.2);
        o2.start(t); o2.stop(t + 4.2);
      }

      step++;
      self.timers.push(setTimeout(pluck, beat * 1000 * pick([1, 1, 1.5, 2])));
    }
    this.timers.push(setTimeout(pluck, beat * 1000));

    /* ---- air ------------------------------------------------------------ */

    var air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx, 4);
    air.loop = true;
    var abp = ctx.createBiquadFilter();
    abp.type = 'bandpass'; abp.frequency.value = 1800; abp.Q.value = 0.5;
    var ag = ctx.createGain(); ag.gain.value = 0.022;
    air.connect(abp); abp.connect(ag); send(ag, false);
    air.start();

    /* ---- water ---------------------------------------------------------- */

    this._noise = noiseBuffer(ctx, 1);
    this._send = send;
    this._comp = comp;

    return true;
  };

  /* A droplet: a short click as the surface parts, then a bubble ringing as
     it collapses — and a collapsing bubble rises in pitch. */
  Ambient.prototype.drop = function (x, force) {
    if (!this.ctx || !this.playing || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t = ctx.currentTime;
    force = force === undefined ? 1 : force;

    var p = pan(ctx, (x === undefined ? 0 : (x * 2 - 1)) * 0.7);
    p.connect(this._comp);
    var out = ctx.createGain(); out.gain.value = 1;
    out.connect(p);
    this._send(out, false);

    var f0 = rand(420, 900);
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(2.0, 3.2), t + 0.06);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.30 * force, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.16, 0.30));
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.4);

    // the break in the surface itself — brief, bright, almost subliminal
    var n = ctx.createBufferSource();
    n.buffer = this._noise;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1800;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14 * force, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp); hp.connect(ng); ng.connect(out);
    n.start(t); n.stop(t + 0.1);
  };

  /* Water being pushed rather than struck: a band of noise that opens and
     closes with how fast the pointer is moving. */
  Ambient.prototype.swish = function (amount, x) {
    if (!this.ctx || !this.playing || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t = ctx.currentTime;
    var a = Math.min(1, 0.25 + amount * 0.75);   // never a whisper
    if (amount < 0.02) return;

    var n = ctx.createBufferSource();
    n.buffer = this._noise;
    n.playbackRate.value = rand(0.8, 1.3);

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(rand(500, 900), t);
    bp.frequency.exponentialRampToValueAtTime(rand(1400, 2600), t + 0.22);
    bp.Q.value = 1.1;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34 * a, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.28, 0.5));

    var p = pan(ctx, (x === undefined ? 0 : (x * 2 - 1)) * 0.6);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(this._comp);
    this._send(g, false);

    n.start(t); n.stop(t + 0.7);
  };

  Ambient.prototype.start = function () {
    if (!this.ctx && !this.build()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.78, t + 3);
    this.playing = true;
    return this.ctx.state === 'running';
  };

  Ambient.prototype.stop = function () {
    if (!this.ctx) { this.playing = false; return; }
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.8);
    this.playing = false;
  };

  /* ======================================================================
     Its own control
     ====================================================================== */

  var CSS = [
    '.amb{position:fixed;left:16px;bottom:16px;z-index:2147483000;',
    'display:flex;align-items:center;gap:10px;',
    'padding:9px 15px 9px 12px;border-radius:100px;',
    'border:1px solid rgba(255,255,255,.16);background:rgba(6,8,12,.62);',
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);',
    'font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
    'letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.55);',
    'cursor:pointer;transition:color .3s,border-color .3s}',
    '.amb:hover{color:#fff;border-color:rgba(255,255,255,.4)}',
    '.amb.on{color:#fff;border-color:rgba(140,200,235,.55)}',
    '.amb b{display:flex;align-items:flex-end;gap:2px;height:11px}',
    '.amb i{display:block;width:2px;height:3px;border-radius:1px;',
    'background:currentColor;transition:height .3s}',
    '.amb.on i{animation:ambBar 1.1s ease-in-out infinite}',
    '.amb.on i:nth-child(2){animation-delay:.14s}',
    '.amb.on i:nth-child(3){animation-delay:.28s}',
    '.amb.on i:nth-child(4){animation-delay:.42s}',
    '@keyframes ambBar{0%,100%{height:3px}50%{height:11px}}',
    '@media(prefers-reduced-motion:reduce){.amb.on i{animation:none}}'
  ].join('');

  function mount() {
    if (document.querySelector('.amb')) return;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'amb';
    btn.setAttribute('aria-label', 'Toggle ambient sound');
    btn.innerHTML = '<b aria-hidden="true"><i></i><i></i><i></i><i></i></b><span></span>';
    document.body.appendChild(btn);

    var label = btn.querySelector('span');
    var amb   = new Ambient();
    var muted = false;
    try { muted = localStorage.getItem(STORE) === '1'; } catch (e) {}

    // pages drive the water sounds through this
    global.ambient = amb;

    /* "Wants to play" and "is making noise" differ while the browser is still
       withholding permission. The label follows the second. */
    function audible() {
      return amb.playing && amb.ctx && amb.ctx.state === 'running';
    }

    function paint() {
      var on = audible();
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      label.textContent = on ? 'Sound on' : 'Play sound';
    }

    /* Chrome counts a click, tap or keypress as user activation; a scroll is
       not one. The listeners are kept until the context is genuinely running,
       because dropping them on the first event of any kind meant someone who
       scrolled before clicking never got sound at all. */
    function arm() {
      var events = ['pointerdown', 'touchstart', 'touchend', 'keydown',
                    'click', 'wheel', 'scroll'];

      function go() {
        if (muted) { drop(); return; }
        amb.start();
        setTimeout(function () {
          if (amb.ctx && amb.ctx.state === 'running') drop();
          paint();
        }, 80);
      }
      function drop() {
        events.forEach(function (e) { global.removeEventListener(e, go, true); });
      }
      events.forEach(function (e) {
        global.addEventListener(e, go, { capture: true, passive: true });
      });
    }

    if (!muted && !amb.start()) arm();
    paint();

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (audible()) { amb.stop(); muted = true; }
      else           { amb.start(); muted = false; }
      try { localStorage.setItem(STORE, muted ? '1' : '0'); } catch (err) {}
      setTimeout(paint, 60);
    });

    document.addEventListener('visibilitychange', function () {
      if (!amb.ctx || !amb.playing) return;
      if (document.hidden) amb.ctx.suspend();
      else amb.ctx.resume();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(window);
