/* Only imported by consistent-demo.mjs while generating a brand-new local sandbox.
 * The production server never imports this module. Signed mock snapshots and their
 * ledger records are generated at the same simulated instant, never backdated. */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const dir=realpathSync(process.env.DATA_DIR || '.');
const marker=JSON.parse(readFileSync(resolve(dirname(dir),'consistent-demo.json'),'utf8'));
if (process.env.HOST!=='127.0.0.1' || process.env.NODE_ENV==='production' || process.env.RAILWAY_ENVIRONMENT || marker.generator!=='youji-consistent-demo-v1' || marker.state!=='building' || resolve(marker.dataDir)!==dir || !dir.endsWith('/sandbox-data')) throw new Error('Demo clock refused: isolated fresh sandbox marker required.');
const clockPath=resolve(dirname(dir),'clock.json');
const NativeDate=Date;let lastClock='',startedAt=NativeDate.now();
const now=()=>{const n=JSON.parse(readFileSync(clockPath,'utf8')).now;const t=NativeDate.parse(n);if(!Number.isFinite(t))throw new Error('Invalid demo clock');if(n!==lastClock){lastClock=n;startedAt=NativeDate.now();}return t+(NativeDate.now()-startedAt);};
globalThis.Date=class DemoDate extends NativeDate { constructor(...args){super(...(args.length?args:[now()]));} static now(){return now();} };
