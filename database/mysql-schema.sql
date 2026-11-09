-- MySQL / MariaDB schema for the Hostinger database.
--
-- A column-for-column copy of the Supabase (Postgres) tables as they stood on
-- 2026-11-03, including every column added by migrations 001-006. Column
-- names, nullability and defaults match Postgres, so the stores and
-- scripts/copy-supabase-to-mysql.js move every row over unchanged.
--
-- Type mapping:
--   text (keys / short values) -> VARCHAR, sized well above the longest stored value
--   text (free text)           -> MEDIUMTEXT
--   jsonb                      -> JSON
--   numeric                    -> DOUBLE (the app only ever reads/writes JS numbers)
--   timestamptz                -> DATETIME(6), always UTC (database/db.js sets the
--                                 session time zone and formats it back the way
--                                 Postgres did: 2026-10-20T09:02:12.037832+00:00)
--   bigserial / serial         -> AUTO_INCREMENT
--   uuid                       -> CHAR(36)
--
-- Tables use utf8mb4_bin so equality is exact and case-sensitive, as it was in
-- Postgres; database/db.js sorts text with utf8mb4_unicode_ci to keep the
-- Postgres (en_US) ordering of names and serials.
--
-- Run once on an EMPTY database (phpMyAdmin > SQL, or the copy script's
-- --create-schema flag). Every statement is CREATE TABLE IF NOT EXISTS, so a
-- re-run never touches existing rows.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accounts (
  username       VARCHAR(100)  NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  role           VARCHAR(50)   NOT NULL DEFAULT 'user',
  full_name      VARCHAR(255)  NOT NULL DEFAULT '',
  email          VARCHAR(255)           DEFAULT '',
  department     VARCHAR(100)           DEFAULT '',
  branch         VARCHAR(100)           DEFAULT '',
  status         VARCHAR(50)   NOT NULL DEFAULT 'active',
  PRIMARY KEY (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS clients (
  id              VARCHAR(191) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  location        VARCHAR(255)          DEFAULT '',
  status          VARCHAR(50)  NOT NULL DEFAULT 'active',
  sales_username  VARCHAR(100)          DEFAULT NULL,
  PRIMARY KEY (id),
  KEY clients_sales_username_idx (sales_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS machines (
  id                                INT          NOT NULL AUTO_INCREMENT,
  client_id                         VARCHAR(191) NOT NULL,
  client_name                       VARCHAR(255)          DEFAULT 'Unknown Client',
  location                          VARCHAR(255)          DEFAULT '',
  unit                              VARCHAR(100)          DEFAULT '',
  model                             VARCHAR(100)          DEFAULT '',
  serial_no                         VARCHAR(191)          DEFAULT '',
  date_installed                    VARCHAR(50)           DEFAULT '',
  running_hours                     DOUBLE                DEFAULT 0,
  status                            VARCHAR(100)          DEFAULT '',
  description                       MEDIUMTEXT            DEFAULT (''),
  submitted_by                      VARCHAR(255)          DEFAULT '',
  technicians                       JSON                  DEFAULT NULL,
  maintenance_service_date          VARCHAR(50)           DEFAULT '',
  part_service_dates                JSON                  DEFAULT NULL,
  part_service_hours                JSON                  DEFAULT NULL,
  part_service_adjustments          JSON                  DEFAULT NULL,
  initial_running_hours             DOUBLE                DEFAULT 0,
  initial_status                    VARCHAR(100)          DEFAULT '',
  initial_description               MEDIUMTEXT            DEFAULT (''),
  initial_maintenance_service_date  VARCHAR(50)           DEFAULT '',
  initial_part_service_dates        JSON                  DEFAULT NULL,
  initial_part_service_hours        JSON                  DEFAULT NULL,
  updates                           JSON                  DEFAULT NULL,
  reports                           JSON                  DEFAULT NULL,
  created_at                        DATETIME(6)           DEFAULT CURRENT_TIMESTAMP(6),
  smr_date                          VARCHAR(50)           DEFAULT '',
  initial_smr_date                  VARCHAR(50)           DEFAULT '',
  disabled_at                       DATETIME(6)           DEFAULT NULL,
  disabled_by                       VARCHAR(255)          DEFAULT NULL,
  PRIMARY KEY (id),
  KEY machines_client_id_idx (client_id),
  KEY machines_serial_no_idx (serial_no),
  CONSTRAINT machines_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS parts_catalog (
  id             CHAR(36)     NOT NULL,
  part_number    VARCHAR(100) NOT NULL,
  description    MEDIUMTEXT            DEFAULT NULL,
  model_series   VARCHAR(100)          DEFAULT NULL,
  created_at     DATETIME(6)           DEFAULT CURRENT_TIMESTAMP(6),
  unit           VARCHAR(50)           DEFAULT NULL,
  expiry_months  INT                   DEFAULT NULL,
  expiry_hours   INT                   DEFAULT NULL,
  expiry_days    INT                   DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- created_at / expires_at / accepted_at were text columns in Postgres (the app
-- stores ISO strings), so they stay strings here.
CREATE TABLE IF NOT EXISTS invites (
  token              VARCHAR(128) NOT NULL,
  email              VARCHAR(255)          DEFAULT '',
  role               VARCHAR(50)           DEFAULT '',
  branch             VARCHAR(100)          DEFAULT '',
  department         VARCHAR(100)          DEFAULT '',
  status             VARCHAR(50)           DEFAULT 'pending',
  created_at         VARCHAR(50)           DEFAULT NULL,
  expires_at         VARCHAR(50)           DEFAULT NULL,
  accepted_at        VARCHAR(50)           DEFAULT NULL,
  accepted_username  VARCHAR(100)          DEFAULT NULL,
  PRIMARY KEY (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS password_resets (
  token       VARCHAR(128) NOT NULL,
  username    VARCHAR(100)          DEFAULT '',
  email       VARCHAR(255)          DEFAULT '',
  status      VARCHAR(50)           DEFAULT 'pending',
  created_at  VARCHAR(50)           DEFAULT NULL,
  expires_at  VARCHAR(50)           DEFAULT NULL,
  used_at     VARCHAR(50)           DEFAULT NULL,
  PRIMARY KEY (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Postgres had two partial unique indexes here (see migration 002). MySQL has
-- none, so:
--   model_key unique where not null -> a plain UNIQUE (MySQL allows many NULLs)
--   unit_key unique where model_key is null -> UNIQUE on a generated column that
--     holds unit_key only for unit-only rows and NULL otherwise.
CREATE TABLE IF NOT EXISTS unit_models (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  unit           VARCHAR(100) NOT NULL,
  unit_key       VARCHAR(100) NOT NULL,
  model          VARCHAR(100)          DEFAULT NULL,
  model_key      VARCHAR(100)          DEFAULT NULL,
  created_by     VARCHAR(255) NOT NULL DEFAULT '',
  created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  unit_only_key  VARCHAR(100) AS (IF(model_key IS NULL, unit_key, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY unit_models_model_key_uniq (model_key),
  UNIQUE KEY unit_models_unit_only_uniq (unit_only_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS schedules (
  id                   BIGINT       NOT NULL AUTO_INCREMENT,
  technician_username  VARCHAR(100) NOT NULL,
  technician_name      VARCHAR(255) NOT NULL DEFAULT '',
  client_id            VARCHAR(191) NOT NULL,
  client_name          VARCHAR(255) NOT NULL DEFAULT '',
  location             VARCHAR(255) NOT NULL DEFAULT '',
  schedule_date        DATE         NOT NULL,
  schedule_time        TIME                  DEFAULT NULL,
  description          MEDIUMTEXT   NOT NULL DEFAULT (''),
  status               VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  created_by           VARCHAR(255) NOT NULL DEFAULT '',
  created_at           DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at           DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY schedules_technician_date_idx (technician_username, schedule_date),
  KEY schedules_date_idx (schedule_date),
  CONSTRAINT schedules_status_check CHECK (status IN ('scheduled', 'done', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  username    VARCHAR(100) NOT NULL,
  endpoint    VARCHAR(700) NOT NULL,
  p256dh      VARCHAR(255) NOT NULL,
  auth        VARCHAR(255) NOT NULL,
  user_agent  VARCHAR(500) NOT NULL DEFAULT '',
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY push_subscriptions_endpoint_key (endpoint),
  KEY push_subscriptions_username_idx (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Added after the move to MySQL (migration 007): one row per service-report
-- image; the file itself is on disk under UPLOAD_DIR.
CREATE TABLE IF NOT EXISTS update_photos (
  id             CHAR(36)     NOT NULL,
  client_id      VARCHAR(191) NOT NULL,
  machine_id     INT                   DEFAULT NULL,
  file_path      VARCHAR(255) NOT NULL,
  original_name  VARCHAR(255) NOT NULL DEFAULT '',
  mime           VARCHAR(50)  NOT NULL,
  size_bytes     INT          NOT NULL DEFAULT 0,
  uploaded_by    VARCHAR(100) NOT NULL,
  created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  attached_at    DATETIME(6)           DEFAULT NULL,
  PRIMARY KEY (id),
  KEY update_photos_machine_id_idx (machine_id),
  KEY update_photos_attached_at_idx (attached_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Unused by the app (empty Supabase starter table); kept so nothing is dropped.
CREATE TABLE IF NOT EXISTS profiles (
  id          CHAR(36)     NOT NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  email       VARCHAR(255)          DEFAULT NULL,
  full_name   VARCHAR(255)          DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
