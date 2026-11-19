# Maya Simulator — Honda Edition

A first-person, tilt-to-steer driving game that runs in a phone browser. You drive a
white Honda from the driver's seat.

**Play:** https://amontesinos.github.io/mayasimulator/

## Modes

| Mode | What happens |
| --- | --- |
| 🦌 **Deer Dodge** (default) | Endless canyon road at dusk. Deer stand, cross, fake you out, and leap from the trees. Three bonks, or one crash into anything off the road (trees, rocks, posts, signs), and the Honda goes KABOOM. |
| 🌲 **Chill Cruise** | Sunny drive with the radio on. No score, no way to lose — the deer always get out of the way and the car just bumps off things. |
| 😤 **Deer Revenge** | A herd of very angry deer chases you down the interstate. Weave through traffic; don't let them catch up, and don't hit the barrier or guardrail. |

Chill Cruise and Deer Revenge unlock after your first Deer Dodge run (saved on the device).

## Controls

- **Phone:** hold it sideways like a steering wheel and tilt to steer. Right thumb = gas,
  left thumb = brake, **HONK** button on the wheel. The car holds a cruise speed on its own.
- **No motion access:** drag on the left half to steer; gas/brake on the right.
- **Keyboard:** arrows / WASD, `H` honk, `P` pause, `C` recenter.

## How it works

- Plain static site, no build step. [three.js r170](https://threejs.org) is vendored in `vendor/`.
- Everything is procedural: the road, terrain, trees, deer, the car interior, the canvas
  textures, and all sound (Web Audio synthesis, including two radio stations).
- Tilt steering converts `deviceorientation` beta/gamma into a gravity vector, rotates it into
  screen space, and steers on the screen's left-right tilt. That avoids the angle jumps raw
  beta/gamma have when the phone is upright. Straight is the phone held level (true level,
  the same reading as the bubble level on the start screen), so there's nothing to calibrate.
  At the start of each run the game double-checks the screen rotation from gravity, and if
  the phone is held more than 20° off level it centers on that hold instead. Pause →
  **Recenter steering** makes the current hold straight.
- iOS needs HTTPS and a tap before it will share motion data, which is why the game starts
  with a button and is hosted on GitHub Pages.

## Files

```
index.html            page shell + UI screens
css/style.css         UI styling
js/main.js            boot + button wiring
js/game.js            state machine, camera rig, rendering
js/input.js           tilt / touch / keyboard controls
js/car.js             car physics (road-relative coordinates)
js/road.js            endless procedural road
js/world.js           sky, terrain chunks, trees, signs, themes
js/cockpit.js         car interior, gauges, mirror
js/deer.js            deer models, animation, eyeshine, speech bubbles
js/traffic.js         highway traffic
js/modes.js           Deer Dodge / Chill Cruise / Deer Revenge
js/audio.js           synthesized engine, SFX, radio
js/textures.js        canvas-drawn textures
```

To run locally, serve the folder with any static server (for example `python -m http.server`).
Tilt steering only works over HTTPS, so test motion controls on the GitHub Pages URL.
