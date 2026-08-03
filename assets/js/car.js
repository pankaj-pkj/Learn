/* ==========================================================================
   ASTREA GT-R
   One glTF model on a sticky canvas. Swipe rotates it, scroll opens it apart
   and walks the camera around. Swap MODEL_URL for your own .glb — the explode
   works off each mesh's own centre, so it adapts to whatever you load.
   ========================================================================== */

(function () {
  'use strict';

  var MODEL_URL = 'assets/models/car.glb';

  var canvas   = document.getElementById('car');
  var stage    = document.querySelector('.stage');
  var loadingEl= document.querySelector('[data-loading]');
  var hintEl   = document.querySelector('[data-hint]');
  var beats    = Array.prototype.slice.call(document.querySelectorAll('.beat'));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('[data-jump]'));
  var reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp  = function (a, b, t) { return a + (b - a) * t; };
  var ease  = function (t) { return t * t * (3 - 2 * t); };

  /* ======================================================================
     Scene
     ====================================================================== */

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding    = THREE.sRGBEncoding;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;

  var scene  = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

  // Studio reflections. A car body is mostly reflection, so this matters more
  // than any number of point lights.
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

  var key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(4, 7, 5);
  scene.add(key);

  // Warm edge light along the far side — this is what makes a dark body read
  var rim = new THREE.DirectionalLight(0xffd11a, 2.0);
  rim.position.set(-6, 2.5, -5);
  scene.add(rim);

  var fill = new THREE.DirectionalLight(0x8fb6ff, 0.5);
  fill.position.set(-3, 1.5, 6);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0xffffff, 0.08));

  // Baked contact shadow, so the car sits on something instead of floating
  var shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: new THREE.TextureLoader().load('assets/models/car_ao.png'),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.MultiplyBlending
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;
  shadow.visible = false;
  scene.add(shadow);

  /* ======================================================================
     Model
     ====================================================================== */

  var rig    = new THREE.Group();   // yaw only — this is what the drag turns
  var pivot  = new THREE.Group();   // holds the centred model
  rig.add(pivot);
  scene.add(rig);

  var parts   = [];                 // { mesh, dir, home } for the explode
  var radius  = 1;                  // model size, drives camera distance
  var ready   = false;

  /* Paint. The sample car ships with untextured body panels, so we dress it:
     a carbon-dark clearcoat body, machined rims, real glass. If your own model
     already has materials, just delete this — nothing else depends on it. */
  function paint(model) {
    // Deep carbon rather than bare metal: a low-metalness base keeps it dark,
    // the clearcoat puts the wet highlight back on top.
    var body = new THREE.MeshPhysicalMaterial({
      color: 0x050609, metalness: 0.45, roughness: 0.33,
      clearcoat: 1, clearcoatRoughness: 0.03
    });
    var trim = new THREE.MeshStandardMaterial({
      color: 0xc8a13a, metalness: 1, roughness: 0.38
    });
    var glass = new THREE.MeshPhysicalMaterial({
      color: 0x9fb4c4, metalness: 0, roughness: 0.05,
      transmission: 0.92, transparent: true, opacity: 0.4
    });

    var map = { body: body, glass: glass, metal: body, plastic_gray: body,
                rim_fl: trim, rim_fr: trim, rim_rl: trim, rim_rr: trim };

    Object.keys(map).forEach(function (name) {
      var o = model.getObjectByName(name);
      if (o) o.material = map[name];
    });
  }

  // Most web-ready .glb files are Draco-compressed, this one included.
  var draco = new THREE.DRACOLoader();
  draco.setDecoderPath('assets/vendor/draco/');

  var loader = new THREE.GLTFLoader();
  loader.setDRACOLoader(draco);

  loader.load(MODEL_URL, function (gltf) {
    var model = gltf.scene;
    paint(model);

    // Centre on the origin and normalise the scale, so any model you drop in
    // frames the same way.
    var box  = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var mid  = box.getCenter(new THREE.Vector3());
    var unit = 4.2 / Math.max(size.x, size.y, size.z);

    model.position.sub(mid);
    model.scale.setScalar(unit);
    model.position.multiplyScalar(unit);
    pivot.add(model);

    box    = new THREE.Box3().setFromObject(pivot);
    size   = box.getSize(new THREE.Vector3());
    radius = Math.max(size.x, size.z) * 0.5;

    // Sit it on the ground
    pivot.position.y = -box.min.y;

    shadow.scale.set(size.x * 1.5, size.z * 1.5, 1);
    shadow.position.y = 0.002;
    shadow.visible = true;

    // Record every mesh's own centre — the explode pushes each one straight
    // out along that direction, which reads as the car opening up. Works on
    // whatever model you load, no per-part naming needed.
    var centre = new THREE.Vector3();
    new THREE.Box3().setFromObject(pivot).getCenter(centre);

    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();

      var c = o.geometry.boundingBox.getCenter(new THREE.Vector3());
      o.localToWorld(c);

      var dir = c.sub(centre);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      dir.y = Math.abs(dir.y) * 0.5 + 0.5;   // bias upward — panels lift off
      dir.normalize();

      parts.push({ mesh: o, dir: dir, home: o.position.clone() });
    });

    ready = true;
    loadingEl.style.display = 'none';
  }, undefined, function () {
    loadingEl.innerHTML = location.protocol === 'file:'
      ? 'Browsers block .glb over file:// — run <b>python3 -m http.server</b> in this folder and open localhost:8000/pagani.html'
      : 'Could not load assets/models/car.glb';
  });

  /* ======================================================================
     Drag to rotate, with inertia
     ====================================================================== */

  var yaw      = 2.45;   // current angle — opens on a front three-quarter
  var spin     = 0;      // angular velocity from the drag
  var dragging = false;
  var lastX    = 0;
  var pointerId = null;
  var touched  = false;

  stage.addEventListener('pointerdown', function (e) {
    dragging  = true;
    lastX     = e.clientX;
    pointerId = e.pointerId;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
    if (!touched) { touched = true; hintEl.classList.add('is-gone'); }
  });

  stage.addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== pointerId) return;
    var dx = e.clientX - lastX;
    lastX  = e.clientX;
    spin  += dx * 0.00042;         // feed the velocity, don't set the angle
  });

  function endDrag(e) {
    if (e && pointerId !== null && e.pointerId !== pointerId) return;
    dragging  = false;
    pointerId = null;
    stage.classList.remove('is-dragging');
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);

  /* ======================================================================
     Scroll — camera walk + explode
     ====================================================================== */

  var scrollP = 0;

  function readScroll() {
    var max = document.body.scrollHeight - window.innerHeight;
    scrollP = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;

    // The last beat is a plain CTA, so the car story runs over the first ~78%
    var story = clamp(scrollP / 0.78, 0, 1);

    // Reveal copy, and light the matching nav item
    var live = 0;
    for (var i = 0; i < beats.length; i++) {
      var r = beats[i].getBoundingClientRect();
      if (r.top < window.innerHeight * 0.62 && r.bottom > window.innerHeight * 0.35) live = i;
      if (r.top < window.innerHeight * 0.72) {
        var copy = beats[i].querySelector('.beat__copy');
        if (copy) copy.classList.add('is-in');
        var specs = beats[i].querySelector('[data-specs]');
        if (specs && r.top < window.innerHeight * 0.5) specs.classList.add('is-in');
      }
    }
    for (var j = 0; j < navLinks.length; j++) {
      navLinks[j].classList.toggle('is-live', Number(navLinks[j].dataset.jump) === live);
    }

    return story;
  }

  /* ======================================================================
     Frame
     ====================================================================== */

  var explodeNow   = 0;
  var camAngleNow  = -0.40;
  var camHeightNow = 0.75;
  var distNow      = 6.10;

  /* A fixed camera distance only frames correctly on a wide screen. The car is
     wide and short, so on a portrait phone the horizontal field of view is the
     binding constraint — pull back by however much narrower the viewport is. */
  function fitScale() {
    return camera.aspect >= 1.6 ? 1 : Math.min(2.2, 1.6 / Math.max(camera.aspect, 0.4));
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!ready) { renderer.render(scene, camera); return; }

    var story = readScroll();

    /* -- rotation: drag velocity + a slow idle turn ---------------------- */
    if (!dragging) spin *= 0.94;                 // friction
    if (!dragging && !reduced) spin += 0.00022;  // it keeps turning on its own
    spin = clamp(spin, -0.09, 0.09);
    yaw += spin;

    rig.rotation.y = yaw;

    /* -- explode: panels lift away, then settle back for the closing beat -- */
    // shut → opening through Design → held open over Engine → shut again
    var explodeTarget = ease(clamp((story - 0.26) / 0.30, 0, 1))
                      - ease(clamp((story - 0.84) / 0.16, 0, 1));
    explodeNow = lerp(explodeNow, clamp(explodeTarget, 0, 1), 0.08);

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.mesh.position.copy(p.home).addScaledVector(p.dir, explodeNow * radius * 0.13);
    }

    /* -- camera: walks around and rises as the story goes on ------------- */
    var camAngle  = lerp(-0.40, 0.95, ease(story));            // orbit offset
    var camHeight = lerp(0.75, 1.55, ease(story));
    var dist      = lerp(6.10, 6.90, ease(story)) * fitScale();

    camAngleNow  = lerp(camAngleNow,  camAngle,  0.08);
    camHeightNow = lerp(camHeightNow, camHeight, 0.08);
    distNow      = lerp(distNow,      dist,      0.08);

    camera.position.set(
      Math.sin(camAngleNow) * distNow,
      camHeightNow,
      Math.cos(camAngleNow) * distNow
    );
    camera.lookAt(0, 0.55 + explodeNow * 0.35, 0);

    shadow.material.opacity = 0.75 * (1 - explodeNow * 0.7);

    renderer.render(scene, camera);
  }

  /* ======================================================================
     Size
     ====================================================================== */

  function resize() {
    var w = stage.clientWidth;
    var h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  resize();
  frame();

  // Nav jumps
  navLinks.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var t = document.querySelector(a.getAttribute('href'));
      if (t) t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  });

  // Drop the hint once they scroll, even if they never dragged
  window.addEventListener('scroll', function () {
    if (!touched && window.scrollY > window.innerHeight * 0.5) {
      touched = true;
      hintEl.classList.add('is-gone');
    }
  }, { passive: true });
})();
