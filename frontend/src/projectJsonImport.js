const STAGE_LABEL_TO_VALUE = {
  草稿: "draft",
  开放招募: "open_recruiting",
  组队中: "team_building",
  进行中: "active",
  暂停: "paused",
  归档: "archived"
};

const ALLOWED_FIELDS = new Set([
  "id",
  "theme",
  "title",
  "title_en",
  "summary",
  "problem_statement",
  "clinical_endpoint",
  "existing_foundation",
  "research_goal",
  "technical_route",
  "data_requirements",
  "evaluation_metrics",
  "expected_outputs",
  "compliance_notes",
  "stage",
  "tags",
  "llm_score",
  "community_score",
  "composite_score",
  "recommended_journal",
  "needed_roles",
  "score_dimensions",
  "is_public"
]);

const REQUIRED_FIELDS = [
  ["topic_id", "课题ID"],
  ["title", "Title（中文）"],
  ["theme", "主题"],
  ["problem_statement", "科学问题"],
  ["clinical_endpoint", "临床终点"],
  ["existing_foundation", "已有基础"]
];

const SHORT_FIELDS = [
  ["problem_statement", "科学问题"],
  ["clinical_endpoint", "临床终点"],
  ["existing_foundation", "已有基础"]
];

const PUBLISH_WARNING_FIELDS = [
  ["summary", "摘要"],
  ["data_requirements", "数据需求"],
  ["evaluation_metrics", "评价指标"],
  ["expected_outputs", "预期成果"],
  ["compliance_notes", "合规说明"]
];

export function parseProjectJsonImport(text, sourcePath = "") {
  const source = String(sourcePath || "");
  const records = source.toLowerCase().endsWith(".jsonl") ? parseJsonl(text) : parseJson(text);
  return records.map((record, index) => normalizeRecord(record, `${source || "json"}#${index + 1}`));
}

export function qualityCheckProjectPayload(payload) {
  const errors = REQUIRED_FIELDS.filter(([key]) => isEmptyValue(payload[key])).map(([, label]) => `缺少${label}`);
  for (const [key, label] of SHORT_FIELDS) {
    if (!isEmptyValue(payload[key]) && String(payload[key]).trim().length > 50) {
      errors.push(`${label}不能超过50字`);
    }
  }
  const warnings = PUBLISH_WARNING_FIELDS.filter(([key]) => isEmptyValue(payload[key])).map(([, label]) => label);
  return { errors, warnings };
}

function parseJson(text) {
  const parsed = JSON.parse(String(text || "").trim() || "[]");
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.projects)) return parsed.projects;
  return [parsed];
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizeRecord(record, sourcePath) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return blockedRow(sourcePath, "每条记录必须是 JSON object");
  }
  if ("topic_id" in record) {
    errors.push("请使用 id 字段，不再使用 topic_id");
  }
  const unknownFields = Object.keys(record).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknownFields.length) {
    errors.push(`未知字段：${unknownFields.join("、")}`);
  }
  const topicId = normalizePositiveInteger(record.id);
  const payload = {
    topic_id: topicId,
    theme: normalizeString(record.theme),
    title: normalizeString(record.title),
    title_en: normalizeString(record.title_en),
    summary: normalizeString(record.summary),
    problem_statement: normalizeString(record.problem_statement),
    clinical_endpoint: normalizeString(record.clinical_endpoint),
    existing_foundation: normalizeString(record.existing_foundation),
    research_goal: normalizeString(record.research_goal),
    technical_route: normalizeString(record.technical_route),
    data_requirements: normalizeObject(record.data_requirements, "data_requirements", errors),
    evaluation_metrics: normalizeArray(record.evaluation_metrics, "evaluation_metrics", errors),
    expected_outputs: normalizeArray(record.expected_outputs, "expected_outputs", errors),
    compliance_notes: normalizeString(record.compliance_notes),
    stage: normalizeStage(record.stage),
    tags: normalizeArray(record.tags, "tags", errors),
    llm_score: optionalNumber(record.llm_score),
    community_score: optionalNumber(record.community_score),
    composite_score: optionalNumber(record.composite_score),
    recommended_journal: normalizeString(record.recommended_journal),
    needed_roles: normalizeArray(record.needed_roles, "needed_roles", errors),
    score_dimensions: normalizeObject(record.score_dimensions, "score_dimensions", errors),
    is_public: false
  };
  if (!topicId) errors.push("id 必须是正整数");
  const quality = qualityCheckProjectPayload(payload);
  return {
    templateVersion: "json-v1",
    payload,
    errors: [...errors, ...quality.errors],
    warnings: quality.warnings
  };
}

function blockedRow(sourcePath, message) {
  return {
    templateVersion: "json-v1",
    payload: { topic_id: "", theme: "", title: "" },
    errors: [message],
    warnings: [],
    sourcePath
  };
}

function normalizePositiveInteger(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeArray(value, field, errors) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  errors.push(`${field} 必须是数组`);
  return [];
}

function normalizeObject(value, field, errors) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  errors.push(`${field} 必须是对象`);
  return {};
}

function normalizeStage(stage) {
  const value = String(stage || "").trim();
  if (!value) return "draft";
  return STAGE_LABEL_TO_VALUE[value] || value;
}

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}
