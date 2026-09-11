from pathlib import Path
import json
p=Path(__file__).parent
sections=[
('美甲单色','MONOCHROME',[('精品单色','',360,318,288),('高光猫眼','',460,398,368)],''),
('简单款式','SIMPLE STYLES',[('操作 2 小时以内','跳色 / 全手拍拍渐变 / 全手亮片 / 腮红拍拍',510,448,408),('操作 3 小时以内','全手蹭粉 / 猫眼法式 / 两指后缘平底钻 / 单指款式 / 腮红猫眼',610,538,488),('操作 3.5 小时以内','手绘法式 / 简单手绘款 / 两指简单水彩 / 中号钻球 / 钢珠链条拼钻 / 单只微雕 / 简易 ins 款 / 迷你堆钻球 / 两指晕染 / 单指冰花',710,618,568)],''),
('延长类','EXTENSION',[('浅贴甲片','',410,358,328),('甲膜延长','',410,358,328)],'单指延长按总价十分之一计算 · 甲片重复利用 100（仅限本店制作）'),
('复杂款式','COMPLEX STYLES',[('操作 4 小时以内','两指冰花 / 全手晕染 / 全手简单手绘 / 镂空法式 / 全手小钻 / 两指钢珠拼钻 / 三指水彩款 / 钻球款 / 两指微雕',810,708,648),('操作 5 小时以内','鳄鱼纹款式 / 反法式猫眼贴钻 / 四指钢珠拼钻 / 四指冰花',1010,888,808),('操作 6 小时以内','全手贴钻（平底）/ 复杂手绘 / 四指雕花 / 大钻款 / 捏捏款 / 磨具款',1210,1058,968),('操作 8 小时以内','全手钢珠拼钻搭配 / 饰品组合 / 全手拼钻 / 高定制款',1610,1418,1288)],'足部美甲在手部美甲基础上 + 100 · 复杂款式需提前预约并留足时长'),
('补甲类','REPAIR',[('纤维 / 甲片补甲（单指）','',40,36,32)],''),
('卸甲类','REMOVAL',[('卸本甲','',60,48,38),('足部卸甲','',60,48,38),('甲片卸甲','',90,72,58)],'温馨提示：如本店制作，卸除后继续做美甲不收取卸甲费用；本店做单纯卸甲正常收取费用，单指按总价十分之一计算。卸甲类已按工本价计，不再叠加会员等级折扣。'),
('美睫','EYELASH EXTENSIONS',[('一对一单根嫁接','根根分明 · 轻盈日常 · 还原真睫质感',410,358,328),('自然款式','开花 / 山茶花 / 自然浓密',510,448,408),('款式美睫','漫画款 / 精灵款 / 彩色挑染 / 定制眼型设计',710,618,568),('下睫毛','',210,178,168),('卸除睫毛','',160,138,128)],'温馨提示：本店嫁接的睫毛，卸除后继续嫁接不收取卸除费用；单纯卸除正常收取费用。'),
('手足护理','HAND & FOOT CARE',[('手部新中式精修前置处理','',160,138,128),('富勒烯深层滋养手部护理','疗程 1,010 / 3 次',510,448,408),('云足焕肤 SPA','足部去角质 + 深层滋养 · 疗程 1,200 / 3 次',610,538,488)],'')]
sections[6]=('美睫 · 嫁接','EYELASH EXTENSIONS',[
('一对一单根嫁接','根根分明',360,318,288,460,398,368),
('自然款式','开花 / 山茶花',460,398,368,610,538,488),
('款式美睫','漫画 / 精灵 / 挑染 / 定制',560,498,448,710,618,568)],'保养价含嫁接后 15 天内免费补一次，需提前预约；补的是自然脱落、恢复原款式饱满度，不含改款加密换色。逾期作废，不折现、不转让。单次价不含补，事后需要补按当次报价另计。仅限本店嫁接。')
sections[7]=('美睫 · 单项','LASH ADD-ON',[
('下睫毛','',110,98,88),('卸除睫毛','',90,78,72)],'温馨提示：本店嫁接的睫毛，卸除后继续嫁接不收取卸除费用；单纯卸除正常收取费用。卸除睫毛为工本价，不叠加会员等级折扣。')
sections.append(('手足护理','HAND & FOOT CARE',[
('富勒烯深层滋养手部护理','去角质 · 安瓶导入 · 热敷包裹',310,268,248,558),
('云足焕肤 SPA','足部去角质 · 深层滋养 · 足膜包裹',360,318,288,648),
('手部新中式精修前置处理','美甲前置加购项',160,138,128,'—')],
'3 次卡为一口价，不叠加会员等级折扣；自购卡日起 12 个月内有效，过期作废、不折现，卡内可指定 1 次转赠好友。'))
def section(s):
 n,en,rows,note=s
 k=len(rows[0])-2
 cl=' six' if k==6 else (' four' if k==4 else '')
 out='<section class="'+cl+'"><h2>'+n+' <small>'+en+'</small></h2>'
 if k==6:out+='<div class="group-head"><span></span><span>单次 · 不含补</span><span>保养 · 含 15 天补一次</span></div>'
 heads=['项目','原价','分享价','会员价']
 if k==6:heads+=['原价','分享价','会员价']
 if k==4:heads+=['3 次卡']
 out+='<div class="prices-head">'+''.join('<span>'+v+'</span>' for v in heads)+'</div>'
 for r in rows:
  out+='<div class="row"><div>'+r[0]+('<small>'+r[1]+'</small>' if r[1] else '')+'</div>'+''.join('<span>'+str(v)+'</span>' for v in r[2:])+'</div>'
 return out+('<p class="note">'+note+'</p>' if note else '')+'</section>'
