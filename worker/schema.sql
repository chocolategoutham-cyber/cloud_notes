DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS passkeys;
DROP TABLE IF EXISTS vaults;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS phone_users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  phone_user_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (phone_user_id) REFERENCES phone_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS phone_sessions (
  id TEXT PRIMARY KEY,
  phone_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (phone_user_id) REFERENCES phone_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_vaults (
  phone_user_id TEXT PRIMARY KEY,
  vault_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (phone_user_id) REFERENCES phone_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes(phone_user_id);
CREATE INDEX IF NOT EXISTS idx_phone_sessions_token_hash ON phone_sessions(token_hash);
