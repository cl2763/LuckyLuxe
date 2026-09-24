import { imageView, storedImageView } from './image-view.mjs'
/* 顾客首页轮播图 · 按租户出数据(D78,店主 2026-08-28 立案)。

   🔴 病根:三张轮播原来是**前端写死的数组,两端各写一份**
   (`apps/web/customer.js:1040` 与 `miniprogram/pages/home/index.js:121`),零租户输入 ——
   小婕的店、两家演示店的顾客,首页看到的全是 Lucky Luxe 本店的图;
   小程序那份连文案都写着「Lucky Luxe 店内氛围」。归族「一件事两处真相」+「假数回落」。

   三条硬要求(店主原话):
     ① 按租户出数据,**唯一出口**,两端同源,前端不许再写死;
     ② 商家后台自管(上传/排序/文案/启停);
     ③ **零回落**:没配的店不许回落到 Lucky Luxe 的图 —— 退到不出轮播、只出店卡。

   为什么 ③ 要写成"返回空数组"而不是"给个默认图":
   《假数回落红线》第 1 条 —— 顾客能看见的东西,拿不到真值就如实什么都不显示,
   绝不拿**另一家店的**图顶上。轮播是店面门脸,顶错了等于把别人家的店拍给顾客看。

   为什么图存 data: URL:**复用现成的做法**(公约④)——
   作品图(`bookings.work_images_json`)一直就是这么存的,两端都已能渲染 data: URL,
   不为这一个功能新起一套对象存储。上限在下面的闸里写死。 */

export const HERO_SLIDE_MAX = 6              // 一屏轮播最多 6 张:再多顾客划不到,也撑大响应体
export const HERO_LABEL_MAX = 40             // 文案上限(两端都只在图上压一行字)
export const HERO_IMAGE_MAX_BYTES = 2 * 1024 * 1024   // 单图 2MB:data: URL 直接进库,不设限会把响应体撑爆

/* 建表 + 结构自证。
   🔴《静默失败器族》:`CREATE TABLE IF NOT EXISTS` 在"表已存在但结构不同"时**什么也不做**,
   接口到运行期才 500。所以建完立刻用 PRAGMA 逐列核对,缺列当场抛 —— 这一步必须发生,就不许它静默跳过。 */
export function ensureHeroSlidesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hero_slides (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      image TEXT NOT NULL,
      label_zh TEXT NOT NULL DEFAULT '',
      label_en TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
  if (!db.prepare('PRAGMA table_info(hero_slides)').all().some(c => c.name === 'image_view_json')) db.exec("ALTER TABLE hero_slides ADD COLUMN image_view_json TEXT NOT NULL DEFAULT '{}'")
  db.exec('CREATE INDEX IF NOT EXISTS idx_hero_slides_tenant ON hero_slides (tenant_id, sort_order)')
  const need = ['id', 'tenant_id', 'image', 'label_zh', 'label_en', 'sort_order', 'is_active', 'created_at', 'updated_at', 'image_view_json']
  const have = db.prepare('PRAGMA table_info(hero_slides)').all().map((c) => c.name)
  const missing = need.filter((c) => !have.includes(c))
  if (missing.length) {
    throw new Error(`hero_slides 表结构不符(缺列:${missing.join(', ')})—— 老库要补 ALTER TABLE ADD COLUMN,不许靠 IF NOT EXISTS 蒙混`)
  }
}

export function createHeroSlides({ db, apiError, iso, randomId, currentTenantId }) {
  /* ===== 后端最终闸(《后端是最终闸律》:前端拦只算体验)=====
     每一条都能被"绕开前端直接打接口"证伪,所以每一条都在这里,而不是在页面上。 */
  function assertSlidesOk(slides) {
    if (!Array.isArray(slides)) throw apiError(400, 'BAD_REQUEST', '轮播图要以数组提交。')
    if (slides.length > HERO_SLIDE_MAX) {
      throw apiError(400, 'BAD_REQUEST', `轮播最多 ${HERO_SLIDE_MAX} 张(再多顾客也划不到)。`)
    }
    slides.forEach((slide, index) => {
      imageView(slide?.imageView, message => apiError(400, 'BAD_REQUEST', message))
      const image = String(slide?.image || '').trim()
      if (!image) throw apiError(400, 'BAD_REQUEST', `第 ${index + 1} 张没有图片。`)
      const okScheme = image.startsWith('data:image/') || image.startsWith('/assets/') || image.startsWith('https://')
      if (!okScheme) {
        throw apiError(400, 'BAD_REQUEST', `第 ${index + 1} 张图片地址不合法(只收上传的图片、站内 /assets/ 路径或 https 链接)。`)
      }
      if (image.startsWith('data:image/') && image.length > HERO_IMAGE_MAX_BYTES) {
        throw apiError(400, 'BAD_REQUEST', `第 ${index + 1} 张图片太大(单张上限 ${Math.round(HERO_IMAGE_MAX_BYTES / 1024 / 1024)}MB),请压缩后再传。`)
      }
      if (String(slide?.labelZh || '').length > HERO_LABEL_MAX || String(slide?.labelEn || '').length > HERO_LABEL_MAX) {
        throw apiError(400, 'BAD_REQUEST', `第 ${index + 1} 张的文案超过 ${HERO_LABEL_MAX} 字。`)
      }
    })
  }

  /* 商家后台视图:含停用的,按排序;店主要能看到自己停掉了哪几张。 */
  function listHeroSlides(tenantId = currentTenantId()) {
    return db.prepare('SELECT * FROM hero_slides WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(tenantId).map(serialize)
  }

  /* 🔴 顾客端唯一出口(公开 /stores 下发)。
     只出启用的;**一张都没有就回空数组** —— 不回落到任何别家店的图。 */
  function publicHeroSlides(tenantId, lang = 'zh') {
    return db.prepare('SELECT * FROM hero_slides WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order ASC, created_at ASC')
      .all(tenantId).map((row) => ({
        id: row.id, image: row.image,
        imageView: storedImageView(row.image_view_json),
        label: lang === 'en' ? (row.label_en || row.label_zh || '') : (row.label_zh || row.label_en || ''),
        labelZh: row.label_zh || '',
        labelEn: row.label_en || ''
      }))
  }

  /* 整批替换(排序=数组顺序)。一次一店,顺序、文案、启停都在这一趟里,
     省得"改排序"和"改文案"两条路各写一份判断 —— 一件事一处真相。 */
  function replaceHeroSlides(slides, tenantId = currentTenantId()) {
    assertSlidesOk(slides)
    const now = iso(new Date())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM hero_slides WHERE tenant_id = ?').run(tenantId)
      const insert = db.prepare(`INSERT INTO hero_slides
        (id, tenant_id, image, label_zh, label_en, sort_order, is_active, created_at, updated_at, image_view_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      slides.forEach((slide, index) => {
        insert.run(randomId('hero'), tenantId, String(slide.image).trim(),
          String(slide.labelZh || '').trim(), String(slide.labelEn || '').trim(),
          index, slide.isActive === false ? 0 : 1, now, now, JSON.stringify(imageView(slide.imageView)))
      })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return listHeroSlides(tenantId)
  }

  function serialize(row) {
    return {
      id: row.id,
      image: row.image,
        imageView: storedImageView(row.image_view_json),
      labelZh: row.label_zh || '',
      labelEn: row.label_en || '',
      sortOrder: row.sort_order,
      isActive: Boolean(row.is_active),
      updatedAt: row.updated_at
    }
  }

  return { listHeroSlides, publicHeroSlides, replaceHeroSlides, assertSlidesOk }
}
