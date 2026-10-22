import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { now } from './time.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const dbFile = path.join(config.dataDir, 'laundry.db');
export const db = new DatabaseSync(dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// 预编译语句缓存
const statements = new Map();
function stmt(sql) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export const q = {
  get: (sql, ...params) => stmt(sql).get(...params),
  all: (sql, ...params) => stmt(sql).all(...params),
  run: (sql, ...params) => stmt(sql).run(...params),
};

// 事务：支持嵌套调用（内层直接复用外层事务）
let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

// 数据库结构版本，按顺序执行，已执行过的不会重复执行
const migrations = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('manager', 'clerk')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    code       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_customers_code ON customers(code);
  CREATE INDEX idx_customers_name ON customers(name);

  CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    price      INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE orders (
    id            INTEGER PRIMARY KEY,
    order_no      TEXT NOT NULL UNIQUE,
    customer_id   INTEGER NOT NULL REFERENCES customers(id),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'picked', 'cancelled')),
    total_qty     INTEGER NOT NULL DEFAULT 0,
    amount        INTEGER NOT NULL DEFAULT 0,
    note          TEXT NOT NULL DEFAULT '',
    received_at   TEXT NOT NULL,
    picked_at     TEXT,
    created_by    INTEGER REFERENCES users(id),
    picked_by     INTEGER REFERENCES users(id),
    cancelled_at  TEXT,
    cancelled_by  INTEGER REFERENCES users(id),
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX idx_orders_customer ON orders(customer_id);
  CREATE INDEX idx_orders_status ON orders(status, received_at);
  CREATE INDEX idx_orders_received ON orders(received_at);
  CREATE INDEX idx_orders_picked ON orders(picked_at);

  CREATE TABLE order_items (
    id          INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_items_order ON order_items(order_id);
  CREATE INDEX idx_items_category ON order_items(category_id);

  CREATE TABLE print_jobs (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    printed_at TEXT
  );
  CREATE INDEX idx_print_jobs_status ON print_jobs(status, id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2：打印任务改为“领取 → 打印 → 确认”，领取后未确认的会重新排队
  `
  ALTER TABLE print_jobs ADD COLUMN claimed_at INTEGER;
  ALTER TABLE print_jobs ADD COLUMN station TEXT NOT NULL DEFAULT '';
  `,
  // v3：打印任务记录打印内容：all 全部（每件一张）/ piece 单张（第几件）/ order 整单一张
  `
  ALTER TABLE print_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'all';
  ALTER TABLE print_jobs ADD COLUMN piece INTEGER;
  `,
  // v4：包期会员（member_type: regular 普通 / package 包期；base_code 为设为包期前的 4 位编码）
  `
  ALTER TABLE customers ADD COLUMN member_type TEXT NOT NULL DEFAULT 'regular';
  ALTER TABLE customers ADD COLUMN base_code TEXT;
  ALTER TABLE customers ADD COLUMN member_since TEXT;
  CREATE INDEX idx_customers_base_code ON customers(base_code);
  CREATE INDEX idx_customers_member ON customers(member_type);
  `,
];

export const DEFAULT_CATEGORIES = [
  '衣物', '鞋子', '床单', '被套', '枕头套', '毛巾',
  '书包', '浴巾', '毛毯', '凉被', '围巾', '帽子',
];

function migrate() {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < migrations.length; i++) {
    tx(() => {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

function seed() {
  const { n } = q.get('SELECT COUNT(*) AS n FROM categories');
  if (n === 0) {
    tx(() => {
      DEFAULT_CATEGORIES.forEach((name, i) => {
        q.run('INSERT INTO categories (name, sort_order, created_at) VALUES (?, ?, ?)', name, i + 1, now());
      });
    });
  }
}

migrate();
seed();
