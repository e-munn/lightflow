import fs from 'node:fs/promises';

// Serve the runtime that matches the installed ONNX package, in dev and production.
await fs.mkdir('public/ort',{recursive:true});
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']){
 await fs.copyFile(`node_modules/onnxruntime-web/dist/${name}`,`public/ort/${name}`);
}
console.log('Director runtime ready');
