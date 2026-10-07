# @vexa-video/core

Backend-neutral types, serializable media/project/job schemas, validation helpers, and browser-safe shared contracts for Vexa Video SDK.

Version 2 composition foundations also live here: `defineComposition()`, `defineStill()`, deterministic static metadata serialization, runtime prop validation, dynamic metadata calculation, and `ProgrammableCompositionRegistry` discovery. These contracts do not depend on React, DOM APIs, Node execution, FFmpeg, or a bundler.

Use `@vexa-video/core/browser` from browser/framework code when you only need serializable public types.
