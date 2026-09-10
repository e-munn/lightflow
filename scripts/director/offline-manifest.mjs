import fs from 'node:fs/promises';
async function files(root,prefix){const out=[];for(const entry of await fs.readdir(root,{withFileTypes:true})){const p=`${root}/${entry.name}`,url=`${prefix}/${entry.name}`;if(entry.isDirectory())out.push(...await files(p,url));else if(!entry.name.endsWith('.map'))out.push(url);}return out;}
await fs.mkdir('public/ort',{recursive:true});
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await fs.copyFile(`node_modules/onnxruntime-web/dist/${name}`,`public/ort/${name}`);
const list=[...await files('.next-production/static','/_next/static'),...await files('public/models','/models'),...await files('public/ort','/ort'),'/director-capture.js','/icon.svg'];
await fs.writeFile('public/director-cache.json',JSON.stringify(list));console.log('Offline assets',list.length);

const buildId=(await fs.readFile('.next-production/BUILD_ID','utf8')).trim();
const sw=await fs.readFile('public/director-sw.js','utf8');await fs.writeFile('public/director-sw.js',sw.replace(/const CACHE='[^']+';/,`const CACHE='lightflow-director-${buildId}';`));
