PROJECT_FIELD_CONTRACT = [
    {"name": "topic_id", "label": "课题 ID", "type": "string", "required": True, "source": "project.topic_id"},
    {"name": "theme", "label": "主题", "type": "string", "required": True, "source": "theme.name 或 theme.slug"},
    {"name": "project_no", "label": "主题内编号", "type": "integer", "required": False, "source": "project.project_no"},
    {"name": "title", "label": "标题", "type": "string", "required": True, "source": "project.title"},
    {"name": "summary", "label": "摘要", "type": "text", "required": False, "source": "project.summary"},
    {"name": "problem_statement", "label": "科学问题", "type": "text", "required": False, "source": "project.problem_statement"},
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
    {"name": "source_md_path", "label": "Markdown 路径", "type": "string", "required": False, "source": "project.source_md_path"},
    {"name": "source_pdf_path", "label": "PDF 路径", "type": "string", "required": False, "source": "project.source_pdf_path"},
    {"name": "page_path", "label": "公开页路径", "type": "string", "required": False, "source": "project.page_path"},
    {"name": "documents", "label": "文件", "type": "array", "required": False, "source": "ProjectDocument"},
    {"name": "has_pdf", "label": "是否有 PDF", "type": "boolean", "required": False, "source": "project.has_pdf"},
    {"name": "is_public", "label": "是否公开", "type": "boolean", "required": False, "source": "project.is_public"},
]


PROJECT_JSON_EXAMPLE = {
    "topic_id": "DME-RAG-001",
    "theme": "糖尿病黄斑水肿",
    "project_no": 1,
    "title": "基于病例随访证据的抗 VEGF 治疗决策 RAG",
    "summary": "围绕 DME 患者随访记录、影像和指南证据，构建可解释的治疗建议检索增强流程。",
    "problem_statement": "抗 VEGF 治疗方案在真实随访中需要结合影像、视力和既往响应进行动态判断。",
    "research_goal": "形成一个可复核的医学 AI 课题方案，并验证 RAG 对随访决策一致性的提升。",
    "technical_route": "指南证据整理 -> 病例要素抽取 -> 向量检索 -> 医生审核 -> 结果评估。",
    "data_requirements": {
        "modalities": ["结构化随访表", "OCT 摘要", "指南文本"],
        "minimum_cases": 50,
        "privacy": "仅允许脱敏或公开样例数据"
    },
    "evaluation_metrics": ["医学一致性", "证据可追溯性", "医生审核通过率"],
    "expected_outputs": ["课题方案", "实验报告", "论文初稿", "可复现实验脚本"],
    "compliance_notes": "不得上传可识别患者身份的数据。",
    "stage": "open_recruiting",
    "tags": ["RAG", "眼科", "真实世界研究"],
    "llm_score": 8.6,
    "recommended_journal": "Journal of Medical Internet Research",
    "needed_roles": ["医生", "学生", "Leader", "AI工程师"],
    "documents": [
        {"doc_type": "markdown", "title": "课题原文", "path": "topics/DME-RAG-001.md"},
        {"doc_type": "pdf", "title": "参考 PDF", "path": "topics/DME-RAG-001.pdf"}
    ],
    "is_public": True
}


DEFAULT_THEME_FILE_SPACE = {
    "access_level": "restricted_metadata",
    "storage_policy": "主题文件域只登记与该主题相关的数据资产元信息，例如公开数据集链接、数据字典、标注规范、伦理合规材料和模型实验资产；不登记单个课题原文、PDF 或公开页面。",
    "allowed_file_types": ["dataset", "data_dictionary", "annotation_guide", "ethics", "model_artifact", "dataset_meta", "link", "other"],
    "sections": ["数据集文件", "数据字典", "标注规范", "伦理合规材料", "模型与实验资产"],
}
