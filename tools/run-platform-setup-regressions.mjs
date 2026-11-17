import {spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
const root='/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116',data=root+'/ll-ci-data.platform-setup',base='http://127.0.0.1:4396'
const suites=process.argv.slice(2)
if(!suites.length||suites.some(s=>!/^test-[a-z0-9-]+\.mjs$/.test(s)))throw Error('Specify explicit API regression suite filenames')
mkdirSync(root+'/regression-logs',{recursive:true})
let failed=false
for(const suite of suites){const r=spawnSync(process.execPath,['apps/api/'+suite],{env:{...process.env,DATA_DIR:data,TEST_DB_PATH:data+'/lucky-luxe.sqlite',TEST_BASE_URL:base},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});writeFileSync(root+'/regression-logs/'+suite+'.log',(r.stdout||'')+(r.stderr||''));const checks=(r.stdout||'').split('\n').filter(l=>/^ok \d+/.test(l)).length;console.log(JSON.stringify({suite,status:r.status,checks,error:r.error?.message}));if(r.status!==0){failed=true;break}}
if(failed)process.exitCode=1
