const STAGE_LABEL_TO_VALUE = {
  草稿: "draft",
  开放招募: "open_recruiting",
  组队中: "team_building",
  进行中: "active",
  实验中: "active",
  写作中: "active",
  投稿中: "active",
  已发表: "archived",
  暂停: "paused",
  归档: "archived"
};

const REQUIRED_FIELDS = [
  ["topic_id", "课题ID"],
  ["title", "标题"],
  ["theme", "主题"]
];

const PUBLISH_WARNING_FIELDS = [
  ["summary", "摘要"],
  ["problem_statement", "科学问题"],
  ["research_goal", "研究目标"],
  ["data_requirements", "数据需求"],
  ["evaluation_metrics", "评价指标"],
  ["expected_outputs", "预期成果"],
  ["compliance_notes", "合规说明"]
];

export function parseProjectMarkdown(markdown, sourcePath = "") {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const sections = splitSections(text);
  const info = parseInfoSection(sections.get("基本信息") || "");
  const title = firstHeading(text);
  const templateVersion = info["模板版本"] || "v1";
  const payload = {
    topic_id: info["课题ID"] || "",
    theme: info["主题"] || "",
    project_no: optionalNumber(info["主题内编号"]),
    title,
    summary: sectionText(sections, "摘要"),
    problem_statement: sectionText(sections, "科学问题"),
    research_goal: sectionText(sections, "研究目标"),
    technical_route: sectionText(sections, "技术路线"),
    data_requirements: parseDataRequirements(sections.get("数据需求") || ""),
    evaluation_metrics: parseListSection(sections.get("评价指标") || ""),
    expected_outputs: parseListSection(sections.get("预期成果") || ""),
    compliance_notes: sectionText(sections, "合规说明"),
    body_markdown: text,
    stage: "draft",
    tags: parseInlineList(info["标签"]),
    llm_score: optionalNumber(info["初始评分"]),
    composite_score: optionalNumber(info["综合评分"]),
    recommended_journal: info["推荐期刊"] || "",
    needed_roles: parseInlineList(info["需要角色"]),
    source_md_path: sourcePath,
    documents: sourcePath ? [{ doc_type: "markdown", title: title || sourcePath, path: sourcePath }] : [],
    is_public: false
  };
  const quality = qualityCheckProjectPayload(payload);
  const errors = [...quality.errors];
  if (templateVersion !== "v1") {
    errors.unshift(`暂不支持模板版本 ${templateVersion}`);
  }
  return {
    templateVersion,
    payload,
    errors,
    warnings: quality.warnings
  };
}

export function qualityCheckProjectPayload(payload) {
  const errors = REQUIRED_FIELDS.filter(([key]) => isEmptyValue(payload[key])).map(([, label]) => `缺少${label}`);
  const warnings = PUBLISH_WARNING_FIELDS.filter(([key]) => isEmptyValue(payload[key])).map(([, label]) => label);
  return { errors, warnings };
}

function firstHeading(text) {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function splitSections(text) {
  const sections = new Map();
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    sections.set(match[1].trim(), text.slice(start, end).trim());
  });
  return sections;
}

function sectionText(sections, name) {
  return (sections.get(name) || "").trim();
}

function parseInfoSection(text) {
  const info = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^-\s*([^:：]+)\s*[：:]\s*(.*)$/);
    if (match) {
      info[match[1].trim()] = match[2].trim();
    }
  }
  return info;
}

function parseDataRequirements(text) {
  const labels = {
    数据类型: "data_type",
    最小样本量: "minimum_cases",
    数据来源: "data_source",
    隐私要求: "privacy"
  };
  const data = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^-\s*([^:：]+)\s*[：:]\s*(.*)$/);
    if (!match) continue;
    const key = labels[match[1].trim()] || match[1].trim();
    const value = match[2].trim();
    data[key] = key === "minimum_cases" ? optionalNumber(value) : value;
  }
  return Object.fromEntries(Object.entries(data).filter(([, value]) => !isEmptyValue(value)));
}

function parseListSection(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function parseInlineList(text) {
  return String(text || "")
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStage(stage) {
  const value = String(stage || "").trim();
  if (!value) return "draft";
  return STAGE_LABEL_TO_VALUE[value] || value;
}

function parsePublicFlag(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["是", "true", "1", "yes", "公开"].includes(text);
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
