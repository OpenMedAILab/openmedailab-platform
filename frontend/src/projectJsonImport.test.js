import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProjectJsonImport, qualityCheckProjectPayload, selectedProjectJsonFiles, sortProjectImportRows, summarizeProjectImportFiles } from "./projectJsonImport.js";

test("parseProjectJsonImport maps json array records to strict project payloads", () => {
  const text = JSON.stringify([
    {
      id: "T0001",
      theme: "眼底病",
      title: "糖网随访策略",
      title_en: "Follow-up strategy for DR",
      summary: "面向糖网随访策略的开放课题摘要",
      problem_statement: "如何减少漏诊",
      clinical_endpoint: "转诊准确率",
      existing_foundation: "已有随访数据",
      tags: ["眼底病", "随访"],
      target_venue: "npj Digital Medicine"
    },
    {
      theme: "眼底病",
      title: "DME 治疗预测",
      summary: "面向DME治疗预测的开放课题摘要",
      problem_statement: "预测疗效",
      clinical_endpoint: "视力改善",
      existing_foundation: "已有OCT数据",
      keywords: "DME，OCT, 疗效预测"
    }
  ]);

  const rows = parseProjectJsonImport(text, "imports/projects.json");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].payload.topic_id, 1);
  assert.equal(rows[0].payload.title_en, "Follow-up strategy for DR");
  assert.equal(rows[0].payload.summary, "面向糖网随访策略的开放课题摘要");
  assert.deepEqual(rows[0].payload.tags, ["眼底病", "随访"]);
  assert.equal(rows[0].payload.target_venue, "npj Digital Medicine");
  assert.equal(rows[0].errors.length, 0);
  assert.equal(rows[1].payload.topic_id, null);
  assert.deepEqual(rows[1].payload.tags, ["DME", "OCT", "疗效预测"]);
  assert.equal(rows[1].errors.length, 0);
});

test("parseProjectJsonImport rejects jsonl files", () => {
  assert.throws(
    () => parseProjectJsonImport(JSON.stringify({ title: "标题" }), "imports/projects.jsonl"),
    /仅支持 \.json 文件/
  );
});

test("parseProjectJsonImport supports arrays and projects wrapper in json files", () => {
  const arrayRows = parseProjectJsonImport(
    JSON.stringify([{ id: 3, theme: "主题", title: "标题", summary: "摘要", problem_statement: "问题", clinical_endpoint: "终点", existing_foundation: "基础" }]),
    "array.json"
  );
  const wrapperRows = parseProjectJsonImport(
    JSON.stringify({ projects: [{ id: 4, theme: "主题", title: "标题", summary: "摘要", problem_statement: "问题", clinical_endpoint: "终点", existing_foundation: "基础" }] }),
    "wrapper.json"
  );

  assert.equal(arrayRows[0].payload.topic_id, 3);
  assert.equal(wrapperRows[0].payload.topic_id, 4);
});

test("parseProjectJsonImport rejects legacy topic_id and unknown fields", () => {
  const rows = parseProjectJsonImport(
    JSON.stringify({ topic_id: "ROP-1", id: 5, theme: "主题", title: "标题", unknown: true }),
    "bad.json"
  );

  assert.match(rows[0].errors.join("；"), /请使用 id 字段/);
  assert.match(rows[0].errors.join("；"), /未知字段/);
});

test("qualityCheckProjectPayload requires core fields and enforces 250 characters", () => {
  const quality = qualityCheckProjectPayload({
    theme: "主题",
    title: "标题",
    summary: "",
    problem_statement: "问".repeat(251),
    clinical_endpoint: "",
    existing_foundation: "基础",
    target_venue: "会".repeat(256)
  });

  assert.match(quality.errors.join("；"), /科学问题不能超过250字/);
  assert.match(quality.errors.join("；"), /目标期刊\/会议不能超过255字/);
  assert.match(quality.errors.join("；"), /缺少摘要/);
});

test("summarizeProjectImportFiles counts only project json and matching pdf files", () => {
  const files = [
    { name: "001_topic.json", webkitRelativePath: "topics/001_topic.json" },
    { name: "001_topic.pdf", webkitRelativePath: "topics/001_topic.pdf" },
    { name: "002_topic.json", webkitRelativePath: "topics/002_topic.json" },
    { name: "orphan.pdf", webkitRelativePath: "topics/orphan.pdf" },
    { name: "notes.md", webkitRelativePath: "topics/notes.md" },
    { name: "image.png", webkitRelativePath: "topics/image.png" },
    { name: "metadata.json", webkitRelativePath: "topics/metadata.json" }
  ];

  const summary = summarizeProjectImportFiles(files);
  const jsonFiles = selectedProjectJsonFiles(files);

  assert.deepEqual(summary, {
    totalFileCount: 7,
    jsonFileCount: 3,
    matchedPdfCount: 1,
    ignoredFileCount: 3
  });
  assert.deepEqual(jsonFiles.map((file) => file.name), ["001_topic.json", "002_topic.json", "metadata.json"]);
});

test("sortProjectImportRows orders import preview by topic id", () => {
  const rows = [
    { payload: { topic_id: 100, title: "T0100" }, sourcePath: "topics/100.json" },
    { payload: { topic_id: 2, title: "T0002" }, sourcePath: "topics/002.json" },
    { payload: { topic_id: null, title: "未编号" }, sourcePath: "topics/no-id.json" },
    { payload: { topic_id: 1, title: "T0001" }, sourcePath: "topics/001.json" }
  ];

  assert.deepEqual(
    sortProjectImportRows(rows).map((row) => row.payload.title),
    ["T0001", "T0002", "T0100", "未编号"]
  );
});
