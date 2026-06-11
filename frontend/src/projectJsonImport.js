const ALLOWED_FIELDS = new Set([
  "id",
  "theme",
  "title",
  "title_en",
  "summary",
  "problem_statement",
  "clinical_endpoint",
  "existing_foundation",
  "tags",
  "keywords",
  "target_venue"
]);

const REQUIRED_FIELDS = [
  ["title", "Title（中文）"],
  ["theme", "主题"],
  ["summary", "摘要"]
];

const SHORT_FIELDS = [
  ["problem_statement", "科学问题"],
  ["clinical_endpoint", "临床终点"],
  ["existing_foundation", "已有基础"]
];

const LIMITED_FIELDS = [
  ["target_venue", "目标期刊/会议", 255]
];

export function parseProjectJsonImport(text, sourcePath = "") {
  const source = String(sourcePath || "");
  if (source && !source.toLowerCase().endsWith(".json")) {
    throw new Error("仅支持 .json 文件");
  }
  const records = parseJson(text);
  return records.map((record, index) => normalizeRecord(record, `${source || "json"}#${index + 1}`));
}

export function qualityCheckProjectPayload(payload) {
  const errors = REQUIRED_FIELDS.filter(([key]) => isEmptyValue(payload[key])).map(([, label]) => `缺少${label}`);
  for (const [key, label] of SHORT_FIELDS) {
    if (!isEmptyValue(payload[key]) && String(payload[key]).trim().length > 250) {
      errors.push(`${label}不能超过250字`);
    }
  }
  for (const [key, label, limit] of LIMITED_FIELDS) {
    if (!isEmptyValue(payload[key]) && String(payload[key]).trim().length > limit) {
      errors.push(`${label}不能超过${limit}字`);
    }
  }
  return { errors, warnings: [] };
}

export function summarizeProjectImportFiles(files) {
  const allFiles = Array.from(files || []);
  const jsonFiles = allFiles.filter(isJsonFile);
  const pdfKeys = new Set(allFiles.filter(isPdfFile).map(fileStemKey));
  const matchedPdfKeys = new Set();
  for (const file of jsonFiles) {
    const key = fileStemKey(file);
    if (pdfKeys.has(key)) matchedPdfKeys.add(key);
  }
  return {
    totalFileCount: allFiles.length,
    jsonFileCount: jsonFiles.length,
    matchedPdfCount: matchedPdfKeys.size,
    ignoredFileCount: Math.max(0, allFiles.length - jsonFiles.length - matchedPdfKeys.size)
  };
}

export function selectedProjectJsonFiles(files) {
  return Array.from(files || []).filter(isJsonFile);
}

export function projectImportFileKey(file) {
  return fileStemKey(file);
}

export function sortProjectImportRows(rows) {
  return [...(rows || [])].sort((left, right) => {
    const leftTopic = normalizedRowTopicId(left);
    const rightTopic = normalizedRowTopicId(right);
    if (leftTopic !== rightTopic) return leftTopic - rightTopic;
    return rowSortLabel(left).localeCompare(rowSortLabel(right), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  });
}

function parseJson(text) {
  const parsed = JSON.parse(String(text || "").trim() || "[]");
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.projects)) return parsed.projects;
  return [parsed];
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
    tags: normalizeStringList(record.tags ?? record.keywords),
    target_venue: normalizeString(record.target_venue),
    stage: "draft",
    is_public: false
  };
  if ("id" in record && !topicId) errors.push("id 必须是 1-9999 的整数或 T0001 格式");
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
  const text = String(value).trim();
  const codeMatch = text.match(/^T(\d{4})$/i);
  const number = Number(codeMatch ? codeMatch[1] : text);
  return Number.isInteger(number) && number > 0 && number <= 9999 ? number : null;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeStringList(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.map(normalizeString).filter(Boolean);
  return String(value)
    .split(/[，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isJsonFile(file) {
  return fileName(file).toLowerCase().endsWith(".json");
}

function isPdfFile(file) {
  return fileName(file).toLowerCase().endsWith(".pdf");
}

function fileName(file) {
  return String(file?.webkitRelativePath || file?.name || "");
}

function fileStemKey(file) {
  return fileName(file).replace(/\.[^/.]+$/, "").toLowerCase();
}

function normalizedRowTopicId(row) {
  const value = row?.payload?.topic_id ?? row?.topic_id ?? row?.id;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : Number.MAX_SAFE_INTEGER;
}

function rowSortLabel(row) {
  return String(row?.sourcePath || row?.fileName || row?.payload?.title || row?.title || "");
}
