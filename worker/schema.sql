DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS passkeys;
DROP TABLE IF EXISTS vaults;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS password_vaults;
DROP TABLE IF EXISTS email_sessions;
DROP TABLE IF EXISTS email_users;
DROP TABLE IF EXISTS phone_sessions;
DROP TABLE IF EXISTS phone_users;

CREATE TABLE IF NOT EXISTS email_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (email_user_id) REFERENCES email_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_sessions (
  id TEXT PRIMARY KEY,
  email_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (email_user_id) REFERENCES email_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_vaults (
  email_user_id TEXT PRIMARY KEY,
  vault_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (email_user_id) REFERENCES email_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes(email_user_id);
CREATE INDEX IF NOT EXISTS idx_email_sessions_token_hash ON email_sessions(token_hash);
