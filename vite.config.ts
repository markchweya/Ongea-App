import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // onnxruntime-web defaults to a build with the WASM inlined, which lands a
    // second 23 MB copy in the bundle. This condition selects the build that
    // loads the runtime as a separate file, which is the copy
    // `tools/copy-runtime.mjs` puts in public/ort.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  // transformers.js ships its own WASM and worker plumbing; pre-bundling it
  // rewrites those paths and the runtime then fails to find itself.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  build: {
    // The synthesis worker pulls in the whole runtime and is legitimately big.
    chunkSizeWarningLimit: 1200,
  },
})
