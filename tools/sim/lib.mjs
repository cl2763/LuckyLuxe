/* 模拟器自动化公共件(结算页随机对账等脚本共用)。
   前置:①handoff/自动化占用中.txt 必须先改「占用中」;②微信开发者工具已开自动化端口:
   /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project <本仓库> --auto-port 9420
   依赖:npm i miniprogram-automator(临时装在跑脚本的目录即可,不入本仓库依赖)。 */
import automator from 'miniprogram-automator';
import fs from 'node:fs';
import path from 'node:path';

export const SHOT_DIR = process.env.SHOT_DIR || path.join(process.cwd(), 'sim-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

export async function connect() {
  return automator.connect({ wsEndpoint: 'ws://localhost:' + (process.env.AUTO_PORT || 9420) });
}

export async function shot(mp, name) {
  const p = path.join(SHOT_DIR, name.endsWith('.png') ? name : name + '.png');
  await mp.screenshot({ path: p });
  console.log('  [shot]', p);
  return p;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
