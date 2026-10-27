import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
// Mattermost exports React and ReactDOM as window globals for webapp plugins.
await build({entryPoints:['src/index.tsx'],outfile:'dist/main.js',bundle:true,minify:true,target:'es2020',format:'iife',jsx:'transform',plugins:[{
 name:'mattermost-externals',setup(build){
  build.onResolve({filter:/^(react|react-dom)$/},args=>({path:args.path,namespace:'mm'}));
  build.onLoad({filter:/.*/,namespace:'mm'},args=>({contents:`module.exports = window.${args.path==='react'?'React':'ReactDOM'};`,loader:'js'}));
 }
}],define:{'process.env.NODE_ENV':'"production"'}});
