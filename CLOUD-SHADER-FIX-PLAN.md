# Cloud Shader Compile Fix — Plan

## Symptom

Browser console (Vite dev server, Cesium 1.127):

```
[Cesium WebGL] Fragment shader compile log:
ERROR: 0:7: 'texture2D' : no matching overloaded function found
ERROR: 0:7: '=' : dimension mismatch
ERROR: 0:7: '=' : cannot convert from 'const mediump float' to 'highp 4-component vector of float'
```

The cloud primitive's custom Fabric material fails to compile, so the
cloud layer either renders as a solid color, renders black, or doesn't
render at all (Cesium silently falls back to a default material when the
shader fails).

## Root cause

Two independent mistakes in `src/cesium/clouds.ts`, in the GLSL `source`
string passed to `Cesium.Material`:

### 1. `texture2D()` does not exist in Cesium 1.127's material shaders

Cesium 1.127+ compiles `Material` fabric sources as **GLSL ES 3.00**.
In ES 3.00, `texture2D(sampler, uv)` was removed and replaced by the
overloaded `texture(sampler, uv)`. Every built-in Cesium material confirms
this — e.g. `ElevationRampMaterial.js`:

```glsl
uniform sampler2D image;
...
vec4 rampColor = texture(image, vec2(scaledHeight, 0.5));
```

Our source used `texture2D(image, materialInput.st)`. Under ES 3.00 there
is no `texture2D` overload, so the compiler emits:

```
'texture2D' : no matching overloaded function found
```

and then treats the call's result as a scalar float, producing the
follow-on "dimension mismatch" / "cannot convert from float to vec4"
errors on the same line.

### 2. The `image` and `alpha` uniforms are not declared in the GLSL source

Cesium's Fabric `uniforms` object defines the **JavaScript-side** API
(how you set `material.uniforms.image = "..."` from JS), but the GLSL
`source` string is responsible for **declaring** those uniforms in shader
code. Every built-in Cesium material that uses `source` (rather than
`components`) explicitly declares its uniforms at the top, e.g.:

```glsl
uniform sampler2D image;
uniform float strength;
uniform vec2 repeat;
```

Our source never declared `uniform sampler2D image;` or
`uniform float alpha;`. Without `uniform sampler2D image;`, even if we
fixed `texture2D` → `texture`, the compiler would not know `image` is a
sampler — it would be an undeclared identifier.

## Fix

In `src/cesium/clouds.ts`, rewrite the `source` string to:

1. Declare both uniforms explicitly at the top:
   ```glsl
   uniform sampler2D image;
   uniform float alpha;
   ```
2. Replace `texture2D(image, materialInput.st)` with
   `texture(image, materialInput.st)`.

No other changes are needed — the Fabric `uniforms` object stays the same
(it still drives the JS API: `material.uniforms.image` is the URL,
`material.uniforms.alpha` is the fade value), and the rest of the
material/appearance/primitive setup is unaffected.

## Verification

1. `npm run build` — TypeScript must still pass (no type changes).
2. Hard-refresh `http://localhost:5173/` and open the browser console.
3. Confirm the shader compile error is gone.
4. Confirm clouds render textured (not solid white / not black / not
   missing).
5. Confirm clouds still fade out below 500 km altitude.
6. Confirm clouds still darken on the night side (the `flat: false`
   appearance fix from the previous pass is independent of this shader
   fix and remains in place).
7. Confirm the pole fade is still active (no starburst near ±90° latitude).
