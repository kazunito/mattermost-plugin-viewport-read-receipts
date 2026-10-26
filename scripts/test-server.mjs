import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['tests/harness.tsx'],outfile:'work/harness.js',bundle:true,jsx:'transform',format:'iife',define:{'process.env.NODE_ENV':'"development"'}});
const routes={'/':'tests/harness.html','/harness.js':'work/harness.js','/plugin.js':'webapp/dist/main.js'};
createServer(async(req,res)=>{try{const file=routes[req.url];if(!file){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript');res.end(await readFile(file));}catch{res.writeHead(500);res.end();}}).listen(4178,'127.0.0.1');
