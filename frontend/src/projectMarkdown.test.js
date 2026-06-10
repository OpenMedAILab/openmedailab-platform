import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProjectMarkdown, qualityCheckProjectPayload } from "./projectMarkdown.js";

test("parseProjectMarkdown maps v1 template sections to project payload", () => {
  const markdown = `# 浏览器验收数据字典

## 基本信息
- 模板版本：v1
- 课题ID：QA-001
- 主题：AntiVEGF
- 主题内编号：12
- 阶段：开放招募
- 是否公开：否
- 标签：RAG，眼科
- 需要角色：医生，学生
- 推荐期刊：JMIR
- 初始评分：8.4
- 综合评分：8.6

## 摘要
用于本地浏览器验收的主题文件域记录。

## 科学问题
缺少统一的数据字典。

## 研究目标
固定课题模板。

## 技术路线
解析 Markdown 后写入数据库。

## 数据需求
- 数据类型：OCT
- 最小样本量：30
- 数据来源：公开样例
- 隐私要求：脱敏

## 评价指标
- 完整度
- 可复核性

## 预期成果
- 数据字典
- 验收报告

## 合规说明
不上传可识别患者数据。
`;

  const result = parseProjectMarkdown(markdown, "imports/QA-001.md");

  assert.equal(result.templateVersion, "v1");
  assert.deepEqual(result.errors, []);
  assert.equal(result.payload.topic_id, "QA-001");
  assert.equal(result.payload.title, "浏览器验收数据字典");
  assert.equal(result.payload.theme, "AntiVEGF");
  assert.equal(result.payload.project_no, 12);
  assert.equal(result.payload.stage, "draft");
  assert.equal(result.payload.is_public, false);
  assert.deepEqual(result.payload.tags, ["RAG", "眼科"]);
  assert.deepEqual(result.payload.needed_roles, ["医生", "学生"]);
  assert.equal(result.payload.data_requirements.minimum_cases, 30);
  assert.deepEqual(result.payload.evaluation_metrics, ["完整度", "可复核性"]);
  assert.deepEqual(result.payload.expected_outputs, ["数据字典", "验收报告"]);
  assert.equal(result.payload.source_md_path, "imports/QA-001.md");
  assert.equal(result.payload.documents[0].doc_type, "markdown");
});

test("parseProjectMarkdown always prepares imported projects as non-public drafts", () => {
  const result = parseProjectMarkdown(`# 公开字段不应直接发布

## 基本信息
- 模板版本：v1
- 课题ID：QA-003
- 主题：AntiVEGF
- 阶段：已发表
- 是否公开：是
`);

  assert.equal(result.payload.stage, "draft");
  assert.equal(result.payload.is_public, false);
});

test("parseProjectMarkdown blocks unknown versions and reports missing required fields", () => {
  const result = parseProjectMarkdown(`# 无编号

## 基本信息
- 模板版本：v9
- 课题ID：
- 主题：
`);

  assert.equal(result.templateVersion, "v9");
  assert.deepEqual(result.errors, ["暂不支持模板版本 v9", "缺少课题ID", "缺少主题"]);
});

test("qualityCheckProjectPayload separates hard errors from publish warnings", () => {
  const quality = qualityCheckProjectPayload({
    topic_id: "QA-002",
    title: "待补充课题",
    theme: "AntiVEGF",
    summary: "",
    problem_statement: "",
    research_goal: "",
    data_requirements: {},
    evaluation_metrics: [],
    expected_outputs: [],
    compliance_notes: ""
  });

  assert.deepEqual(quality.errors, []);
  assert.deepEqual(quality.warnings, ["摘要", "科学问题", "研究目标", "数据需求", "评价指标", "预期成果", "合规说明"]);
});
