# AGENTS.md — The Pakistan Edit

## Project Overview
- **Product:** *The Pakistan Edit* — a browser-based broadcast video & editorial studio producing 1:1 visual, framing, color, and loudness parity between a 120Hz React web preview and server-side FFmpeg exports.
- **Audience & Languages:** Global Pakistani Diaspora (UK, US, UAE) & Domestic Metropolitan Elite (Lahore, Karachi, Islamabad). Bilingual English / Urdu / Roman Urdu (`dir="auto"`, `unicode-bidi: plaintext`).
- **Stack:** Next.js 16 (App Router, Node.js runtime), React 19, TypeScript (`noUncheckedIndexedAccess: true`), Tailwind/5-Layer CSS, FFmpeg + `ffprobe` via `child_process.spawn`.

---

## Locked Layers (Do Not Re-Audit or Churn)
1. **5-Layer CSS Architecture:** Frozen. Uses `dynamic-range-limit: constrained`, `round(nearest, ..., 1px)`, `unicode-bidi: plaintext`, `.tpe-tabular-nums`, and pine (`#111c19`) / gold editorial tokens.
2. **HTML / JSX Markup:** Frozen. Uses `colorScheme: "dark"`, `darkreader-lock`, `dir="auto"`, `translate="no"`, `crossOrigin="anonymous"`, `decoding="sync"`, `referrerPolicy="no-referrer"`, `type="text" inputMode="decimal"` (zero `<input type="number">` elements), lightweight inline popovers (no `<dialog>`/`inert`), and strict codec `accept` filters.

---

## Architectural Invariants (Never Revert or Re-Suggest Alternatives)

### 1. Client Playback, Scrubbing & Capture
- **120Hz `rAF` PLL (`useSmoothFramingLoop.ts`):** Keep camera pan, zoom, and `posY` glides on the `120Hz` `requestAnimationFrame` PLL. **Never** replace with `requestVideoFrameCallback` (`rVFC`), which clamps motion to `24fps`/`30fps` source cadence.
- **Dual-Deck Video Sync (`useVideoElementSync.ts`, `dualDeckHelpers.ts`):** Preserve standby deck pre-buffering (`!standby.seeking` barrier), `fastSeek()`, and hardware decoder release on unmount (`pause()`, `removeAttribute("src")`, `load()`). Keep audio audible when switching tabs (do **not** add `visibilitychange` auto-pause).
- **Scrubbers & Shortcuts:** Preserve `setPointerCapture` + `onLostPointerCapture` + `onPointerCancel` on `MainTimelineScrubber.tsx` and `CardTimelineScrubber.tsx`. Keep global hotkeys bound to physical `e.code` (`Space`, `KeyK`, `KeyC`) in `useStudioShortcuts.ts` for Urdu keyboard layouts.
- **2× Supersampled PNG Overlays (`exportEngine.tsx`, `videoExportEngine.tsx`):** Keep `pixelRatio: 2` binary `toBlob()` captures gated on `await document.fonts.ready`, cached `getFontEmbedCSS()` once per multi-scene export, `cacheBust: false`, and `8000ms` timeout guards. **Do not** downgrade to `pixelRatio: 1`.

### 2. FFmpeg Export & Filtergraph (`export/route.ts`, `ffmpegSceneGraph.ts`, `ffmpegFilters.ts`)
- **Video Master:** `libx264 -crf 14 -profile:v high -level 4.2 -pix_fmt yuv420p -movflags +faststart`, closed 2s GOP (`-g ${targetFps * 2} -keyint_min ${targetFps * 2} -sc_threshold 0`), `-threads Math.max(2, os.cpus().length - 2)`, `-max_muxing_queue_size 4096`. **Do not** switch to hardware encoders (`nvenc`/`videotoolbox`).
- **Color & HDR:** Full BT.709 NCLC tags (`-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`). Conditional HDR-to-SDR tone-mapping (`zscale` + `tonemap=hable`) **only** when `ffprobe` detects `arib-std-b67` (HLG) or `smpte2084` (PQ).
- **Overlay Compositing:** Downscale `2×` sRGB PNG overlays with `flags=lanczos+accurate_rnd+full_chroma_int`, `format=rgba`, `overlay=0:0:format=auto:alpha=straight`, and `scale=out_color_matrix=bt709:out_range=tv`.
- **Geometry & Sync:** Post-rotation `ffprobe` display dimensions (`±90°/270°` width/height swap), even-integer (`2n`) static and `ceil(.../2)*2` dynamic dimensions, frame-quantized durations (`Math.max(1, Math.round(rawDur * targetFps)) / targetFps`), `settb=1/90000`, `setsar=1`, and `-fflags +genpts+discardcorrupt` before `-i`.
- **Broadcast Audio:** Single-pass `loudnorm=I=-14:TP=-1.5` preceded by `alimiter=limit=0.841` and followed by `aresample=48000` into `320k` `48kHz` stereo AAC (`apad=whole_dur` + `atrim`, `15ms` micro-declick fades). **Do not** switch to two-pass `loudnorm`, Web Audio `MediaElementAudioSourceNode`, `-1.0 dBTP`, or global `highpass=f=80`.
- **Subtitles:** Escape `\`, `{`, `}`, `\r?\n` in `buildAssSubtitles`; use `escapeFfmpegFilterPath` and bundled `tools/fonts` (`fontsdir=`).

### 3. Next.js 16 Server & Security (`videoMedia.ts`, `ingest/route.ts`, `next.config.ts`)
- Export routes pin `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`, and write filtergraphs to cleaned-up `-filter_complex_script` files (`filter-${uid}.txt`) for Windows 32KB `CreateProcess` safety.
- `spawn(..., { shell: false })` with `AbortSignal`, `SIGTERM` → `3000ms` `.unref()` `SIGKILL` escalation, `withExportSlot` (`concurrency = 1`), `assertDiskHeadroom` (`500MB` via `statfs`), and `sweepStaleExportFiles` (2h TTL).
- `/api/video/ingest` serves HTTP `206` byte-range streams (`cancel() -> nodeStream.destroy()`) with `Cache-Control: private, max-age=31536000, immutable`.
- `next.config.ts` sets `COOP: same-origin`, `COEP: credentialless`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Permissions-Policy`.

---

## Coding Conventions
- Keep changes surgical, minimal, and zero-bloat. Verify `npm run build` / TypeScript compilation after edits.
- Do not introduce heavy third-party state libraries, `<input type="number">`, `useTransition` on controlled inputs, or unrequested background daemons.
