/**
 * Points ONNX Runtime at the WASM binaries the bundler emitted.
 *
 * Left alone, transformers.js builds a jsdelivr URL out of whichever
 * onnxruntime-web version it depends on, which is not always a version
 * published to npm. Importing the binaries as assets hands the problem to the
 * bundler, which knows where it put them.
 *
 * Both the MMS path and the Piper path create sessions, so this has to be
 * settled before either of them runs — hence a module of its own that they each
 * import first.
 */

import * as ort from 'onnxruntime-web'
import asyncifyLoader from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import asyncifyRuntime from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import plainLoader from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import plainRuntime from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

// Safari has no working asyncify build, so it gets the plain one.
const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

ort.env.wasm.wasmPaths = safari
  ? { mjs: plainLoader, wasm: plainRuntime }
  : { mjs: asyncifyLoader, wasm: asyncifyRuntime }