benefits=[
['全店项目享 <b>会员价</b>（原价 8 折）','婚甲礼遇 <b>6.6 折</b> ×1 · <b>终身一次</b>',('会员专属服务包','200'),'同行好友 85 折券 ×1（护理不适用）'],
['全店项目享 <b>金卡会员价</b>（原价 7.5 折）','每年生日半价礼 ×1 · <b>金卡起专属</b>',('富勒烯深层滋养手部护理 ×1','310'),'婚甲礼遇 <b>6.6 折</b> ×1 · 终身一次','预约免定金 · <b>金卡起专属</b>',('会员专属服务包','200'),'同行好友 85 折券 ×1（护理不适用）'],
['全店项目享 <b>铂金卡会员价</b>（原价 7 折）',('富勒烯深层滋养手部护理 <b>×2 · 铂金起翻倍</b>','620'),('一对一单根嫁接 · 保养体验卡 ×1','460'),'婚甲礼遇 <b>6.6 折</b> ×1 · <b>伴娘同行 3 位</b>享会员价 · 婚礼前一日免费补甲 · <b>铂金起</b>','每年生日半价礼 ×1','指定技师','预约免定金',('会员专属服务包','200'),'同行好友 85 折券 ×1（护理不适用）'],
['全店项目享 <b>黑卡会员价</b>（原价 6.5 折 · 全店最优）',('云足焕肤 SPA ×2 · <b>黑卡专属</b>','720'),('款式美睫 · 保养体验卡 ×1 · <b>黑卡专属</b>','710'),('富勒烯深层滋养手部护理 ×2','620'),'婚甲礼遇 <b>6.6 折</b> ×1 · <b>伴娘同行 6 位</b>享会员价 · 婚礼前一日免费补甲','每年生日半价礼 ×1','指定技师 · 优先预约时段','预约免定金',('会员专属服务包','200'),'同行好友 85 折券 ×1（护理不适用）']]
tiers=[('银卡','SILVER','8.0','即价目表「会员价」','充值 800 · 或累计消费 800','200'),('金卡','GOLD','7.5','于门店原价','累计充值 2,000 · 或累计消费 3,000','500'),('铂金卡','PLATINUM','7.0','于门店原价','累计充值 3,500 · 或累计消费 8,000','1,200'),('至尊黑卡','BLACK','6.5','于门店原价 · 全店最优','累计充值 5,000 · 或累计消费 15,000','2,200')]
css='''*{box-sizing:border-box}body{margin:0;background:#d8d8d0;color:#352f28;font-family:"Songti SC",serif}.sheet{position:relative;background:#f5f1e7 url('assets/矿物肌理背景.png') center/100% 100%;overflow:hidden;margin-bottom:30px}.sheet:before{content:"";position:absolute;inset:20px;border:1px solid #b4a287;pointer-events:none}.price{width:1800px;height:1272px;padding:55px 65px 40px}.top{height:130px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #ab9678}.logo{width:205px;height:110px;object-fit:contain}h1{font-weight:500;font-size:48px;letter-spacing:14px;margin:4px 0 12px} .en{font-family:Arial,sans-serif;letter-spacing:5px;font-size:12px;color:#87785f}.cols{display:grid;grid-template-columns:1fr 1fr 1fr;height:942px;padding-top:27px;gap:30px}.col{min-height:0;display:flex;flex-direction:column;justify-content:space-between;padding-right:28px;border-right:1px solid #c6bda8}.col:last-child{border:0;padding:0}section{padding-bottom:17px}h2{font-size:24px;font-weight:600;margin:0 0 22px;letter-spacing:3px;display:flex;align-items:center;gap:14px}h2:before{content:"";width:4px;height:19px;background:#9aab9f}h2 small{font:9px Arial;letter-spacing:2px;color:#8a7a63}.prices-head,.row{display:grid;grid-template-columns:minmax(0,1fr) 52px 57px 57px;column-gap:8px}.prices-head{font-size:10px;color:#8a7a63;text-align:right;border-bottom:1px solid #b8ab94;padding-bottom:10px;letter-spacing:1px}.prices-head span:first-child{text-align:left}.row{font-size:17px;padding:12px 0;border-bottom:1px solid #d5cdbb}.row>span{text-align:right;font-family:Arial;font-size:16px;line-height:24px}.row>span:last-child{font-weight:600}.row small{display:block;font-size:11px;color:#807764;line-height:1.65;margin-top:6px}.note{font-size:11px;line-height:1.9;color:#817661;margin:18px 0 0}.price footer{border-top:1px solid #af9d82;padding-top:17px;display:flex;gap:33px;font-size:12px}.price footer small{display:block;font:8px Arial;letter-spacing:2px;color:#887c67;margin-bottom:7px}.appointment{margin-left:auto;align-self:end;font:9px Arial;letter-spacing:3px;color:#8a7a63;white-space:nowrap}.member{width:1272px;height:1800px;padding:44px 65px 36px}.member header{text-align:center;height:210px}.member header .logo{width:195px;height:112px;margin-bottom:12px}.member h1{font-size:39px;margin:0 0 10px}.join{border-top:1px solid #b8a789;border-bottom:1px solid #b8a789;text-align:center;padding:15px;background:#f6f2e8aa;font-size:17px;line-height:1.8;height:114px;margin-bottom:21px}.join .en{font-size:10px;letter-spacing:4px;margin-bottom:4px}.tier{display:grid;grid-template-columns:285px 1fr;border:1px solid #b8aa91;margin-bottom:17px;background:#fbf8f0b8;min-height:173px}.label{position:relative;padding:23px 23px;display:flex;justify-content:center;flex-direction:column;background:#b5beb1;color:#fffdf5}.label:before{content:"";position:absolute;inset:0;background:url('assets/矿物肌理背景.png') center/cover;mix-blend-mode:soft-light;opacity:.3}.label>*{position:relative}.tier:nth-child(2) .label{background:#b5a080}.tier:nth-child(3) .label{background:#847d6e}.tier:nth-child(4) .label{background:#37372f}.label h2{font-size:25px;letter-spacing:6px;margin:0 0 6px}.label h2:before{display:none}.label .eng{font:9px Arial;letter-spacing:3px;opacity:.8;margin-bottom:9px}.discount{font:46px Georgia;margin-bottom:8px}.discount small{font:17px "Songti SC"}.sub{font-size:13px;margin-bottom:10px}.threshold{font-size:13px;line-height:1.8}.perks{padding:15px 25px 12px}.benefit{font-size:16px;line-height:1.4;min-height:30px;padding:4px 0;border-bottom:1px solid #d8cdbb;display:flex;justify-content:space-between;gap:10px}.benefit:last-of-type{border:0}.value{font-size:12px;color:#8d7c62;white-space:nowrap;padding-top:3px}.gift{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #bbae96;margin-top:8px;padding-top:8px;color:#857252;font-size:12px;letter-spacing:3px}.gift strong{font: bold 25px Georgia;letter-spacing:0}.example{background:#d7cfb980;border-top:1px solid #b7a789;border-bottom:1px solid #b7a789;padding:12px 18px;font-size:15px;display:flex;gap:22px;margin:17px 0}.rules{font-size:12px;line-height:1.85;color:#7a705f}.rules p{margin:8px 0}.rules b{color:#544b3c}.member .appointment{text-align:right;margin-top:12px}'''
html='<!doctype html><meta charset="UTF-8"><title>LUVIA 侘寂系列</title><style>'+css+'</style><main id="price" class="sheet price"><header class="top"><div><h1>价目表</h1><div class="en">NAIL · LASH · CARE</div></div><img class="logo" src="assets/logo.svg"></header><div class="cols">'
for ix in [[0,1,2],[3,4,5],[6,7,8]]:html+='<div class="col">'+''.join(section(sections[i]) for i in ix)+'</div>'
html+='</div><footer><div><small>SHARE PRICE</small>分享小程序至微信，当单即享分享价</div><div><small>MEMBER</small>单次消费或充值满 800 即为银卡会员，享会员价</div><div><small>TIERS</small>会员价 = 原价 8 折 · 金卡 7.5 折 · 铂金卡 7 折 · 至尊黑卡 6.5 折</div><div class="appointment">BY APPOINTMENT ONLY</div></footer></main>'
html+='<main id="member" class="sheet member"><header><img class="logo" src="assets/logo.svg"><h1>会员体系</h1><div class="en">MEMBERSHIP · FOUR TIERS</div></header><div class="join"><div class="en">HOW TO JOIN</div>单次消费或累计消费满 <b>800</b> · 或充值 <b>800</b> — 即为银卡会员<br>两种方式均可升级，<b>取较高等级</b>；未达门槛可分享小程序享分享价</div><div class="tiers">'
for t,bs in zip(tiers,benefits):
 n,en,d,sub,th,v=t
 html+='<div class="tier"><div class="label"><div class="eng">'+en+'</div><h2>'+n+'</h2><div class="discount">'+d+' <small>折</small></div><div class="sub">'+sub+'</div><div class="threshold">'+th+'</div></div><div class="perks">'
 for b in bs:
  text,value=b if isinstance(b,tuple) else (b,'')
  html+='<div class="benefit"><span>'+text+'</span>'+('<span class="value">价值 ¥'+value+'</span>' if value else '')+'</div>'
 html+='<div class="gift">礼遇价值<strong>¥'+v+' +</strong></div></div></div>'
