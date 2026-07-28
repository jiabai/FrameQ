# Bundled ONNX Runtime Dependency Integrity Design

- Date: 2026-07-28
- Status: Approved for implementation
- Scope: release-build preparation and verification of the bundled Python runtime
- Related product specification:
  `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`

## Context

SenseVoiceSmall-ONNX model acquisition only writes verified model assets to app-local data. It does
not, and must not, install Python packages. A local Tauri debug run can reuse an older
`resources/python` tree that predates the ONNX provider; the model then appears installed but the
worker raises `ASR_DEPENDENCY_MISSING` when it imports `funasr_onnx` or `onnxruntime`.

The deployment boundary is responsible for this dependency set. A released FrameQ package must
already contain the selected model runtimes' Python packages before it reaches the user.

## Decision

The installer build remains the sole owner of bundled Python dependency installation. It exports the
locked production requirements, installs them into the bundled standalone Python runtime, prunes
only non-runtime files, and performs a real import smoke test before invoking the Tauri bundle
step.

The smoke test must import `funasr`, `funasr_onnx`, `modelscope`, `onnxruntime`, `yt_dlp`, and
`frameq_worker` using the exact Python runtime and worker tree that will be included in the
installer. A missing package, binary-load failure, or stale worker source fails the release build;
it cannot produce an installer artifact.

This contract applies both to a clean resource rebuild and to the intentionally supported
`--skip-downloads` reuse path. Reusing a locally available standalone Python or media runtime does
not permit reusing stale Python dependencies: the locked requirements are installed and the same
import check is run on every installer build.

## Runtime Boundary

- Application startup launches only the bundled Python interpreter and worker. It does not invoke
  `pip`, `uv`, or package installation.
- Model download accesses only the approved ModelScope model sources. It does not access PyPI,
  inspect package indexes, or install ASR runtime dependencies.
- App-local `models/` contains user-selected ASR/VAD assets only; it is not a Python package cache.
- Developer `tauri dev` may use pre-existing local resources, but it is not a release-equivalent
  dependency-preparation mechanism. Its stale-resource failure must not weaken the installer
  contract or cause runtime installation behavior to be added.

## Verification Contract

Static build-script tests must assert that the installer build:

1. exports locked non-development requirements;
2. installs them into the bundled Python runtime;
3. imports the full ONNX dependency set and `frameq_worker` with `PYTHONPATH` bound to the bundled
   worker; and
4. performs that smoke test before the Tauri artifact build.

The release workflow retains its packaged-runtime smoke tests. A clean-machine release validation
must confirm that an installed ONNX model can run without network activity for Python dependency
installation.

## Non-Goals

- Do not bundle ASR model weights in the installer.
- Do not add a development-only automatic package installer to application startup or model
  download.
- Do not expose PyPI configuration, dependency installation, or runtime repair controls in the
  desktop UI.
