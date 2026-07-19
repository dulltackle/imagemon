/**
 * 冻结自 v0.11.0（ef4225da7ae6021cb1cbf0ad1fc37cf6a36149ff）的发布版
 * schema v8。未来升级 schema 时不得跟随当前建表实现同步改写此历史快照。
 */

export const SCHEMA_V8_FIXTURE_HISTORY_ID = "fixture-history-completed";
export const SCHEMA_V8_FIXTURE_LINKED_RESULT_ID = "fixture-result-linked";
export const SCHEMA_V8_FIXTURE_UNLINKED_RESULT_ID = "fixture-result-unlinked";

export const SCHEMA_V8_RELEASE_FIXTURE_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE model_configurations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('image', 'text')),
    base_url TEXT NOT NULL,
    model_name TEXT NOT NULL,
    has_credential INTEGER NOT NULL CHECK (has_credential IN (0, 1)),
    is_ready INTEGER NOT NULL CHECK (is_ready IN (0, 1)),
    last_test_succeeded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE app_settings (
    id TEXT PRIMARY KEY CHECK (id = 'app'),
    default_image_model_configuration_id TEXT,
    default_text_model_configuration_id TEXT,
    first_run_setup_completed_at TEXT,
    default_image_size TEXT NOT NULL DEFAULT '1024x1024',
    default_image_quality TEXT NOT NULL DEFAULT 'auto',
    default_image_format TEXT NOT NULL DEFAULT 'png',
    default_image_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (default_image_model_configuration_id)
      REFERENCES model_configurations(id) ON DELETE SET NULL,
    FOREIGN KEY (default_text_model_configuration_id)
      REFERENCES model_configurations(id) ON DELETE SET NULL
  );

  CREATE TABLE image_task_histories (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL CHECK (task_type IN ('generate', 'edit')),
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'unknown')),
    snapshot_json TEXT NOT NULL,
    error_summary_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE image_results (
    id TEXT PRIMARY KEY,
    task_history_id TEXT,
    file_path TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('png')),
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_history_id)
      REFERENCES image_task_histories(id) ON DELETE SET NULL
  );

  CREATE INDEX image_task_histories_created_at_idx
    ON image_task_histories(created_at DESC);

  CREATE INDEX image_results_created_at_idx
    ON image_results(created_at DESC);

  CREATE INDEX image_results_task_history_id_idx
    ON image_results(task_history_id);

  CREATE TABLE personal_promptdex_entries (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    version_json TEXT,
    inputs_json TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE template_refinement_drafts (
    id TEXT PRIMARY KEY CHECK (id = 'template_refinement'),
    status TEXT NOT NULL CHECK (status IN ('editing_input', 'generating', 'ready_for_review', 'failed')),
    external_prompt TEXT NOT NULL,
    planned_use TEXT NOT NULL,
    proposal_json TEXT,
    error_summary_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE business_call_attentions (
    subject_type TEXT NOT NULL CHECK (subject_type IN ('image_task', 'template_refinement')),
    subject_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('succeeded', 'failed', 'uncertain')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (subject_type, subject_id)
  );

  INSERT INTO schema_migrations (version, applied_at)
  VALUES (8, '2026-07-13T00:00:00.000Z');

  INSERT INTO app_settings (
    id,
    created_at,
    updated_at
  )
  VALUES (
    'app',
    '2026-07-13T00:00:00.000Z',
    '2026-07-13T00:00:00.000Z'
  );

  INSERT INTO image_task_histories (
    id,
    task_type,
    status,
    snapshot_json,
    error_summary_json,
    created_at,
    updated_at,
    completed_at
  )
  VALUES (
    '${SCHEMA_V8_FIXTURE_HISTORY_ID}',
    'generate',
    'completed',
    '{"source":"manual","prompt":"v8 fixture","imageSpec":{"size":"1024x1024","quality":"auto","format":"png","n":1},"modelConfiguration":{"type":"image","baseUrl":"https://api.openai.com/v1","modelName":"gpt-image-2"}}',
    NULL,
    '2026-07-13T00:01:00.000Z',
    '2026-07-13T00:02:00.000Z',
    '2026-07-13T00:02:00.000Z'
  );

  INSERT INTO image_results (
    id,
    task_history_id,
    file_path,
    format,
    width,
    height,
    created_at
  )
  VALUES
    (
      '${SCHEMA_V8_FIXTURE_LINKED_RESULT_ID}',
      '${SCHEMA_V8_FIXTURE_HISTORY_ID}',
      'image-results/fixture-result-linked.png',
      'png',
      1024,
      1536,
      '2026-07-13T00:02:00.000Z'
    ),
    (
      '${SCHEMA_V8_FIXTURE_UNLINKED_RESULT_ID}',
      NULL,
      'image-results/fixture-result-unlinked.png',
      'png',
      NULL,
      NULL,
      '2026-07-13T00:03:00.000Z'
    );
`;
