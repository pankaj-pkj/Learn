# Animation studies

Three scroll- and drag-driven pages rebuilt from the reference videos in this repo
(`2_5438654676755063948.mp4`, `2_5438654676755063949.mp4`). No framework, no build
step, no `npm install`.

Open `index.html` for the index of all three.

| Page | Technique |
| --- | --- |
| `ice-tea.html` | Scroll-scrubbed Canvas 2D. A can frozen in ice shatters into 58 procedural glass shards, a card deck fans open in 3D, an aurora field, a warm parallax closer. |
| `pagani.html` | Real 3D. A glTF model on a sticky canvas — swipe to spin it with inertia, scroll to walk the camera around and lift all 51 panels apart, then reassemble. |
| `arena.html` | 3D with **no model file**. A loot crate hinges open on four panels and a rifle runs a full reload — all three.js primitives, ~15 KB of geometry instead of 2.5 MB of asset. |
| `flux.html` | Raymarched GLSL. A chrome blob with **no geometry** — the shape is a distance function evaluated per pixel, so splitting it apart is two numbers changing, not a rig. |
| `mirror.html` | A reflection in **water you can disturb**. A height field stepped through the damped wave equation on the GPU; the pointer drops into it and the ripples spread, interfere and decay on their own. |
| `juice.html` | Hand-projected particles. 540 bits on a tilted ring, depth-sorted into two canvases so the juice orbits *around* the bottle instead of sitting on top of it. |

## Running them

`ice-tea.html` and `juice.html` open straight from the file system — double-click and
they run.

`pagani.html` loads a `.glb`, and browsers block that over `file://` for CORS reasons.
From this folder:

```bash
python3 -m http.server
# then open http://localhost:8000/pagani.html
```

The page detects `file://` and tells you this on screen rather than failing silently.

## The one idea worth stealing

All three drive animation from **a value you already have** — scroll position, drag
distance — instead of from a timer:

```js
function trackProgress(el) {                 // 0 → 1 across a tall section
  var r = el.getBoundingClientRect();
  var travel = r.height - window.innerHeight;
  return travel <= 0 ? 0 : clamp(-r.top / travel, 0, 1);
}

function phase(p, a, b) {                    // remap a slice of it to 0 → 1
  return clamp((p - a) / (b - a), 0, 1);
}
```

Every animation is then a pure function of `p`. Nothing is queued, nothing is
`setTimeout`-ed, so scrolling up plays it backwards exactly and it can never drift out
of sync. One `requestAnimationFrame` per page does all the writing, guarded by a
`ticking` flag so a fast scroll cannot queue up frames.

## Swapping in your own assets

**3D model** — replace `assets/models/car.glb` (or point `MODEL_URL` at the top of
`assets/js/car.js` somewhere else). Nothing is hard-coded to this car:

- it is auto-centred and scaled to fit, whatever size it was exported at
- the explode is computed from each mesh's own bounding-box centre, so any model
  comes apart sensibly with no per-part naming
- the `paint()` function is only there because the sample car ships with untextured
  panels. If your model already has materials, delete that function

If your `.glb` is Draco-compressed (most web-optimised ones are), the decoder is
already vendored in `assets/vendor/draco/`.

**Photography** — the flat imagery on `ice-tea.html` is layered CSS mesh gradients, the
`.shot--*` rules. Replace them with `background-image` and nothing else changes.

### Where to get assets, free

