// Run the official DevTools assertions before recording exact-source evidence.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {join,relative} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const project=process.env.MP_TEST_PROJECT;assert.ok(project,'Set explicit isolated MP_TEST_PROJECT')
assert.ok(project.includes('/隔离测试/'),'Use the isolated developer-tools project')
const hash=b=>createHash('sha256').update(b).digest('hex'),walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]),files=walk('miniprogram'),before=Object.fromEntries(files.map(p=>[p,hash(readFileSync(p))])),diff=[]
for(const p of files)if(hash(readFileSync(join(project,relative('miniprogram',p))))!==before[p])diff.push(p)
assert.deepEqual(diff.sort(),['miniprogram/project.config.json','miniprogram/utils/api.js','miniprogram/utils/devhost.js'].sort())
assert.equal(readFileSync('miniprogram/utils/api.js','utf8').replace('USE_LOCAL_SANDBOX = false','USE_LOCAL_SANDBOX = true'),readFileSync(join(project,'utils/api.js'),'utf8'))
const suites=[]
for(const [suite,assertions]of [['mp-placeholder-size',3],['mp-overlap',4],['mp-home-sections',9]]){
 const log='handoff/catalog-inline-20261126/evidence/'+suite+'.log',r=spawnSync(process.execPath,['apps/api/test-'+suite+'.mjs'],{env:process.env,encoding:'utf8',timeout:90000});writeFileSync(log,(r.stdout||'')+(r.stderr||''));assert.equal(r.status,0,suite+' failed: '+log);const bytes=readFileSync(log);assert.equal((bytes.toString().match(/^ok\s+\d+/gm)||[]).length,assertions);assert.ok(bytes.toString().includes('all '+assertions+' checks passed'));suites.push({suite,assertions,status:'passed',log,sha256:hash(bytes)});console.log(suite+': '+assertions+' passed')
}
for(const p of files)assert.equal(hash(readFileSync(p)),before[p],'Source changed during native verification')
writeFileSync('handoff/catalog-inline-20261126/native-layout.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:`官方 miniprogram-automator / 本机${process.env.MP_AUTO_PORT || 9420} / 隔离服务${process.env.TEST_SANDBOX_URL || 'http://127.0.0.1:4310'}；三套真实原生布局检查，不代替全业务验收`,projectPath:project,sourceComparison:{matched:files.length-diff.length,differences:diff,allowedDifferences:'api.js唯一差异已比对：本机调试开关；devhost本机地址；开发工具项目配置'},suites,files:before},null,2)+'\n')
