PROJECT_FIELD_CONTRACT = [
    {"name": "id", "label": "课题 ID", "type": "integer", "required": True, "source": "project.topic_id"},
    {"name": "theme", "label": "主题", "type": "string", "required": True, "source": "theme.name 或 theme.slug"},
    {"name": "title", "label": "Title（中文）", "type": "string", "required": True, "source": "project.title"},
    {"name": "title_en", "label": "Title（英文，选填）", "type": "string", "required": False, "source": "project.title_en"},
    {"name": "summary", "label": "摘要", "type": "text", "required": False, "source": "project.summary"},
    {"name": "problem_statement", "label": "科学问题（50字以内）", "type": "text", "required": True, "source": "project.problem_statement"},
    {"name": "clinical_endpoint", "label": "临床终点（50字以内）", "type": "string", "required": True, "source": "project.clinical_endpoint"},
    {"name": "existing_foundation", "label": "已有基础（50字以内）", "type": "string", "required": True, "source": "project.existing_foundation"},
    {"name": "research_goal", "label": "研究目标", "type": "text", "required": False, "source": "project.research_goal"},
    {"name": "technical_route", "label": "技术路线", "type": "text", "required": False, "source": "project.technical_route"},
    {"name": "data_requirements", "label": "数据需求", "type": "object", "required": False, "source": "project.data_requirements"},
    {"name": "evaluation_metrics", "label": "评价指标", "type": "array", "required": False, "source": "project.evaluation_metrics"},
    {"name": "expected_outputs", "label": "预期成果", "type": "array", "required": False, "source": "project.expected_outputs"},
    {"name": "compliance_notes", "label": "合规说明", "type": "text", "required": False, "source": "project.compliance_notes"},
    {"name": "stage", "label": "阶段", "type": "enum", "required": False, "source": "ProjectStage"},
    {"name": "tags", "label": "标签", "type": "array", "required": False, "source": "Project.tags"},
    {"name": "llm_score", "label": "初始评分", "type": "decimal", "required": False, "source": "project.llm_score"},
    {"name": "community_score", "label": "社区评分", "type": "decimal", "required": False, "source": "project.community_score"},
    {"name": "composite_score", "label": "综合评分", "type": "decimal", "required": False, "source": "project.composite_score"},
    {"name": "recommended_journal", "label": "推荐期刊", "type": "string", "required": False, "source": "project.recommended_journal"},
    {"name": "needed_roles", "label": "需要角色", "type": "array", "required": False, "source": "project.needed_roles"},
    {"name": "score_dimensions", "label": "评分维度", "type": "object", "required": False, "source": "project.score_dimensions"},
    {"name": "is_public", "label": "是否公开", "type": "boolean", "required": False, "source": "project.is_public"},
]


PROJECT_JSONL_TEMPLATE = """{"id":1,"theme":"示例主题","title":"中文课题标题","title_en":"English title optional","problem_statement":"50字以内说明科学问题","clinical_endpoint":"50字以内说明临床终点","existing_foundation":"50字以内说明已有基础","summary":"","tags":[],"needed_roles":[]}
{"id":2,"theme":"示例主题","title":"第二个中文课题标题","title_en":"","problem_statement":"科学问题","clinical_endpoint":"临床终点","existing_foundation":"已有基础","summary":"","tags":[],"needed_roles":[]}
"""


DEFAULT_THEME_FILE_SPACE = {
    "access_level": "restricted_metadata",
    "storage_policy": "主题文件空间只登记与该主题相关的数据资产元信息。",
    "allowed_file_types": ["dataset", "data_dictionary", "annotation_guide", "ethics", "model_artifact", "dataset_meta", "link", "other"],
    "sections": ["数据集文件", "数据字典", "标注规范", "伦理合规材料", "模型与实验资产"],
}
