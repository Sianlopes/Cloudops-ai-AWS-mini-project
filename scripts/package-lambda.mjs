import {build} from 'esbuild';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const target=new URL('../build/lambda-bundle/',import.meta.url);
const cert=new URL('../certs/global-bundle.pem',import.meta.url);
try{await readFile(cert);}catch{throw Error('Download certs/global-bundle.pem from the official RDS truststore first; see deployment guide step 5.');}
await mkdir(new URL('server/',target),{recursive:true});await mkdir(new URL('certs/',target),{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('../server/lambda.js',import.meta.url))],outfile:fileURLToPath(new URL('server/lambda.mjs',target)),bundle:true,platform:'node',target:'node24',format:'esm',external:['pg-native'],banner:{js:'import { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);'},minify:true});
await copyFile(new URL('../server/schema.sql',import.meta.url),new URL('server/schema.sql',target));
await copyFile(cert,new URL('certs/global-bundle.pem',target));
console.log('Bundled Lambda prepared at build/lambda-bundle. Zip its contents. Handler: server/lambda.handler.');