| What | Where | Licence to check |
| --- | --- | --- |
| 3D models (.glb) | [Sketchfab](https://sketchfab.com/features/free-3d-models) — filter Downloadable + CC | CC-BY usually needs credit |
| 3D models, curated | [Poly Haven](https://polyhaven.com/models), [Quaternius](https://quaternius.com) | CC0 — no attribution needed |
| glTF test models | [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | mixed, listed per model |
| Photos | [Unsplash](https://unsplash.com), [Pexels](https://pexels.com), [Pixabay](https://pixabay.com) | free commercial use |
| Product cut-outs (PNG) | [PNGimg](https://pngimg.com), [CleanPNG](https://cleanpng.com) | check per image |
| Icons | [Lucide](https://lucide.dev), [Phosphor](https://phosphoricons.com) | MIT |
| Fonts | [Google Fonts](https://fonts.google.com), [Fontshare](https://fontshare.com) | free commercial use |

Optimise a heavy `.glb` before shipping it — `npx gltf-transform optimize in.glb out.glb`
usually takes a model to a fraction of its size.

### …or model it in code instead

`arena.html` takes the other route, and for a real product site it is usually the better
one:

| | Downloaded model (`pagani.html`) | Modelled in code (`arena.html`) |
| --- | --- | --- |
| Payload | 2.6 MB (three.js + loaders + Draco + `.glb`) | ~0.6 MB, all of it three.js |
| Extra requests | 5 | 0 |
| Works over `file://` | no — browsers block the `.glb` | yes |
| Licence | whatever the model carries | none, it's your code |
| Editing it | back to Blender | change a number |

Primitives get you further than they sound like they should: a crate is boxes on hinge
groups, a rifle is boxes and cylinders. The payoff is that each part stays a named mesh,
so a reload sequence drives real objects rather than a baked animation.

Watch the licence on "free" models — the popular Khronos `DamagedHelmet`, for one,
carries a **CC BY-NC** component, so it cannot go on a commercial site.

`flux.html` goes one step further and drops geometry altogether: the object is a signed
distance function, and the surface is found by marching each pixel's ray until the
distance hits zero. Two things make it look like metal rather than putty, and both are
in `env()`:

- what it reflects has **hard light/dark structure** — a narrow softbox on a near-black
  room. A smooth gradient reflects back as matte plastic no matter how shiny the material
- a **crisp horizon line**. That single hard edge reads as "mirror" more strongly than any
  amount of specular

Raymarching costs a full march per pixel, so pixels are the budget: the page renders at
0.6× resolution with a 48-step march on phones, 0.85× and 84 steps on desktop.

## Water that is actually simulated

Most "water" on the web is a noise texture being scrolled. It looks fine in a still and
falls apart the moment you interact, because noise has no physics: ripples do not spread
from where you touched, do not pass through each other, and do not stop.

`mirror.html` steps a height field through the damped wave equation instead, on the GPU,
once per frame:

```glsl
float next = (left + right + up + down) * 0.5 - previous;
next *= 0.9915;                       // damping
next -= force * smoothstep(radius, 0.0, distance(uv, pointer));
```

Two details make it work:

- it needs the **previous two** states, so three render targets rotate roles each frame
  (`prev`, `cur`, and the one being written)
- the field goes negative, so the targets are `HalfFloatType` — a normal 8-bit texture
  clips everything below zero and the waves flatten out

The reflection is bent by the field's **gradient**, not its height. Height tells you where
the surface is; the gradient tells you which way it is tilted, and tilt is what moves a
reflection.

The field covers the whole viewport, not just the water, so the same disturbance is read
on both sides of the line: below it bends a reflection, above it bends the photograph
itself — which is what makes the figure melt when you drag across it.

Swap the photo with `IMAGE_URL` at the top of `assets/js/mirror.js`. Two things to know
before you do:

- **The photo must be the dry half only.** Hero shots of this kind usually ship with the
  water already rendered in; crop it off at the waterline, or the page reflects a
  reflection and two sets of ripples fight each other.
- **A portrait photo will not fill a landscape band.** Stretching it squashes the subject
  and cover-fitting it crops everything but the bottom. The one here has its dark side
  walls extended outward instead — edge colour, a little grain, a vignette. There is
  nothing to look at out there, so nobody notices.

## Vendored dependencies

`assets/vendor/` holds three.js r147 (the UMD build, so no import maps or module server
needed), its `GLTFLoader`, `DRACOLoader` and the Draco decoder. All from
[mrdoob/three.js](https://github.com/mrdoob/three.js), MIT.

## Credits and naming

The car model is three.js's own Ferrari 458 sample asset, used here as a stand-in — it
still carries its original badges. The page around it is a fictional marque ("Astrea"),
and so are "ZOI" and "RAW Pressery", deliberately: these are technique studies, not
copies of anyone's brand. Swap the model and the names before any of this goes near a
real site.

## Sound, also generated

`mirror.html` has an ambient pad behind a toggle. There is no audio file — every sound is
synthesised with Web Audio at run time: three chord tones as detuned oscillator pairs
under a slowly sweeping lowpass, one soft bell every few seconds from a pentatonic set,
and filtered noise at the edge of hearing. Even the reverb's impulse response is
generated (noise with an exponential decay) rather than shipped.

That settles the licence question outright — nothing was recorded and nothing was
downloaded — and it costs zero bytes. Measured at the destination it sits around
-37 dBFS RMS, which is about as quiet as a thing can be while still being there.

It never autoplays. Browsers block that anyway, and `assets/js/ambient.js` mounts itself
on any page with a `[data-sound]` button, so it drops onto the other demos unchanged.
