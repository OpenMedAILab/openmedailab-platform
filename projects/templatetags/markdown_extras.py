import re

from django import template
from django.utils.html import conditional_escape
from django.utils.safestring import mark_safe

register = template.Library()

_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_CODE_RE = re.compile(r"`([^`]+)`")


def _inline_markdown(text):
    text = conditional_escape(text)
    text = _CODE_RE.sub(r"<code>\1</code>", text)
    text = _BOLD_RE.sub(r"<strong>\1</strong>", text)
    return text


@register.filter
def readable_markdown(value):
    lines = str(value or "").splitlines()
    html = []
    paragraph = []
    in_list = False

    def flush_paragraph():
        if paragraph:
            html.append(f"<p>{_inline_markdown(' '.join(paragraph))}</p>")
            paragraph.clear()

    def close_list():
        nonlocal in_list
        if in_list:
            html.append("</ul>")
            in_list = False

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            close_list()
            continue

        if line.startswith("#"):
            heading_text = line.lstrip("#").strip()
            level = min(len(line) - len(line.lstrip("#")), 3)
            if heading_text:
                flush_paragraph()
                close_list()
                html.append(f"<h{level}>{_inline_markdown(heading_text)}</h{level}>")
                continue

        if line.startswith(("- ", "* ")):
            flush_paragraph()
            if not in_list:
                html.append("<ul>")
                in_list = True
            html.append(f"<li>{_inline_markdown(line[2:].strip())}</li>")
            continue

        paragraph.append(line)

    flush_paragraph()
    close_list()
    if not html:
        return mark_safe('<p class="empty-state">暂无 Markdown 正文。</p>')
    return mark_safe("\n".join(html))