html+='</div><div class="example"><span>以「精品单色 <s>¥360</s>」为例</span><span>银卡 <b>288</b></span><span>金卡 <b>270</b></span><span>铂金卡 <b>252</b></span><span>至尊黑卡 <b>234</b></span></div><div class="rules"><p><b>会员规则</b>　累计消费与充值双轨判定，按较高等级享受权益，等级永久有效。赠礼券于开卡后发放至小程序券包，自开卡日起 12 个月内有效，需提前预约，不折现、不转让。生日礼以系统登记生日为准，首次开卡当月不计入。卡内余额上限 5,000。各等级均直接按门店原价打折结算（银卡 8 折即价目表会员价，金卡 7.5 折，铂金卡 7 折，至尊黑卡 6.5 折），四舍五入至元；卸甲类为工本价，不叠加等级折扣；护理 3 次卡为一口价，同样不叠加等级折扣。婚甲礼遇：终身一次，需凭结婚证 / 请柬 / 婚纱照拍摄合同任一核验后发券，限婚礼前 30 天内、限周一至周五（避开法定节假日）；仅限手部款式美甲一个项目，足部同做、卸甲与护理按本人等级价；与本人等级价取较优，不与其他券叠加；成品本店可用于作品展示。伴娘同行礼（铂金起）：铂金卡 3 位、至尊黑卡 6 位，限精品单色或高光猫眼、按会员价结算，需提前预约、单日最多 4 位可分两日，另各赠 30 日内有效回访 85 折券一张。</p><p>退卡方式：退卡金额 = 卡内总金额 − 已消费项目按门店原价（非会员价）折算，多退少补。请谨慎储值，一经办卡即视为同意以上规则。</p></div><div class="appointment">BY APPOINTMENT ONLY</div></main>'
(p/'LUVIA_价目与会员_可编辑.html').write_text(html)
(p/'价目数据.json').write_text(json.dumps(sections,ensure_ascii=False,indent=2))
refined='''
body{background:#e8e3dc;color:#3c332d}
.sheet{background:#faf7f1;background-image:none}
.sheet:before{inset:25px;border:1px solid #cfc0aa}
.sheet:after{content:"";position:absolute;top:25px;left:25px;width:76px;height:3px;background:#9d8160}
.top{border-bottom:1px solid #c9b79c;height:144px;align-items:flex-start}
h1{font-weight:400;font-size:46px;letter-spacing:13px}
.logo{width:224px;height:113px}
.en{color:#9c876c;letter-spacing:4px;font-size:10px}
.cols{height:943px;padding-top:30px;gap:34px}
.col{padding-right:32px;border-color:#e1d7c8}
h2{font-size:23px;letter-spacing:2px;font-weight:500;gap:13px;margin-bottom:22px}
h2:before{display:none}
h2 small{font-size:8px;letter-spacing:1.8px;color:#a18b70}
.prices-head{border-color:#cdbba2;color:#9b886e;font-size:10px}
.row{border-color:#e5ddd0;font-size:17px;padding:12px 0}
.row>span{font-size:16px;color:#8a7d6e}
.row>span:last-child{color:#45382c;font-weight:500}
.row small{color:#938775;font-size:11px}
.note{color:#938775}
.price footer{border-color:#c9b79c;font-size:11px;gap:30px}
.price footer small{color:#a08a6c}
.price .appointment{font-size:8px;letter-spacing:2px}
.member header{height:220px}
.member header .logo{width:215px;height:112px;margin-bottom:17px}
.member h1{font-weight:400;font-size:37px;letter-spacing:12px}
.member header .en{font-size:9px}
.join{height:111px;background:transparent;border-color:#c9b79c;font-size:16px;padding:13px;margin-bottom:21px}
.join .en{font-size:9px}
.tier{border:0;border-top:1px solid #cbb89c;margin-bottom:15px;background:transparent;grid-template-columns:280px 1fr}
.label{background:#eee9df!important;color:#554839;padding:23px 26px;border-right:1px solid #ded3c2}
.label:before{display:none}
.tier:nth-child(2) .label{background:#e9dfcf!important}
.tier:nth-child(3) .label{background:#e3ded6!important}
.tier:nth-child(4) .label{background:#51473b!important;color:#f4ebdb}
.label h2{font-size:24px;letter-spacing:4px;font-weight:400;margin-bottom:8px}
.label .eng{font-size:8px;letter-spacing:3px;margin-bottom:13px;color:#9e896c;opacity:1}
.tier:nth-child(4) .eng{color:#cfbda1}
.discount{font:43px Georgia;margin-bottom:10px}
.discount small{font-size:14px}
.sub{font-size:12px;color:inherit;opacity:.8}
.threshold{font-size:12px;line-height:1.8}
.perks{padding:15px 0 12px 28px}
.benefit{font-size:15px;border-color:#e5dccc;min-height:30px}
.benefit b{font-weight:600}
.value{color:#a28e72;font-size:11px}
.gift{border-color:#d3c2a9;color:#9d896e;font-size:11px;padding-top:9px}
.gift strong{font:23px Georgia;color:#796348}
.example{background:#eee7dc;border:0;font-size:14px;padding:14px 18px;margin:15px 0}
.rules{color:#92836f;font-size:12px}
.member .appointment{font-size:8px;color:#a18b6c}
'''
html=html.replace('</style>',refined+'</style>').replace('LUVIA 侘寂系列','LUVIA 轻奢立牌')
(p/'LUVIA_价目与会员_可编辑.html').write_text(html)

