/* ==========================================================================
   AMBIENT — a quiet pad, generated in the browser.

   There is no audio file here. Every sound is synthesised with Web Audio at
   run time, which settles the licence question outright: nothing was recorded,
   nothing was downloaded, nothing is anyone else's. It also costs zero bytes.

   Three layers, all deliberately dull:
     · a drone — three chord tones, each two detuned oscillators, under a
       lowpass whose cutoff drifts over half a minute
     · a bell   — one soft note every several seconds from a pentatonic set,
       so it can never land on a wrong interval
     · air      — filtered noise at the edge of hearing, which is what stops
       the whole thing sounding like a synth patch

   It never starts on its own. Browsers block that anyway, and background music
   nobody asked for is rude.
   ========================================================================== */

(function (global) {
  'use strict';

  function Ambient() {
    this.ctx     = null;
    this.master  = null;
    this.voices  = [];
    this.timer   = null;
    this.playing = false;
  }

  /* A convolution reverb needs an impulse response. Rather than ship one,
     generate noise with an exponential decay — that is what a small hall
     measures like, near enough for a pad sitting this far back. */
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
    var AC  = global.AudioContext || global.webkitAudioContext;
    var ctx = this.ctx = new AC();

    var master = this.master = ctx.createGain();
    master.gain.value = 0;                       // faded up on start
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

    // a slow sweep on the cutoff, so it breathes instead of sitting still
    var sweep = ctx.createOscillator();
    sweep.frequency.value = 0.035;               // one pass every ~29 seconds
    var sweepAmt = ctx.createGain();
    sweepAmt.gain.value = 620;
    sweep.connect(sweepAmt);
    sweepAmt.connect(lp.frequency);
    sweep.start();
    this.voices.push(sweep);

    /* An octave and a fifth up from where this started. The first version sat
       on G2/D3/A3 and measured -48 dB at 20-120 Hz with nothing above 600 —
       fine on studio monitors, inaudible on a laptop or a phone, which roll off
       hard below a few hundred hertz. */
    var chord = [196.00, 293.66, 440.00];        // G3, D4, A4 — open, no third
    var self = this;

    chord.forEach(function (f, i) {
      [-5, 5].forEach(function (cents) {         // two per note, slightly apart
        var o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;

        var g = ctx.createGain();
        g.gain.value = (i === 0 ? 0.20 : 0.115);

        // an independent slow tremolo per voice keeps them from phasing as one
        var lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + i * 0.017 + Math.random() * 0.02;
        var lfoAmt = ctx.createGain();
        lfoAmt.gain.value = g.gain.value * 0.45;
        lfo.connect(lfoAmt);
        lfoAmt.connect(g.gain);
        lfo.start();

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

        self.voices.push(o, lfo, hi);
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
    ng.gain.value = 0.030;                       // barely there, on purpose

    noise.connect(bp); bp.connect(ng); send(ng);
    noise.start();
    this.voices.push(noise);

    /* ---- bells ---------------------------------------------------------- */

    var SCALE = [293.66, 349.23, 392.00, 440.00, 523.25, 587.33];

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
  };

  Ambient.prototype.start = function () {
    if (!this.ctx) this.build();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.34, t + 2.5);
    this.playing = true;
  };

  Ambient.prototype.stop = function () {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.8);
    this.playing = false;
  };

  Ambient.prototype.toggle = function () {
    this.playing ? this.stop() : this.start();
    return this.playing;
  };

  /* ======================================================================
     Wire it to a button
     ====================================================================== */

  function mount(btn) {
    if (!btn) return;
    var amb = new Ambient();

    function paint() {
      btn.setAttribute('aria-pressed', String(amb.playing));
      btn.classList.toggle('is-on', amb.playing);
      /* "Sound off" reads as a statement about the current state; "Play sound"
         reads as the thing clicking it will do. */
      btn.querySelector('[data-label]').textContent = amb.playing ? 'Sound on' : 'Play sound';
    }

    btn.addEventListener('click', function () {
      btn.classList.remove('is-new');
      amb.toggle();
      paint();
    });

    // draw the eye once, then stop pestering
    btn.classList.add('is-new');
    setTimeout(function () { btn.classList.remove('is-new'); }, 12000);

    // give the CPU back when the tab is not being looked at
    document.addEventListener('visibilitychange', function () {
      if (!amb.ctx || !amb.playing) return;
      if (document.hidden) amb.ctx.suspend();
      else amb.ctx.resume();
    });

    paint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount(document.querySelector('[data-sound]'));
    });
  } else {
    mount(document.querySelector('[data-sound]'));
  }
})(window);
