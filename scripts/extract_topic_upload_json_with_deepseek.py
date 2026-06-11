#!/usr/bin/env python3
"""
Extract OpenMedAILab project-upload JSON from topic Markdown files with DeepSeek.

The generated project JSON intentionally contains only the fields accepted by the
current frontend JSON importer:

  id, theme, title, title_en, summary, problem_statement,
  clinical_endpoint, existing_foundation, tags, target_venue

PDF files are listed in a separate document manifest because the current project
JSON importer rejects unknown fields such as "documents".
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TOPIC_ROOT = ROOT.parent / "topics"
DEFAULT_UPLOAD_ROOT = ROOT.parent / "upload"
DEFAULT_OUTPUT = DEFAULT_UPLOAD_ROOT / "generated-openmedailab-projects.json"
DEFAULT_DOCUMENTS = DEFAULT_UPLOAD_ROOT / "generated-openmedailab-project-documents.json"
DEFAULT_REPORT = DEFAULT_UPLOAD_ROOT / "generated-openmedailab-project-extraction-report.json"

ALLOWED_PROJECT_FIELDS = [
    "id",
    "theme",
    "title",
    "title_en",
    "summary",
    "problem_statement",
    "clinical_endpoint",
    "existing_foundation",
    "tags",
    "target_venue",
]

SUMMARY_LIMIT = 260

SHORT_FIELD_LIMITS = {
    "problem_statement": 250,
    "clinical_endpoint": 250,
    "existing_foundation": 250,
    "target_venue": 255,
}

TOPIC_PATTERNS = [
    re.compile(r"^\d{3}_.+\.md$", re.IGNORECASE),
    re.compile(r"^T\d{3}_.+\.md$", re.IGNORECASE),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use DeepSeek to extract frontend-uploadable project JSON from topic Markdown files."
    )
    parser.add_argument(
        "--source",
        action="append",
        type=Path,
        help="Topic directory. Can be repeated. Defaults to AntiVegf_200topics and FFA_topics when present.",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output project JSON path.")
    parser.add_argument(
        "--documents-manifest",
        type=Path,
        default=DEFAULT_DOCUMENTS,
        help="Output PDF document manifest path. This file is for manual document upload tracking, not frontend JSON import.",
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="Output extraction report path.")
    parser.add_argument("--start-id", type=int, default=1, help="First generated topic id. Default: 1.")
    parser.add_argument(
        "--theme",
        action="append",
        default=[],
        help="Theme override as directory_name=ThemeName. Example: AntiVegf_200topics=AntiVEGF",
    )
    parser.add_argument("--model", default="deepseek-chat", help="DeepSeek model name.")
    parser.add_argument(
        "--backend",
        choices=["api", "deepseek-cli"],
        default="api",
        help="LLM backend. Use deepseek-cli to call the locally configured `deepseek exec` command.",
    )
    parser.add_argument("--api-base", default="https://api.deepseek.com/v1", help="DeepSeek OpenAI-compatible API base.")
    parser.add_argument("--api-key-env", default="DEEPSEEK_API_KEY", help="Environment variable containing API key.")
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--max-chars", type=int, default=24000, help="Max Markdown characters sent to DeepSeek per topic.")
    parser.add_argument("--offset", type=int, default=0, help="Skip the first N topic files before extraction.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files, useful for a smoke test.")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help="Number of parallel DeepSeek calls. Keep this modest to avoid rate limits.",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=10,
        help="Write current output files after every N completed topics. Use 0 to disable.",
    )
    parser.add_argument(
        "--include-non-topic-md",
        action="store_true",
        help="Include README/audit/tracker md files. Default only includes numbered topic files.",
    )
    parser.add_argument(
        "--fallback-only",
        action="store_true",
        help="Do not call DeepSeek; use local rule-based extraction only.",
    )
    parser.add_argument(
        "--fallback-on-error",
        action="store_true",
        help="Use local rule-based extraction when a DeepSeek call fails.",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Do not reuse cached DeepSeek extraction responses.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=ROOT / ".cache" / "deepseek-topic-extraction",
        help="Cache directory for per-file DeepSeek responses.",
    )
    parser.add_argument(
        "--array-output",
        action="store_true",
        help="Write a raw JSON array instead of {'projects': [...]} wrapper.",
    )
    return parser.parse_args()


def default_sources() -> list[Path]:
    candidates = [
        DEFAULT_TOPIC_ROOT / "AntiVegf_200topics",
        DEFAULT_TOPIC_ROOT / "FFA_topics",
    ]
    return [path for path in candidates if path.exists()]


def parse_theme_overrides(values: list[str]) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"--theme must use directory_name=ThemeName, got: {value}")
        key, label = value.split("=", 1)
        key = key.strip()
        label = label.strip()
        if not key or not label:
            raise SystemExit(f"--theme must use directory_name=ThemeName, got: {value}")
        overrides[key] = label
    return overrides


def infer_theme(directory: Path, overrides: dict[str, str]) -> str:
    if directory.name in overrides:
        return overrides[directory.name]
    lowered = directory.name.lower()
    if "antivegf" in lowered or "anti_vegf" in lowered or "anti-vegf" in lowered:
        return "AntiVEGF"
    if "ffa" in lowered:
        return "FFA"
    return directory.name


def is_topic_markdown(path: Path, include_non_topic: bool) -> bool:
    if include_non_topic:
        return path.suffix.lower() == ".md"
    return any(pattern.match(path.name) for pattern in TOPIC_PATTERNS)


def collect_topics(sources: list[Path], include_non_topic: bool, theme_overrides: dict[str, str]) -> list[dict[str, Any]]:
    for source in sources:
        if not source.exists():
            raise SystemExit(f"Source directory does not exist: {source}")
        if not source.is_dir():
            raise SystemExit(f"Source is not a directory: {source}")
    items: list[dict[str, Any]] = []
    for source in sources:
        theme = infer_theme(source, theme_overrides)
        for md_path in sorted(source.glob("*.md")):
            if not is_topic_markdown(md_path, include_non_topic):
                continue
            pdf_path = md_path.with_suffix(".pdf")
            items.append({"md_path": md_path, "pdf_path": pdf_path, "theme": theme})
    return items


def read_markdown(path: Path, max_chars: int) -> str:
    text = path.read_text(encoding="utf-8")
    if max_chars > 0 and len(text) > max_chars:
        return text[:max_chars] + "\n\n[TRUNCATED_FOR_EXTRACTION]\n"
    return text


def topic_code(number: int) -> str:
    if number < 1 or number > 9999:
        raise ValueError("topic id must be between 1 and 9999")
    return f"T{number:04d}"


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def truncate(value: Any, limit: int) -> str:
    text = normalize_text(value)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip("，。；;,. ") + "…"


def strip_topic_prefix(title: str) -> str:
    title = normalize_text(title)
    title = re.sub(r"^#*\s*", "", title)
    title = re.sub(r"^(T?\d{3,4})[：:_\-\s]+", "", title, flags=re.IGNORECASE)
    return title.strip()


def first_heading(text: str, fallback: str) -> str:
    for line in text.splitlines():
        match = re.match(r"^\s*#\s+(.+?)\s*$", line)
        if match:
            return strip_topic_prefix(match.group(1))
    return strip_topic_prefix(Path(fallback).stem)


def extract_after_label(text: str, labels: list[str], max_lines: int = 4) -> str:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip().lstrip("-").strip()
        for label in labels:
            if stripped.startswith(label):
                value = stripped[len(label) :].lstrip("：: ").strip()
                if value:
                    return value
                collected: list[str] = []
                for next_line in lines[index + 1 : index + 21]:
                    next_value = next_line.strip().lstrip("-").strip()
                    if not next_value:
                        continue
                    if next_value.startswith("#"):
                        break
                    if is_probable_metadata_label(next_value):
                        break
                    collected.append(next_value)
                    if len(collected) >= max_lines:
                        break
                return " ".join(collected)
    return ""


def is_probable_metadata_label(value: str) -> bool:
    return bool(re.fullmatch(r"[^：:]{1,32}[：:]", value.strip()))


def extract_section(text: str, keywords: list[str], max_chars: int = 500) -> str:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"^\s*#{2,4}\s+", line) and any(keyword in line for keyword in keywords):
            collected: list[str] = []
            for next_line in lines[index + 1 :]:
                if re.match(r"^\s*#{2,4}\s+", next_line) and collected:
                    break
                stripped = next_line.strip()
                if not stripped or stripped.startswith("```"):
                    continue
                collected.append(stripped.lstrip("-").strip())
                if len(" ".join(collected)) >= max_chars:
                    break
            return " ".join(collected)
    return ""


def fallback_extract(md_path: Path, markdown_text: str) -> dict[str, Any]:
    title = extract_after_label(markdown_text, ["中文题名", "中文题目"], max_lines=1) or first_heading(markdown_text, md_path.name)
    title_en = extract_after_label(markdown_text, ["英文题目", "可选英文题名", "英文题名"], max_lines=1)
    summary = (
        extract_section(markdown_text, ["设计结论"], 600)
        or extract_section(markdown_text, ["课题主题", "题名"], 500)
        or first_non_heading_paragraph(markdown_text)
    )
    problem = (
        extract_section(markdown_text, ["临床问题", "科学或 AI 问题", "AI 问题"], 500)
        or extract_after_label(markdown_text, ["研究问题"])
    )
    endpoint = (
        extract_section(markdown_text, ["金标准", "终点", "指标"], 500)
        or extract_after_label(markdown_text, ["主要终点", "主指标"])
    )
    foundation = (
        extract_section(markdown_text, ["数据支撑", "数据和资源支持", "数据资源"], 500)
        or extract_after_label(markdown_text, ["主要数据"])
    )
    target_venue = extract_after_label(markdown_text, ["投稿定位", "目标期刊", "目标会议", "目标 venue", "venue"], max_lines=2)
    tags = fallback_tags(md_path, markdown_text)
    return {
        "title": truncate(strip_topic_prefix(title), 255),
        "title_en": truncate(title_en, 255),
        "summary": truncate(summary, SUMMARY_LIMIT),
        "problem_statement": truncate(problem, 250),
        "clinical_endpoint": truncate(endpoint, 250),
        "existing_foundation": truncate(foundation, 250),
        "tags": tags,
        "target_venue": truncate(target_venue, 255),
    }


def first_non_heading_paragraph(text: str) -> str:
    collected: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("```"):
            continue
        collected.append(stripped.lstrip("-").strip())
        if len(" ".join(collected)) >= 420:
            break
    return " ".join(collected)


def fallback_tags(md_path: Path, text: str) -> list[str]:
    candidates: list[str] = []
    name = md_path.stem
    lowered = f"{name}\n{text[:5000]}".lower()
    if "antivegf" in lowered or "anti vegf" in lowered or "抗 vegf" in lowered or "抗vegf" in lowered:
        candidates.append("AntiVEGF")
    if "ffa" in lowered:
        candidates.append("FFA")
    keyword_map = [
        ("rag", "RAG"),
        ("graphrag", "GraphRAG"),
        ("多模态", "多模态"),
        ("纵向", "纵向随访"),
        ("真实世界", "真实世界研究"),
        ("因果", "因果推断"),
        ("安全", "安全评估"),
        ("鲁棒", "鲁棒性"),
        ("不确定性", "不确定性"),
        ("可解释", "可解释性"),
        ("弱监督", "弱监督"),
        ("自监督", "自监督"),
        ("半监督", "半监督"),
        ("检索", "检索"),
        ("证据链", "证据链"),
        ("工作流", "临床工作流"),
        ("benchmark", "Benchmark"),
        ("基准", "Benchmark"),
    ]
    for needle, label in keyword_map:
        if needle in lowered and label not in candidates:
            candidates.append(label)
    return candidates[:8]


def build_prompt(md_path: Path, theme: str, markdown_text: str) -> list[dict[str, str]]:
    system = (
        "You extract structured metadata for OpenMedAILab project uploads. "
        "Return one JSON object only. Do not wrap it in Markdown. "
        "Use Chinese for Chinese fields. Do not invent unsupported facts."
    )
    user = f"""
