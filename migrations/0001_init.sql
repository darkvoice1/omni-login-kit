CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(100) NOT NULL,
  avatar_url text,
  email varchar(255) UNIQUE,
  phone varchar(32) UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type varchar(64) NOT NULL,
  provider_subject varchar(255) NOT NULL,
  email varchar(255),
  phone varchar(32),
  nickname varchar(100),
  avatar_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_type, provider_subject)
);

CREATE TABLE IF NOT EXISTS credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL UNIQUE REFERENCES identities(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_algo varchar(32) NOT NULL,
  password_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene varchar(64) NOT NULL,
  channel varchar(32) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target varchar(255) NOT NULL,
  token_hash text NOT NULL,
  code_length integer,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  sender_name varchar(64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type varchar(64) NOT NULL,
  state_hash text NOT NULL,
  redirect_to text,
  pkce_verifier text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  device_info jsonb,
  ip_address inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identities_user_id ON identities(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_target_scene_channel ON verification_tokens(target, scene, channel);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user_id ON verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_provider_type ON oauth_states(provider_type);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
