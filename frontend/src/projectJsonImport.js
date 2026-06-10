const ALLOWED_FIELDS = new Set([
  "id",
  "theme",
  "title",
  "title_en",
  "problem_statement",
  "clinical_endpoint",
  "existing_foundation"
]);

const REQUIRED_FIELDS = [
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

export function parseProjectJsonImport(text, sourcePath = "") {
  const source = String(sourcePath || "");
  const records = source.toLowerCase().endsWith(".jsonl") ? parseJsonl(text) : parseJson(text);
  return records.map((record, index) => normalizeRecord(record, `${source || "json"}#${index + 1}`));
}

export function qualityCheckProjectPayload(payload) {
  const errors = REQUIRED_FIELDS.filter(([key]) => isEmptyValue(payload[key])).map(([, label]) => `缺少${label}`);
  for (const [key, label] of SHORT_FIELDS) {
    if (!isEmptyValue(payload[key]) && String(payload[key]).trim().length > 250) {
      errors.push(`${label}不能超过250字`);
    }
  }
  return { errors, warnings: [] };
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
    problem_statement: normalizeString(record.problem_statement),
    clinical_endpoint: normalizeString(record.clinical_endpoint),
    existing_foundation: normalizeString(record.existing_foundation),
    stage: "draft",
    tags: [],
    is_public: false
  };
  if ("id" in record && !topicId) errors.push("id 必须是正整数");
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

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}
