# @vexa-video/core

Backend-neutral types, serializable media/project/job schemas, validation helpers, and browser-safe shared contracts for Vexa Video SDK.

Version 2 composition foundations also live here: `defineComposition()`, `defineStill()`, deterministic static metadata serialization, runtime prop validation, dynamic metadata calculation, and `ProgrammableCompositionRegistry` discovery. The shared programmable-timing runtime adds explicit frame contexts, frame/second conversion, interpolation, easing, color interpolation, analytic springs, seeded random values, loop/freeze helpers, series offsets, and frame-range utilities. The programmable-scene runtime adds nested groups/layers, media/text/fill/surface intent, deterministic z/timing normalization, asset manifests/readiness, storage-aware references, and typed lowering of representable scenes into `VideoProjectAst`. These contracts do not depend on React, DOM execution, Node execution, FFmpeg, or a bundler.

Use `@vexa-video/core/browser` from browser/framework code for serializable public types and the pure deterministic timing/scene helpers.