final_css="""
.sheet{background:#f8f5ef;color:#3d3730}.sheet:before,.sheet:after{display:none}
.price{width:1900px;height:1344px;padding:65px 70px 45px;border-top:8px solid #a4937d}
.top{height:145px;border-color:#c6b8a2}.top h1{font-size:49px;letter-spacing:10px}
.cols{grid-template-columns:1fr 1fr 1.16fr;height:1020px;gap:32px;padding-top:35px}
.col{padding-right:27px}.col:last-child{padding:0}
h2{font-size:23px;letter-spacing:2px;margin-bottom:23px}h2 small{font-size:8px;letter-spacing:1.5px}
.row{font-size:17px;padding:13px 0}.row small{font-size:11px;line-height:1.7;color:#847b6c}.note{font-size:11px;color:#817666;line-height:1.8}
.six .prices-head,.six .row{grid-template-columns:minmax(125px,1fr) repeat(6,43px);gap:5px}
.six .row{font-size:14px;padding:19px 0}.six .row>span{font-size:14px}.six .row small{font-size:10px}
.six .row>span:nth-child(4),.six .row>span:nth-child(7){color:#44372d;font-weight:500}
.six .row>span:nth-child(5){border-left:1px solid #d8cdbb}
.six .prices-head{font-size:9px}.group-head{display:grid;grid-template-columns:minmax(125px,1fr) 144px 144px;text-align:center;font-size:10px;color:#8a795f;margin-bottom:12px}
.four .prices-head,.four .row{grid-template-columns:minmax(0,1fr) repeat(4,48px);gap:7px}
.four .row{font-size:15px}.four .row>span{font-size:15px}.four .row small{font-size:10px}
.member{width:1344px;height:1900px;padding:48px 70px 45px;border-top:8px solid #a4937d}
.member header{height:205px}.member header .logo{height:95px;width:205px;margin-bottom:19px}
.member h1{font-size:38px}.join{height:103px;font-size:16px;padding:11px;margin-bottom:22px}
.tier{grid-template-columns:259px 1fr;margin-bottom:17px;border-top:1px solid #b9a58a}
.label{padding:23px 24px;background:#e7e6df!important;color:#514c42}
.tier:nth-child(2) .label{background:#e8ddc9!important}
.tier:nth-child(3) .label{background:#ccc7be!important}
.tier:nth-child(4) .label{background:#514c43!important;color:#f6eee0}
.label h2{font-size:26px}.discount{font:48px Georgia}.threshold{font-size:12px}
.perks{padding:12px 0 13px 29px}.benefit{font-size:15px;line-height:1.6;min-height:30px;padding:4px 0;border-color:#e2dacd}.value{font-size:12px}
.gift{margin-top:8px;padding-top:9px}.gift strong{font-size:25px}
.example{font-size:14px;margin:16px 0;padding:13px 18px}.rules{font-size:12px;line-height:1.8;color:#807461}.rules p{margin:8px 0}
"""
html=html.replace('</style>',final_css+'</style>')
(p/'LUVIA_价目与会员_可编辑.html').write_text(html)
html=html.replace('</style>','.member .benefit{min-height:27px;padding:2px 0;line-height:1.5}.member .perks{padding-top:11px;padding-bottom:11px}.member header{height:200px}</style>')
(p/'LUVIA_价目与会员_可编辑.html').write_text(html)
html=html.replace('</style>','.six .row{padding:14px 0}.four .row{padding:11px 0}.col:last-child .note{margin-top:14px;line-height:1.7}</style>')
(p/'LUVIA_价目与会员_可编辑.html').write_text(html)
