DROP TABLE IF EXISTS url_mappings;

-- 创建URL映射表
CREATE TABLE IF NOT EXISTS url_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_url TEXT NOT NULL UNIQUE,
  long_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 创建索引以加快查询速度
CREATE INDEX IF NOT EXISTS idx_short_url ON url_mappings (short_url);
CREATE INDEX IF NOT EXISTS idx_long_url ON url_mappings (long_url);
CREATE INDEX IF NOT EXISTS idx_created_at ON url_mappings (created_at);
