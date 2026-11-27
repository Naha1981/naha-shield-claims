import fs from'node:fs';import {build}from'esbuild';
const D=new URL('.',import.meta.url).pathname.replace(/\/$/,'');
await build({entryPoints:[D+'/src/app.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:D+'/public/app.js',minify:true,legalComments:'eof'});
await build({entryPoints:[D+'/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],bundle:false,minify:true,format:'esm',outfile:D+'/public/pdf.worker.mjs',legalComments:'eof'});
console.log('Built private upload UI assets');
