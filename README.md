# ZOI ICE TEA — scroll-driven product site

A UI built from the two reference videos in this repo (`2_5438654676755063948.mp4`,
`2_5438654676755063949.mp4`). The second video shows a complete beverage site, so that
one is rebuilt here end to end.

Open `index.html` in a browser. No build step, no dependencies, no npm install.

## What's in it

| Section | What happens |
| --- | --- |
| Hero | Oversized `Drink. Freeze.` headline bleeding off both edges, a can frozen inside a translucent ice block. Scrolling shatters the ice into ~58 procedural glass shards drawn on canvas, then washes into the blue. |
| Experience | Animated aurora field. A deck of five cards fans open in 3D, holds, then re-stacks. |
| Unique Flavors | Tea-bag mark, display heading, five flavour pills. |
| A Taste Above The Rest | Warm ember half. Three portrait cards on independent parallax, then a stat row. |
| Footer | Outlined `ZOI` wordmark, three contact columns. |

## How the motion works

Everything is **scrubbed from scroll position**, not played on a timer:

- `trackProgress(el)` turns a tall section into a `0 → 1` value based on how far its
  sticky stage has travelled.
- `phase(p, a, b)` remaps a slice of that into its own `0 → 1`, and `window01(...)`
  makes a fade-in / hold / fade-out envelope.
- Each frame runs once inside a `requestAnimationFrame`, guarded by a `ticking` flag.

Because nothing is time-based, every animation plays backwards correctly when you
scroll up, and it can never drift out of sync with the page.

The ice shatter is a canvas pass: each shard is a 3–5 sided polygon with its own start
radius, travel distance, spin, depth and stagger, composited with `lighter` so the
shards read as glass catching light.

`.deep` carries `margin-top:-100vh` so its sticky stage takes over exactly as the hero
finishes fading — without it the hero's last screen scrolls past empty.

## Files

```
index.html
assets/css/style.css
assets/js/main.js
```

## Notes

- Card imagery is procedural (layered CSS mesh gradients) since the repo ships no
  photography. Swapping in real shots means replacing the `.shot--*` rules with
  `background-image` — nothing else changes.
- Inter is loaded from Google Fonts and falls back to a system stack offline.
- Honours `prefers-reduced-motion`; idle loops stop and reveals resolve immediately.
- Layout is checked at 1440px and 390px, with no horizontal overflow at either.

## The other reference

The first video shows three more concepts — an exploded luxury watch, a Pagani Zonda R
page (black with a single yellow accent), and a pomegranate drink carousel. None of
those are built yet.
