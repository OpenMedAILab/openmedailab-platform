import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProjectJsonImport, qualityCheckProjectPayload } from "./projectJsonImport.js";

test("parseProjectJsonImport maps jsonl records to strict project payloads", () => {
  const text = [
    JSON.stringify({
      id: 1,
      theme: "眼底病",
      title: "糖网随访策略",
      title_en: "Follow-up strategy for DR",
      problem_statement: "如何减少漏诊",
      clinical_endpoint: "转诊准确率",
      existing_foundation: "已有随访数据",
      tags: ["DR"],
      needed_roles: ["医生"]
    }),
    JSON.stringify({
      id: 2,
      theme: "眼底病",
      title: "DME 治疗预测",
      problem_statement: "预测疗效",
      clinical_endpoint: "视力改善",
      existing_foundation: "已有OCT数据"
    })
  ].join("\n");

  const rows = parseProjectJsonImport(text, "imports/projects.jsonl");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].payload.topic_id, 1);
  assert.equal(rows[0].payload.title_en, "Follow-up strategy for DR");
  assert.deepEqual(rows[0].payload.tags, ["DR"]);
  assert.equal(rows[0].errors.length, 0);
  assert.equal(rows[1].payload.topic_id, 2);
});

test("parseProjectJsonImport supports arrays and projects wrapper in json files", () => {
  const arrayRows = parseProjectJsonImport(
    JSON.stringify([{ id: 3, theme: "主题", title: "标题", problem_statement: "问题", clinical_endpoint: "终点", existing_foundation: "基础" }]),
    "array.json"
  );
  const wrapperRows = parseProjectJsonImport(
    JSON.stringify({ projects: [{ id: 4, theme: "主题", title: "标题", problem_statement: "问题", clinical_endpoint: "终点", existing_foundation: "基础" }] }),
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

test("qualityCheckProjectPayload requires core short fields and enforces 50 characters", () => {
  const quality = qualityCheckProjectPayload({
    topic_id: 6,
    theme: "主题",
    title: "标题",
    problem_statement: "这是一段超过五十个字的科学问题描述，用来确认前端会阻止过长核心字段进入数据库保存流程。" + "补充更多文字确保超过限制。",
    clinical_endpoint: "",
    existing_foundation: "基础"
  });

  assert.match(quality.errors.join("；"), /科学问题不能超过50字/);
  assert.match(quality.errors.join("；"), /缺少临床终点/);
});
