/* 多 writer 下的 SQLite 起手式(店主 05n 裁 (6))

   ══ 为什么要有它 ══
   05l 那把并发刀砍不动,查明是两层原因叠在一起:
   ① 单进程里 `createBooking` 从头到尾没有 await,对同进程天然原子 —— 刀砍空;
   ② 两个进程同打一个库时,**先撞上的是 SQLite 的库级写锁** ——
      输的那个直接 `database is locked` → **500**,轮不到事务内那次复查说话。
   所以那时只能如实写「今天成立是靠单进程原子性,不是靠复查」。

   ══ 这两行改变了什么 ══
   · `journal_mode=WAL`  —— 读写不再互相阻塞,写者之间才谈得上排队而不是直接报错;
   · `busy_timeout=5000` —— 撞上写锁时**等最多 5 秒**再说,而不是当场抛
     `SQLITE_BUSY`。等到了就轮到事务内那次可约复查,顾客拿到的是人话 409,不是 500。

   ⚠️ 只在**可写**连接上设:只读连接(`readOnly: true`)设 WAL 会失败,
   而且只读本来就没有写锁可撞。 */

export function applyConcurrencyPragmas(db, { label = '' } = {}) {
  if (!db) throw new Error('applyConcurrencyPragmas 需要一个已打开的库连接')
  /* WAL 是**写进库文件**的持久设置(设一次就跟着这个文件走);
     busy_timeout 是**连接级**的,每条连接都要自己设 —— 别以为设过一次就够。 */
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  const mode = db.prepare('PRAGMA journal_mode').get()
  const wait = db.prepare('PRAGMA busy_timeout').get()
  return {
    label,
    journalMode: String(mode?.journal_mode || ''),
    busyTimeout: Number(wait?.timeout ?? 0),
  }
}