请从下面的课题 Markdown 中提取用于平台首页展示和 JSON 导入的字段。

输出必须是一个 JSON object，且只能包含这些 key：
- title: 中文课题标题，不要包含编号
- title_en: 英文标题；如果原文没有，留空字符串
- summary: 首页摘要，120-220 个中文字，说明临床/科研问题、核心方法和预期价值；不要展开实验细节
- problem_statement: 科学问题或临床问题，250 字以内
- clinical_endpoint: 临床终点、主要指标或验证终点，250 字以内
- existing_foundation: 已有基础、数据资源或可执行基础，250 字以内
- tags: 3-8 个关键词数组，优先使用医学方向、数据模态、方法类型、评价重点，例如 ["AntiVEGF","RAG","多模态","随访复核"]
- target_venue: 目标期刊/会议；如果原文没有，留空字符串

不要输出 id、theme、documents、stage、is_public、team_requirements、project_progress。
如果某项没有明确原文，请根据全文做忠实压缩，不要编造数据量。

文件名：{md_path.name}
主题：{theme}

Markdown:
---
{markdown_text}
---
""".strip()
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def cache_key(md_path: Path, markdown_text: str, model: str, backend: str) -> str:
    payload = f"json-v2-tags-target-venue\n{backend}\n{md_path.resolve()}\n{model}\n{markdown_text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def call_deepseek(args: argparse.Namespace, messages: list[dict[str, str]]) -> dict[str, Any]:
    if args.backend == "deepseek-cli":
        return call_deepseek_cli(args, messages)

    api_key = os.getenv(args.api_key_env, "").strip()
    if not api_key:
        raise RuntimeError(f"Missing API key environment variable: {args.api_key_env}")
    url = args.api_base.rstrip("/") + "/chat/completions"
    payload = {
        "model": args.model,
        "messages": messages,
        "temperature": args.temperature,
        "response_format": {"type": "json_object"},
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(1, args.retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=args.timeout) as response:
                body = response.read().decode("utf-8")
            parsed = json.loads(body)
            content = parsed["choices"][0]["message"]["content"]
            return parse_json_object(content)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, KeyError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < args.retries:
                time.sleep(min(2**attempt, 10))
    raise RuntimeError(f"DeepSeek request failed: {last_error}")


def call_deepseek_cli(args: argparse.Namespace, messages: list[dict[str, str]]) -> dict[str, Any]:
    prompt = "\n\n".join(f"{message['role'].upper()}:\n{message['content']}" for message in messages)
    command = ["deepseek", "--model", args.model, "exec", prompt]
    last_error: Exception | None = None
    for attempt in range(1, args.retries + 1):
        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=args.timeout)
            if result.returncode != 0:
                error = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
                raise RuntimeError(error)
            return parse_json_object(result.stdout)
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as exc:
            last_error = exc
            if attempt < args.retries:
                time.sleep(min(2**attempt, 10))
    raise RuntimeError(f"deepseek exec failed: {last_error}")


def parse_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fence:
        text = fence.group(1)
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("DeepSeek response is not a JSON object")
    return parsed


def normalize_extraction(raw: dict[str, Any], fallback: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    result = {
        "title": truncate(raw.get("title") or fallback.get("title"), 255),
        "title_en": truncate(raw.get("title_en") or fallback.get("title_en"), 255),
        "summary": truncate(raw.get("summary") or fallback.get("summary"), SUMMARY_LIMIT),
        "problem_statement": truncate(raw.get("problem_statement") or fallback.get("problem_statement"), 250),
        "clinical_endpoint": truncate(raw.get("clinical_endpoint") or fallback.get("clinical_endpoint"), 250),
        "existing_foundation": truncate(raw.get("existing_foundation") or fallback.get("existing_foundation"), 250),
        "tags": normalize_tags(raw.get("tags") or raw.get("keywords") or fallback.get("tags")),
        "target_venue": truncate(raw.get("target_venue") or fallback.get("target_venue"), 255),
    }
    unknown = sorted(set(raw) - set(result) - {"keywords"})
    if unknown:
        warnings.append(f"ignored_unknown_fields={','.join(unknown)}")
    if not result["title"]:
        warnings.append("missing_title")
    if not result["summary"]:
        warnings.append("missing_summary")
    for key, limit in SHORT_FIELD_LIMITS.items():
        if len(result[key]) > limit:
            warnings.append(f"{key}_truncated_to_{limit}")
            result[key] = truncate(result[key], limit)
    return result, warnings


def normalize_tags(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        raw_items = re.split(r"[，,;；\n]", value)
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = [value]
    tags: list[str] = []
    for item in raw_items:
        tag = normalize_text(item)
        if not tag or tag in tags:
            continue
        tags.append(truncate(tag, 40))
        if len(tags) >= 8:
            break
    return tags


def load_or_extract(args: argparse.Namespace, md_path: Path, theme: str, markdown_text: str) -> tuple[dict[str, Any], list[str]]:
    fallback = fallback_extract(md_path, markdown_text)
    warnings: list[str] = []
    if args.fallback_only:
        return normalize_extraction(fallback, fallback)

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = args.cache_dir / f"{cache_key(md_path, markdown_text, args.model, args.backend)}.json"
    if cache_path.exists() and not args.no_cache:
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        extracted, raw_warnings = normalize_extraction(raw, fallback)
        return extracted, ["cache_hit", *raw_warnings]

    try:
        raw = call_deepseek(args, build_prompt(md_path, theme, markdown_text))
        cache_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return normalize_extraction(raw, fallback)
    except Exception as exc:
        if not args.fallback_on_error:
            raise
        extracted, raw_warnings = normalize_extraction(fallback, fallback)
        warnings.extend([f"deepseek_failed={exc}", "used_fallback", *raw_warnings])
        return extracted, warnings


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def process_topic(args: argparse.Namespace, sequence_index: int, item: dict[str, Any]) -> dict[str, Any]:
    md_path: Path = item["md_path"]
    pdf_path: Path = item["pdf_path"]
    theme: str = item["theme"]
    current_id = args.start_id + sequence_index
    code = topic_code(current_id)
    markdown_text = read_markdown(md_path, args.max_chars)
    try:
        extracted, warnings = load_or_extract(args, md_path, theme, markdown_text)
        project = {
            "id": code,
            "theme": theme,
            **{key: extracted.get(key, "") for key in ALLOWED_PROJECT_FIELDS if key not in {"id", "theme"}},
        }
        document = {
            "id": code,
            "theme": theme,
            "title": project["title"],
            "source_markdown": str(md_path),
            "pdf_path": str(pdf_path),
            "pdf_exists": pdf_path.exists(),
            "doc_type": "pdf",
            "document_title": "项目详细说明",
            "description": "完整课题方案 PDF",
        }
        report_item = {
            "id": code,
            "theme": theme,
            "source_markdown": str(md_path),
            "pdf_path": str(pdf_path),
            "pdf_exists": pdf_path.exists(),
            "warnings": warnings,
        }
        return {
            "index": sequence_index,
            "project": project,
            "document": document,
            "report_item": report_item,
            "error": "",
            "line": f"{code} {theme} {md_path.name}",
        }
    except Exception as exc:
        message = f"{md_path}: {exc}"
        report_item = {
            "id": code,
            "theme": theme,
            "source_markdown": str(md_path),
            "pdf_path": str(pdf_path),
            "pdf_exists": pdf_path.exists(),
            "error": str(exc),
        }
        return {
            "index": sequence_index,
            "project": None,
            "document": None,
            "report_item": report_item,
            "error": message,
            "line": f"FAILED {message}",
        }


def ordered_payloads(results: list[dict[str, Any] | None]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    completed = [result for result in results if result is not None]
    completed.sort(key=lambda result: result["index"])
    projects = [result["project"] for result in completed if result["project"] is not None]
    documents = [result["document"] for result in completed if result["document"] is not None]
    report = [result["report_item"] for result in completed]
    errors = [result["error"] for result in completed if result["error"]]
    return projects, documents, report, errors


def write_outputs(args: argparse.Namespace, results: list[dict[str, Any] | None], total: int) -> tuple[int, int]:
    projects, documents, report, errors = ordered_payloads(results)
    payload: Any = projects if args.array_output else {"projects": projects}
    write_json(args.output, payload)
    write_json(args.documents_manifest, documents)
    write_json(
        args.report,
        {
            "total": total,
            "completed": len(report),
            "ok": len(projects),
            "failed": len(errors),
            "errors": errors,
            "items": report,
        },
    )
    return len(projects), len(errors)


def main() -> int:
    args = parse_args()
    if args.offset < 0:
        print("--offset must be >= 0", file=sys.stderr)
        return 2
    if args.concurrency < 1:
        print("--concurrency must be >= 1", file=sys.stderr)
        return 2
    if args.checkpoint_every < 0:
        print("--checkpoint-every must be >= 0", file=sys.stderr)
        return 2
    sources = args.source or default_sources()
    if not sources:
        print("No source directories found. Pass --source.", file=sys.stderr)
        return 2
    theme_overrides = parse_theme_overrides(args.theme)
    topics = collect_topics(sources, args.include_non_topic_md, theme_overrides)
    if args.offset:
        topics = topics[args.offset :]
        args.start_id += args.offset
    if args.limit:
        topics = topics[: args.limit]
    if not topics:
        print("No Markdown topic files found.", file=sys.stderr)
        return 2

    results: list[dict[str, Any] | None] = [None] * len(topics)
    completed_count = 0

    if args.concurrency == 1:
        for index, item in enumerate(topics):
            result = process_topic(args, index, item)
            results[index] = result
            completed_count += 1
            print(f"[{completed_count}/{len(topics)}] {result['line']}", file=sys.stderr if result["error"] else sys.stdout)
            if args.checkpoint_every and completed_count % args.checkpoint_every == 0:
                ok_count, failed_count = write_outputs(args, results, len(topics))
                print(f"checkpoint ok={ok_count} failed={failed_count}", file=sys.stderr)
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            future_map = {
                executor.submit(process_topic, args, index, item): index
                for index, item in enumerate(topics)
            }
            for future in as_completed(future_map):
                result = future.result()
                results[result["index"]] = result
                completed_count += 1
                print(f"[{completed_count}/{len(topics)}] {result['line']}", file=sys.stderr if result["error"] else sys.stdout)
                if args.checkpoint_every and completed_count % args.checkpoint_every == 0:
                    ok_count, failed_count = write_outputs(args, results, len(topics))
                    print(f"checkpoint ok={ok_count} failed={failed_count}", file=sys.stderr)

    ok_count, failed_count = write_outputs(args, results, len(topics))

    print(f"\nProject JSON: {args.output}")
    print(f"Document manifest: {args.documents_manifest}")
    print(f"Extraction report: {args.report}")
    print(f"ok={ok_count} failed={failed_count}")
    return 1 if failed_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
