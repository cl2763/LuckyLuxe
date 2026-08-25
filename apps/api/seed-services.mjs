/* 演示种子数据(从 local-server.mjs 搬出,2026-08-25)。

   本批动的就是这一域:【分类唯一真相律】要求种子也只写 category_id、不写自由文本分类,
   按公约②「边改边拆」顺手把**数据**搬出来(装配逻辑仍留在 seedDatabase 里)。
   这些「法式系列 / 日式款」原本是被塞进 category 列的**款式名** —— 它们是款式,不是分类;
   现在只作为演示项目的语义留在这里,不再写进任何分类字段。 */
export const seedServices = [
  ['nail-french-01', 'NAIL', '法式系列', '经典奶油法式', 'Classic Cream French', '柔和奶油底色搭配细线法式边，适合通勤与约会场景。', 'Soft cream base with a delicate French line for daily wear and special dates.', '/assets/images/nail-french.jpg', 16800, 5000, 120, 1, ['甲型修整', '基础护理', '底色上色', '法式线条', '封层护理'], ['服务前请尽量避免自行修剪过短', '如需卸甲请在预约时勾选加项']],
  ['nail-luxe-01', 'NAIL', '轻奢设计', '柔金贝母设计', 'Soft Gold Shell Design', '贝母片与柔金线条组合，保留高级感，也适合日常穿搭。', 'Mother-of-pearl accents and soft gold lines for an elevated everyday style.', '/assets/images/nail-luxe.jpg', 23800, 5000, 150, 2, ['甲面护理', '底色铺设', '贝母定位', '金线装饰', '加固封层'], ['复杂设计耗时较长，请预留完整服务时间']],
  ['nail-jp-01', 'NAIL', '日式款', '日式微闪渐变', 'Japanese Shimmer Gradient', '细腻微闪从甲根自然过渡，温柔显白，适合短甲。', 'A subtle shimmer gradient that looks soft, clean, and flattering on short nails.', '/assets/images/nail-jp.jpg', 19800, 5000, 120, 3, ['手部清洁', '甲型调整', '渐变叠色', '微闪点缀', '封层'], ['渐变色可到店根据肤色调整']],
  ['nail-care-01', 'NAIL', '基础护理', '手部基础护理', 'Basic Hand Care', '修型、软化、死皮护理与营养油养护，适合定期维护。', 'Shape, soften, clean cuticles, and nourish for regular maintenance.', '/assets/images/nail-care.jpg', 8800, 5000, 120, 4, ['清洁消毒', '修型', '软化护理', '死皮修整', '营养油'], ['此项目不含甲油胶上色']],
  ['lash-natural-01', 'LASH', '自然款', '裸感自然睫', 'Bare Natural Lash', '轻盈自然，放大眼神但保留原生感。', 'Light, natural lashes that open the eyes while keeping a bare-skin look.', '/assets/images/lash-natural.jpg', 19800, 5000, 120, 1, ['眼型沟通', '清洁隔离', '睫毛嫁接', '梳理定型', '护理说明'], ['服务后 6 小时内尽量避免接触水汽']],
  ['lash-volume-01', 'LASH', '浓密款', '轻盈浓密睫', 'Soft Volume Lash', '在自然舒适的基础上增强存在感，适合拍照和重要场合。', 'Comfortable volume with stronger presence for photos and special occasions.', '/assets/images/lash-volume.jpg', 26800, 5000, 120, 2, ['眼型设计', '分层嫁接', '密度调整', '梳理检查', '护理说明'], ['敏感眼型请提前备注']]
]
