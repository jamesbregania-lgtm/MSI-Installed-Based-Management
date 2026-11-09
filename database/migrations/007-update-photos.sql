-- Every machine update carries one image of the paper service report (a
-- CamScanner scan). The image itself lives on the server's disk under
-- UPLOAD_DIR; this table holds one small row per file.
--
-- A row is created the moment the technician picks an image (attached_at
-- NULL), and claimed by the update that saves it (attached_at set). Rows never
-- claimed within a day — an abandoned form — are deleted with their file.
-- The update entry in machines.updates keeps { id, name } of its image.
--
-- MySQL — run this BEFORE deploying the application change (hPanel >
-- Databases > phpMyAdmin > SQL). Until it is run, saving an update reports
-- that image uploads are not set up yet.

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
