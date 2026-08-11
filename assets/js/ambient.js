/* ==========================================================================
   AMBIENT — a quiet pad, generated in the browser.

   Drop <script src="assets/js/ambient.js"></script> on any page and that is
   the whole integration: this file builds its own control, injects its own
   styles, and starts itself.

   There is no audio file. Every sound is synthesised with Web Audio at run
   time, which settles the licence question outright — nothing was recorded,
   nothing was downloaded — and costs zero bytes.

   ── About starting on its own ──
   A browser will not let a page make noise before the visitor has interacted
   with it. That is not a setting anyone can turn off; Chrome, Safari and
   Firefox all enforce it. So this tries to start at load, and if the browser
   refuses, it arms the *first* pointer, key, scroll or touch anywhere on the
   page and starts then. In practice nobody notices: by the time you have
   moved the mouse or begun to scroll, it is playing.

   Muting is remembered, so a visitor who turns it off is not asked twice.
   ========================================================================== */

(function (global) {
  'use strict';

  var STORE = 'ambient-muted';

  /* ======================================================================
     Synth
     ====================================================================== */

  function Ambient() {
    this.ctx = null;
    this.master = null;
    this.timer = null;
    this.playing = false;
  }

  /* A convolution reverb needs an impulse response. Rather than ship one,
     generate noise with an exponential decay — near enough to a small hall
     for a pad sitting this far back. */
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

  Ambient.prototype.build = function () {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;

    var ctx = this.ctx = new AC();

    var master = this.master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    var verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 3.6, 2.6);
    var wet = ctx.createGain(); wet.gain.value = 0.7;
    verb.connect(wet); wet.connect(master);

    var dry = ctx.createGain(); dry.gain.value = 0.55;
    dry.connect(master);

    function send(node) { node.connect(dry); node.connect(verb); }

    /* ---- drone ---------------------------------------------------------- */

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 0.6;
    send(lp);

    var sweep = ctx.createOscillator();
    sweep.frequency.value = 0.035;               // one pass every ~29 seconds
    var sweepAmt = ctx.createGain();
    sweepAmt.gain.value = 620;
    sweep.connect(sweepAmt);
    sweepAmt.connect(lp.frequency);
    sweep.start();

    /* An octave and a fifth up from where this started. The first version sat
       on G2/D3/A3 and measured -48 dB at 20-120 Hz with nothing above 600 —
       fine on headphones, inaudible on a laptop or a phone, which roll off
       hard below a few hundred hertz. */
    var chord = [196.00, 293.66, 440.00];        // G3, D4, A4 — open, no third

    chord.forEach(function (f, i) {
      [-5, 5].forEach(function (cents) {
        var o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;

        var g = ctx.createGain();
        g.gain.value = (i === 0 ? 0.20 : 0.115);

        // an independent slow tremolo per voice, so they never phase as one
        var lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + i * 0.017 + Math.random() * 0.02;
        var lfoAmt = ctx.createGain();
        lfoAmt.gain.value = g.gain.value * 0.45;
        lfo.connect(lfoAmt); lfoAmt.connect(g.gain); lfo.start();

        o.connect(g); g.connect(lp); o.start();

        // an octave up at low level: small speakers reproduce this, the
        // fundamental they mostly cannot
        var hi = ctx.createOscillator();
        hi.type = 'sine';
        hi.frequency.value = f * 2;
        hi.detune.value = cents * 1.6;
        var hg = ctx.createGain();
        hg.gain.value = g.gain.value * 0.30;
        hi.connect(hg); hg.connect(lp); hi.start();
      });
    });

    /* ---- air ------------------------------------------------------------ */

    var noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 4);
    noise.loop = true;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.6;

    var ng = ctx.createGain();
    ng.gain.value = 0.030;

    noise.connect(bp); bp.connect(ng); send(ng);
    noise.start();

    /* ---- bells ---------------------------------------------------------- */

    var SCALE = [293.66, 349.23, 392.00, 440.00, 523.25, 587.33];
    var self = this;

    function bell() {
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = SCALE[(Math.random() * SCALE.length) | 0];

      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.17, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);

      o.connect(g); send(g);
      o.start(t); o.stop(t + 4.4);

      self.timer = setTimeout(bell, 3800 + Math.random() * 6000);
    }
    this.timer = setTimeout(bell, 1600);

    return true;
  };

  Ambient.prototype.start = function () {
    if (!this.ctx && !this.build()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.34, t + 2.5);
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
     Its own control, so a page needs only the one script tag
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
    if (document.querySelector('.amb')) return;      // never mount twice

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

    /* "Wants to play" and "is actually making noise" are different things while
       the browser is still withholding permission. The label follows the second
       one, so it never claims sound the visitor cannot hear. */
    function audible() {
      return amb.playing && amb.ctx && amb.ctx.state === 'running';
    }

    function paint() {
      var on = audible();
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      label.textContent = on ? 'Sound on' : 'Play sound';
    }

    /* Try now. On a cold load the browser will almost certainly refuse, so
       fall back to the first thing the visitor does — anywhere on the page,
       not on this button. */
    function armFirstGesture() {
      /* Chrome only counts a click, tap or keypress as user activation — a
         scroll or a wheel does not. They are listened for anyway (Safari is
         looser), but the listeners are kept until the context is genuinely
         running. Dropping them on the first event meant that someone who
         scrolled before clicking never got any sound at all. */
      var events = ['pointerdown', 'touchstart', 'touchend', 'keydown',
                    'click', 'wheel', 'scroll'];

      function go() {
        if (muted) { drop(); return; }
        amb.start();
        // resume() settles a tick later, so check after it has
        setTimeout(function () {
          if (amb.ctx && amb.ctx.state === 'running') { drop(); }
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

    if (!muted) {
      if (!amb.start()) armFirstGesture();
    }
    paint();

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (amb.playing) { amb.stop(); muted = true; }
      else             { amb.start(); muted = false; }
      try { localStorage.setItem(STORE, muted ? '1' : '0'); } catch (err) {}
      paint();
    });

    // give the CPU back when nobody is looking
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
