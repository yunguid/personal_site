# Performance Program

Baseline and verification date: 2026-07-18.

This document is the repeatable performance scorecard for the public homepage,
YNG Music, and Montana gallery. Lighthouse results are isolated local production
builds using Lighthouse 13.4.0. They are lab measurements, not field RUM.

## Route Results

Mobile Lighthouse, before -> after:

| Route | Score | FCP | LCP | TBT | CLS | Transfer | Main thread |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| YNG Music | 87 -> 100 | 1.20s -> 1.14s | 1.74s -> 1.65s | 495ms -> 0ms | 0.0059 -> 0 | 51KB -> 51KB | 1,474ms -> 551ms |
| Homepage | 82 -> 100 | 1.90s -> 0.91s | 3.86s -> 1.06s | 244ms -> 0ms | 0 -> 0 | 401KB -> 21KB | 2,489ms -> 598ms |
| Montana | 76 -> 100 | 0.90s -> 0.90s | 5.50s -> 1.73s | 0ms -> 0ms | 0.1255 -> 0 | 836KB -> 238KB | 115ms -> 82ms |

All three final mobile runs scored 100 for performance, accessibility, and best
practices. All three final desktop runs scored 100 for performance. The music
page's lower SEO score is intentional while it remains `noindex`.

## 64-Metric Scorecard

### User Experience

1. Performance score
2. First Contentful Paint (FCP)
3. Largest Contentful Paint (LCP)
4. Cumulative Layout Shift (CLS)
5. Total Blocking Time (TBT)
6. Speed Index
7. Time to Interactive (TTI)
8. Maximum Potential First Input Delay

### Delivery

9. Total transferred bytes
10. Network request count
11. HTML transferred bytes
12. Initial JavaScript raw bytes
13. Initial JavaScript compressed bytes
14. Initial CSS raw bytes
15. Initial CSS compressed bytes
16. Third-party request count and bytes

### Main Thread

17. Total main-thread work
18. JavaScript boot and evaluation time
19. Long-task count
20. Maximum long-task duration
21. Script evaluation time
22. Style and layout time
23. Paint and composite time
24. DOM element count

### Runtime Rendering

25. Active animation frame rate
26. Idle animation frame rate
27. Hidden-tab animation suspension
28. Offscreen animation suspension
29. Canvas backing-pixel count
30. Layout reads per animation frame
31. Shader compilation work per frame
32. Reduced-motion behavior

### Music Catalog

33. Full catalog payload bytes
34. Public catalog payload bytes
35. Private metadata fields exposed publicly
36. Catalog edge-cache lifetime
37. Catalog fetch and parse latency
38. Groups rendered in the first chunk
39. Groups rendered after idle completion
40. Search input-to-render latency

### Music Playback

41. Media requests per selected track
42. Duplicate media bandwidth
43. Playback startup latency
44. Byte-range request support
45. Audio object cacheability
46. Analyzer FFT size and buffer allocations
47. Frequency coverage and sampling distribution
48. Analyzer-to-playback drift

### Gallery Media

49. Initial image transfer bytes
50. Initial image request count
51. LCP image completion time
52. Responsive image candidate selected
53. Intrinsic image dimensions present
54. Eager versus deferred image count
55. Full-resolution lightbox deferral
56. Thumbnail format and encoder efficiency

### Accessibility And Resilience

57. Lighthouse accessibility score
58. Lighthouse best-practices score
59. Browser console error count
60. Keyboard operability
61. Form and media-control labels
62. Main and dialog landmarks
63. Horizontal overflow at narrow widths
64. Resize, visibility, and resume correctness

## Implemented Changes

### YNG Music

- Split the 143KB raw catalog into an on-demand fallback chunk. Initial music
  JavaScript fell from 166.5KB to 26.7KB raw and from 38.5KB to 9.8KB gzip.
- Fetch the live catalog first, cache the public response at the edge, and strip
  `sha256` and `s3Key`. The representative public JSON is 104,640 bytes instead
  of 150,850 bytes, a 30.6% reduction.
- Precompute searchable metadata, coalesce search renders, render groups in idle
  chunks, and apply `content-visibility` to offscreen catalog sections.
- Use one CORS-enabled `Audio` element for playback and Web Audio analysis. This
  removes the duplicate fallback media request and eliminates analyzer drift.
- Cache canvas contexts and dimensions, avoid per-frame layout reads, run at
  30fps while live and 12.5fps while idle, and suspend when hidden or offscreen.
- Rebuilt the rightmost spectrum with logarithmic 28Hz-18kHz sampling, fast
  attack/slow release, an 84-cell damped physical envelope, and the warm Vangelis
  palette. One reusable gradient replaces per-bar gradients.

### Homepage

- Changed both audio players to `preload="none"`, removing about 380KB of MP3
  traffic from the initial page load.
- Stage WebGL shader creation across animation frames, cache shared shaders,
  lower pressure iterations, cap the simulation at 30fps, and debounce resize.
- Suspend WebGL work when hidden or below the first viewport and render a single
  stable frame for reduced-motion users.
- Corrected content contrast, control labels, link affordances, and analytics
  protocol handling.

### Montana Gallery

- Added local 320px, 400px, and 640px responsive WebP thumbnails with intrinsic
  dimensions; full S3 originals load only when the lightbox opens.
- Re-encoded thumbnails with WebP method 6 and a visually checked quality level.
- Reserve grid geometry, lazy-load below-fold images, and preload only the LCP
  candidate. The initial mobile payload fell by 71.5% and CLS reached zero.
- Replaced clickable divs with buttons and added dialog, keyboard, and landmark
  semantics.

## Next-Stage Work

The largest remaining music-system project is a measured adaptive streaming
pipeline: segmented Opus/AAC renditions, loudness normalization metadata,
bandwidth/ buffer-aware bitrate selection, gapless transitions, resumable range
caching, and field telemetry for startup time, rebuffer ratio, bitrate switches,
listen-through rate, and playback failures. That requires an encoding and manifest
backend; it should be justified with field data rather than added to this static
archive speculatively.

Before the next optimization pass, collect field p75 LCP, CLS, INP, audio startup,
rebuffer ratio, search latency, and visualizer frame-time data by route and device.
Use those measurements to decide between catalog virtualization, API pagination,
and the adaptive streaming pipeline.
