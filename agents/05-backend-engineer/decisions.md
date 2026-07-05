# Decisions

- 第一版不需要 Redis，预约冲突优先用数据库事务/唯一约束解决。
- 数据库和 API Server 分离，Supabase 托管数据库。
