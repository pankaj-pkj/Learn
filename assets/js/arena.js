/* ==========================================================================
   ARENA — a loot crate and a rifle, both modelled in code.

   Nothing here is downloaded. Every part is three.js primitive geometry, which
   means: no .glb request, no CORS problem over file://, no licence to honour,
   and the whole thing is a few KB of source instead of a few MB of asset.

   The useful consequence is that each part stays a separate mesh with a name,
   so the reload choreography drives real objects — the magazine really drops,
   the charging handle really travels.
   ========================================================================== */

(function () {
  'use strict';

  var canvas  = document.getElementById('gl');
  var stage   = document.querySelector('.stage');
  var hintEl  = document.querySelector('[data-hint]');
  var copies  = [].slice.call(document.querySelectorAll('[data-copy]'));
  var lootEl  = document.querySelector('[data-loot]');
  var phaseEl = document.querySelector('[data-phase]');
  var stepEls = [].slice.call(document.querySelectorAll('[data-steps] li'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp  = function (a, b, t) { return a + (b - a) * t; };
  var ease  = function (t) { return t * t * (3 - 2 * t); };
  var phase = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };

  var PHASES = ['01 · MAG OUT', '02 · MAG IN', '03 · CHARGE & FIRE'];

  /* ======================================================================
     Renderer
     ====================================================================== */

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding      = THREE.sRGBEncoding;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;

  var scene  = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.05).texture;

  var key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(5, 8, 6);
  scene.add(key);

  var rim = new THREE.DirectionalLight(0xff5a20, 2.4);   // the site's blood red
  rim.position.set(-7, 3, -6);
  scene.add(rim);

  var cool = new THREE.DirectionalLight(0x6f9dd0, 0.4);
  cool.position.set(-2, 2, 7);
  scene.add(cool);

  scene.add(new THREE.AmbientLight(0xffffff, 0.05));

  /* ======================================================================
     Materials
     ====================================================================== */

  function steel(color, rough, metal) {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: rough === undefined ? 0.42 : rough,
      metalness: metal === undefined ? 0.92 : metal,
      envMapIntensity: 0.34
    });
  }

  var MAT = {
    crate  : steel(0x141824, 0.55),
    plate  : steel(0x1c2231, 0.44),
    trim   : steel(0xff3d14, 0.36, 0.7),
    bolt   : steel(0x4e5668, 0.3),
    gunDark: steel(0x0b0e14, 0.44),
    gunMid : steel(0x161b27, 0.38),
    grip   : steel(0x08090d, 0.78, 0.15),
    brass  : steel(0xd9932f, 0.28),
    glass  : new THREE.MeshStandardMaterial({
      color: 0x9fb6d0, roughness: 0.08, metalness: 0.1,
      transparent: true, opacity: 0.45
    }),
    hot    : new THREE.MeshBasicMaterial({ color: 0xffd27a })
  };

  /* ======================================================================
     Loot crate — a body, four drop-away side panels, a hinged lid
     ====================================================================== */

  var crate    = new THREE.Group();
  var cratePan = [];        // the four sides, they fall outward
  var crateLid = new THREE.Group();
  var rewards  = [];

  (function buildCrate() {
    var S = 1.5;                                    // half-extent of the box

    // floor of the crate
    var floor = new THREE.Mesh(new THREE.BoxGeometry(S * 2, 0.16, S * 2), MAT.crate);
    floor.position.y = -S;
    crate.add(floor);

    // the glow that lives inside and leaks out as it opens
    var core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.62, 1),
      new THREE.MeshBasicMaterial({ color: 0xffb03c })
    );
    core.position.y = -S * 0.35;
    crate.add(core);

    var coreLight = new THREE.PointLight(0xffa030, 0, 9, 2);
    coreLight.position.copy(core.position);
    crate.add(coreLight);

    // four sides. Each gets its own pivot so it hinges at the bottom edge.
    var sides = [
      { rot: 0,               nx: 0,  nz: 1  },
      { rot: Math.PI,         nx: 0,  nz: -1 },
      { rot: Math.PI / 2,     nx: 1,  nz: 0  },
      { rot: -Math.PI / 2,    nx: -1, nz: 0  }
    ];

    sides.forEach(function (s) {
      var pivot = new THREE.Group();
      pivot.position.set(s.nx * S, -S, s.nz * S);
      pivot.rotation.y = s.rot;

      var panel = new THREE.Mesh(new THREE.BoxGeometry(S * 2, S * 2, 0.14), MAT.plate);
      panel.position.y = S;
      pivot.add(panel);

      // a red band and two rivets, so the panel reads as built not extruded
      var band = new THREE.Mesh(new THREE.BoxGeometry(S * 2, 0.2, 0.18), MAT.trim);
      band.position.set(0, S * 0.55, 0.02);
      pivot.add(band);

      [-1, 1].forEach(function (d) {
        var rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12), MAT.bolt);
        rivet.rotation.x = Math.PI / 2;
        rivet.position.set(d * S * 0.7, S * 1.45, 0.04);
        pivot.add(rivet);
      });

      pivot.userData = { hx: s.nx * S, hz: s.nz * S };
      crate.add(pivot);
      cratePan.push(pivot);
    });

    // lid, hinged along the back edge
    crateLid.position.set(0, S, -S);
    var lid = new THREE.Mesh(new THREE.BoxGeometry(S * 2, 0.18, S * 2), MAT.crate);
    lid.position.z = S;
    crateLid.add(lid);

    var lidTrim = new THREE.Mesh(new THREE.BoxGeometry(S * 2, 0.22, 0.22), MAT.trim);
    lidTrim.position.set(0, 0.04, S * 1.9);
    crateLid.add(lidTrim);
    crate.add(crateLid);

    // rewards that shoot out — a coin, a gem, two chips
    var shapes = [
      new THREE.CylinderGeometry(0.3, 0.3, 0.07, 20),
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.BoxGeometry(0.34, 0.34, 0.07),
      new THREE.TetrahedronGeometry(0.3, 0)
    ];
    var tints = [0xf5b841, 0x22d3ee, 0x25d07a, 0xff8a3d];

    shapes.forEach(function (g, i) {
      var m = new THREE.Mesh(g, steel(tints[i], 0.24, 0.85));
      m.userData = {
        ang  : (i / shapes.length) * Math.PI * 2,
        rise : 2.4 + i * 0.42,
        out  : 0.55 + i * 0.2,
        spin : 2 + i
      };
      m.visible = false;
      crate.add(m);
      rewards.push(m);
    });

    crate.userData = { core: core, light: coreLight };
    scene.add(crate);
  })();

  /* ======================================================================
     Rifle — receiver, barrel, stock, grip, optic, and the parts that move
     ====================================================================== */

  var rifle = new THREE.Group();
  var R = {};                 // the animated bits

  (function buildRifle() {
    // Everything is laid out along +X, muzzle to the right, so the reload
    // reads left-to-right the same way the SVG version did.

    var receiver = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 0.5), MAT.gunMid);
    rifle.add(receiver);

    var upper = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.44), MAT.gunDark);
    upper.position.set(0.05, 0.44, 0);
    rifle.add(upper);

    // picatinny rail — a row of small ribs reads as machined
    for (var i = 0; i < 14; i++) {
      var rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.3), MAT.gunDark);
      rib.position.set(-1.05 + i * 0.17, 0.63, 0);
      rifle.add(rib);
    }

    var hand = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.85, 16), MAT.gunDark);
    hand.rotation.z = Math.PI / 2;
    hand.position.set(2.05, 0.06, 0);
    rifle.add(hand);

    // vent slots in the handguard
    for (var v = 0; v < 5; v++) {
      var slot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.52), MAT.grip);
      slot.position.set(1.45 + v * 0.3, 0.06, 0);
      rifle.add(slot);
    }

    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 14), MAT.gunDark);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(3.4, 0.06, 0);
    rifle.add(barrel);

    var brake = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.4, 14), MAT.gunMid);
    brake.rotation.z = Math.PI / 2;
    brake.position.set(4.3, 0.06, 0);
    rifle.add(brake);

    // stock
    var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 14), MAT.gunMid);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(-1.6, 0.1, 0);
    rifle.add(tube);

    var butt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.78, 0.4), MAT.grip);
    butt.position.set(-2.15, 0.02, 0);
    rifle.add(butt);

    // pistol grip, raked back
    var grip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.86, 0.36), MAT.grip);
    grip.position.set(-0.55, -0.62, 0);
    grip.rotation.z = 0.28;
    rifle.add(grip);

    var guard = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 8, 18, Math.PI), MAT.gunMid);
    guard.position.set(-0.12, -0.42, 0);
    guard.rotation.set(Math.PI / 2, 0, Math.PI);
    rifle.add(guard);

    var trigger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.1), MAT.bolt);
    trigger.position.set(-0.14, -0.44, 0);
    rifle.add(trigger);

    // optic
    var mount = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.34), MAT.gunDark);
    mount.position.set(-0.1, 0.74, 0);
    rifle.add(mount);

    var scope = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.8, 18), MAT.gunDark);
    scope.rotation.z = Math.PI / 2;
    scope.position.set(-0.1, 0.98, 0);
    rifle.add(scope);

    var lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18), MAT.glass);
    lens.rotation.z = Math.PI / 2;
    lens.position.set(-0.52, 0.98, 0);
    rifle.add(lens);

    /* --- the parts that move ------------------------------------------- */

    function magazine() {
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.34), MAT.gunMid);
      g.add(body);
      var lip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.38), MAT.gunDark);
      lip.position.y = 0.56;
      g.add(lip);
      // witness holes
      for (var k = 0; k < 3; k++) {
        var hole = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.06), MAT.grip);
        hole.position.set(0, 0.2 - k * 0.26, 0.16);
        g.add(hole);
      }
      return g;
    }

    R.magOld = magazine();
    R.magOld.position.set(0.15, -0.85, 0);
    rifle.add(R.magOld);

    R.magNew = magazine();
    R.magNew.position.set(0.15, -2.6, 0);
    R.magNew.visible = false;
    rifle.add(R.magNew);

    R.handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.62), MAT.bolt);
    R.handle.position.set(-0.9, 0.44, 0);
    rifle.add(R.handle);

    // muzzle flash — a cone plus a light, both driven by the same value
    R.flash = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 14, 1, true), MAT.hot);
    R.flash.rotation.z = -Math.PI / 2;
    R.flash.position.set(5.1, 0.06, 0);
    R.flash.visible = false;
    rifle.add(R.flash);

    R.flashLight = new THREE.PointLight(0xffb84a, 0, 14, 2);
    R.flashLight.position.set(5.1, 0.06, 0);
    rifle.add(R.flashLight);

    R.shell = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 10), MAT.brass);
    R.shell.visible = false;
    rifle.add(R.shell);

    rifle.position.y = 0.3;
    rifle.visible = false;
    scene.add(rifle);
  })();

  /* ======================================================================
     Drag to rotate
     ====================================================================== */

  var yaw = -0.5, spin = 0, dragging = false, lastX = 0, pid = null, touched = false;

  stage.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX; pid = e.pointerId;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
    if (!touched) { touched = true; hintEl.classList.add('is-gone'); }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== pid) return;
    spin += (e.clientX - lastX) * 0.0004;
    lastX = e.clientX;
  });
  function endDrag(e) {
    if (e && pid !== null && e.pointerId !== pid) return;
    dragging = false; pid = null;
    stage.classList.remove('is-dragging');
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);

  /* ======================================================================
     Scroll
     ====================================================================== */

  function story() {
    var max = document.body.scrollHeight - window.innerHeight;
    var p = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;

    for (var i = 0; i < copies.length; i++) {
      var r = copies[i].getBoundingClientRect();
      if (r.top < window.innerHeight * 0.76) copies[i].classList.add('is-in');
    }
    if (lootEl) {
      var lr = lootEl.getBoundingClientRect();
      if (lr.top < window.innerHeight * 0.7) lootEl.classList.add('is-in');
    }
    return p;
  }

  /* A fixed distance only frames on a wide screen — on a portrait phone the
     horizontal field of view binds first, so pull back to match. */
  function fit() {
    return camera.aspect >= 1.6 ? 1 : Math.min(2.1, 1.6 / Math.max(camera.aspect, 0.4));
  }

  /* ======================================================================
     Frame
     ====================================================================== */

  var openNow = 0, reloadNow = 0, camYNow = 1.1, distNow = 9;
  var lastPhase = -1;

  function frame() {
    requestAnimationFrame(frame);

    var p = story();

    /* Two acts sharing one canvas: the crate owns the first half, the rifle
       the second, with a short handover where one shrinks out and the other
       grows in. */
    var toRifle = phase(p, 0.44, 0.56);
    crate.visible = toRifle < 1;
    rifle.visible = toRifle > 0;

    if (!dragging) spin *= 0.94;
    if (!dragging && !reduced) spin += 0.00016;
    spin = clamp(spin, -0.08, 0.08);
    yaw += spin;

    /* ---- crate ------------------------------------------------------- */
    if (crate.visible) {
      var open = ease(phase(p, 0.12, 0.40));
      openNow = lerp(openNow, open, 0.1);

      for (var i = 0; i < cratePan.length; i++) {
        // Hinge outward at the base, and push the hinge itself out a little.
        // Rotation alone reads as collapsing; the small slide makes it open.
        cratePan[i].rotation.x = openNow * 1.12;
        cratePan[i].position.x = cratePan[i].userData.hx * (1 + openNow * 0.16);
        cratePan[i].position.z = cratePan[i].userData.hz * (1 + openNow * 0.16);
      }
      crateLid.rotation.x = -openNow * 2.1;

      var glow = Math.pow(openNow, 1.5);
      crate.userData.light.intensity = glow * 26;
      crate.userData.core.scale.setScalar(0.6 + glow * 0.9 + Math.sin(Date.now() * 0.004) * 0.05 * glow);

      for (var j = 0; j < rewards.length; j++) {
        var m  = rewards[j], u = m.userData;
        var t  = clamp((openNow - 0.35) / 0.65, 0, 1);
        m.visible = t > 0.01;
        var arc = Math.sin(t * Math.PI * 0.72);        // up and just past the peak
        m.position.set(
          Math.cos(u.ang) * u.out * t * 2.1,
          -0.5 + arc * u.rise,
          Math.sin(u.ang) * u.out * t * 2.1
        );
        m.rotation.set(t * u.spin, t * u.spin * 1.4, 0);
        m.scale.setScalar(clamp(t * 3, 0, 1));
      }

      crate.rotation.y = yaw;
      // Open, the crate spans much wider than it does shut — ease it back a
      // little so it never grows out of frame.
      crate.scale.setScalar((1 - toRifle * 0.7) * (1 - openNow * 0.24));
    }

    /* ---- rifle ------------------------------------------------------- */
    if (rifle.visible) {
      // the reload runs across the rifle's own half of the page
      var t = phase(p, 0.56, 0.90);
      reloadNow = lerp(reloadNow, t, 0.18);
      var r = reloadNow;

      // 1) old magazine drops. Gravity, so square the travel — a linear fall
      //    reads weightless.
      var a = phase(r, 0, 0.34);
      R.magOld.position.y = -0.85 - a * a * 4.2;
      R.magOld.position.x = 0.15 + a * 0.5;
      R.magOld.rotation.z = -a * a * 1.5;
      R.magOld.visible = a < 0.99;

      // 2) new magazine rises and seats with a small overshoot
      var b = phase(r, 0.34, 0.68);
      R.magNew.visible = b > 0.02;
      var seat = b < 0.86 ? lerp(-2.6, -0.79, b / 0.86) : lerp(-0.79, -0.85, (b - 0.86) / 0.14);
      R.magNew.position.y = seat;

      // 3) charging handle back then forward, then the shot
      var c    = phase(r, 0.68, 1);
      var pull = c < 0.5 ? c * 2 : (1 - c) * 2;
      R.handle.position.x = -0.9 - pull * 0.72;

      var fire = phase(c, 0.56, 0.68) * (1 - phase(c, 0.72, 0.94));
      R.flash.visible = fire > 0.02;
      R.flash.scale.set(fire, 0.6 + fire * 0.9, fire);
      R.flashLight.intensity = fire * 40;

      var sh = phase(c, 0.58, 1);
      R.shell.visible = sh > 0.02 && sh < 0.92;
      R.shell.position.set(0.6 + sh * 1.5, 0.35 + sh * 1.5 - sh * sh * 4.2, 0.4 + sh * 0.9);
      R.shell.rotation.set(sh * 9, sh * 5, sh * 7);

      // recoil kicks the whole rifle back and settles
      var kick = fire;
      rifle.position.x = -kick * 0.5 * Math.cos(kick * 7);
      rifle.rotation.z = kick * 0.05;
      rifle.rotation.y = yaw * 0.5 - 0.1;
      rifle.scale.setScalar(0.78 + toRifle * 0.42);

      var idx = r < 0.34 ? 0 : r < 0.68 ? 1 : 2;
      if (idx !== lastPhase) {
        lastPhase = idx;
        if (phaseEl) phaseEl.textContent = PHASES[idx];
        for (var s = 0; s < stepEls.length; s++) stepEls[s].classList.toggle('live', s === idx);
      }
    }

    /* ---- camera ------------------------------------------------------ */
    var camY = lerp(1.25, 0.75, ease(p));
    var dist = lerp(9.6, 10.4, ease(p)) * fit();
    camYNow  = lerp(camYNow, camY, 0.08);
    distNow  = lerp(distNow, dist, 0.08);

    camera.position.set(0, camYNow, distNow);
    camera.lookAt(0, 0.15, 0);

    renderer.render(scene, camera);
  }

  /* ======================================================================
     Size and boot
     ====================================================================== */

  function resize() {
    var w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('scroll', function () {
    if (!touched && window.scrollY > window.innerHeight * 0.6) {
      touched = true;
      hintEl.classList.add('is-gone');
    }
  }, { passive: true });

  resize();
  frame();
})();
