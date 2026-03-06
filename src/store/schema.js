export const SQLITE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rp_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('card','preset','lorebook')),
  name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  raw_json TEXT NOT NULL,
  extra_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name, type, version)
);

CREATE INDEX IF NOT EXISTS idx_assets_user_type ON rp_assets(user_id, type);
CREATE INDEX IF NOT EXISTS idx_assets_user_name ON rp_assets(user_id, name, type);

CREATE TABLE IF NOT EXISTS rp_cards (
  asset_id TEXT PRIMARY KEY REFERENCES rp_assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  scenario TEXT,
  first_message TEXT,
  alternate_greetings_json TEXT,
  example_dialogue TEXT,
  system_prompt TEXT,
  post_history_instructions TEXT,
  creator TEXT,
  tags_json TEXT,
  character_version TEXT
);

CREATE TABLE IF NOT EXISTS rp_presets (
  asset_id TEXT PRIMARY KEY REFERENCES rp_assets(id) ON DELETE CASCADE,
  temperature REAL,
  top_p REAL,
  top_k INTEGER,
  max_tokens INTEGER,
  frequency_penalty REAL,
  presence_penalty REAL,
  repetition_penalty REAL,
  prompt_template_json TEXT,
  stop_sequences_json TEXT
);

CREATE TABLE IF NOT EXISTS rp_lorebooks (
  asset_id TEXT PRIMARY KEY REFERENCES rp_assets(id) ON DELETE CASCADE,
  entries_json TEXT NOT NULL,
  activation_strategy TEXT NOT NULL DEFAULT 'keyword'
);

CREATE TABLE IF NOT EXISTS rp_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_session_key TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES rp_assets(id),
  preset_id TEXT NOT NULL REFERENCES rp_assets(id),
  status TEXT NOT NULL DEFAULT 'active',
  turn_count INTEGER NOT NULL DEFAULT 0,
  summary_version INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_active_channel
  ON rp_sessions(channel_session_key)
  WHERE status IN ('active', 'paused', 'summarizing');

CREATE INDEX IF NOT EXISTS idx_sessions_user ON rp_sessions(user_id, status);

CREATE TABLE IF NOT EXISTS rp_session_lorebooks (
  session_id TEXT NOT NULL REFERENCES rp_sessions(id) ON DELETE CASCADE,
  lorebook_asset_id TEXT NOT NULL REFERENCES rp_assets(id),
  PRIMARY KEY (session_id, lorebook_asset_id)
);

CREATE TABLE IF NOT EXISTS rp_turns (
  session_id TEXT NOT NULL REFERENCES rp_sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  token_estimate INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON rp_turns(session_id, turn_index);

CREATE TABLE IF NOT EXISTS rp_summaries (
  session_id TEXT NOT NULL REFERENCES rp_sessions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  covered_turn_from INTEGER NOT NULL,
  covered_turn_to INTEGER NOT NULL,
  summary_text TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, version)
);

CREATE TABLE IF NOT EXISTS rp_turn_embeddings (
  session_id TEXT NOT NULL REFERENCES rp_sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT,
  embedding_json TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  embedding_model TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_turn_embeddings_session_turn
  ON rp_turn_embeddings(session_id, turn_index);
`;
