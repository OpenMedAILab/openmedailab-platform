PROJECT_FIELD_CONTRACT = [
    {"name": "id", "label": "课题编号（选填，可填 T0001，留空自动生成）", "type": "string", "required": False, "source": "project.topic_id"},
    {"name": "theme", "label": "主题", "type": "string", "required": True, "source": "theme.name 或 theme.slug"},
    {"name": "title", "label": "Title（中文）", "type": "string", "required": True, "source": "project.title"},
    {"name": "title_en", "label": "Title（英文，选填）", "type": "string", "required": False, "source": "project.title_en"},
    {"name": "summary", "label": "摘要", "type": "text", "required": True, "source": "project.summary"},
    {"name": "problem_statement", "label": "科学问题（选填，250字以内）", "type": "text", "required": False, "source": "project.problem_statement"},
    {"name": "clinical_endpoint", "label": "临床终点（选填，250字以内）", "type": "string", "required": False, "source": "project.clinical_endpoint"},
    {"name": "existing_foundation", "label": "已有基础（选填，250字以内）", "type": "string", "required": False, "source": "project.existing_foundation"},
    {"name": "tags", "label": "标签/关键词（选填，数组或逗号分隔字符串）", "type": "array|string", "required": False, "source": "project.tags"},
    {"name": "target_venue", "label": "目标期刊/会议（选填，255字以内）", "type": "string", "required": False, "source": "project.target_venue"},
    {"name": "stage", "label": "阶段", "type": "enum", "required": False, "source": "ProjectStage"},
    {"name": "is_public", "label": "是否公开", "type": "boolean", "required": False, "source": "project.is_public"},
]


PROJECT_JSON_TEMPLATE = """[
  {
    "id": "T0001",
    "theme": "示例主题",
    "title": "中文课题标题",
    "title_en": "English title optional",
    "summary": "用一段话概括课题要解决的问题、核心方法和预期价值",
    "problem_statement": "250字以内说明科学问题",
    "clinical_endpoint": "250字以内说明临床终点",
    "existing_foundation": "250字以内说明已有基础",
    "tags": ["关键词1", "关键词2"],
    "target_venue": "目标期刊/会议"
  },
  {
    "theme": "示例主题",
    "title": "第二个中文课题标题",
    "title_en": "",
    "summary": "第二个课题摘要",
    "tags": "关键词1，关键词2"
  }
]
"""
