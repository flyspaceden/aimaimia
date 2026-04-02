#!/usr/bin/env python3
"""
将 Markdown 利润报告转换为 PDF（支持中文）
"""
import os
import re
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.colors import HexColor, black, white, grey
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

# 注册中文字体
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
MD_PATH = os.path.join(OUTPUT_DIR, "vip_profitability_report.md")
PDF_PATH = os.path.join(OUTPUT_DIR, "vip_profitability_report.pdf")

# 颜色
GREEN = HexColor("#2E7D32")
DARK = HexColor("#1a1a2e")
LIGHT_BG = HexColor("#f5f5f5")
TABLE_HEADER_BG = HexColor("#2E7D32")
TABLE_ALT_BG = HexColor("#f0f7f0")
ACCENT = HexColor("#1565C0")


def create_styles():
    """创建样式"""
    CN = 'STSong-Light'
    styles = {}

    styles['title'] = ParagraphStyle(
        'Title', fontName=CN, fontSize=22, leading=30,
        textColor=DARK, alignment=TA_CENTER, spaceAfter=8*mm,
    )
    styles['subtitle'] = ParagraphStyle(
        'Subtitle', fontName=CN, fontSize=11, leading=16,
        textColor=grey, alignment=TA_CENTER, spaceAfter=12*mm,
    )
    styles['h1'] = ParagraphStyle(
        'H1', fontName=CN, fontSize=16, leading=22,
        textColor=GREEN, spaceBefore=10*mm, spaceAfter=4*mm,
    )
    styles['h2'] = ParagraphStyle(
        'H2', fontName=CN, fontSize=13, leading=18,
        textColor=DARK, spaceBefore=6*mm, spaceAfter=3*mm,
    )
    styles['h3'] = ParagraphStyle(
        'H3', fontName=CN, fontSize=11, leading=16,
        textColor=ACCENT, spaceBefore=4*mm, spaceAfter=2*mm,
    )
    styles['body'] = ParagraphStyle(
        'Body', fontName=CN, fontSize=9.5, leading=15,
        textColor=DARK, spaceAfter=2*mm,
    )
    styles['bullet'] = ParagraphStyle(
        'Bullet', fontName=CN, fontSize=9.5, leading=15,
        textColor=DARK, leftIndent=6*mm, spaceAfter=1*mm,
        bulletIndent=2*mm,
    )
    styles['bold_body'] = ParagraphStyle(
        'BoldBody', fontName=CN, fontSize=9.5, leading=15,
        textColor=DARK, spaceAfter=2*mm,
    )
    styles['footer'] = ParagraphStyle(
        'Footer', fontName=CN, fontSize=8, leading=10,
        textColor=grey, alignment=TA_CENTER,
    )
    return styles


def parse_md_table(lines):
    """解析 Markdown 表格为行列表"""
    rows = []
    for line in lines:
        line = line.strip()
        if not line.startswith('|'): continue
        if re.match(r'^\|[\s\-\|]+\|$', line): continue  # separator
        cells = [c.strip() for c in line.split('|')[1:-1]]
        rows.append(cells)
    return rows


def make_table(rows, styles, col_widths=None):
    """创建格式化表格"""
    if not rows: return None
    CN = 'STSong-Light'

    # 转为 Paragraph
    data = []
    for i, row in enumerate(rows):
        prow = []
        for cell in row:
            cell = cell.replace('**', '')
            st = ParagraphStyle('tc', fontName=CN, fontSize=8, leading=11,
                                alignment=TA_CENTER if i == 0 else TA_LEFT)
            prow.append(Paragraph(cell, st))
        data.append(prow)

    if not data: return None

    ncols = max(len(r) for r in data)
    # Normalize row lengths
    for r in data:
        while len(r) < ncols: r.append(Paragraph('', ParagraphStyle('e', fontName=CN, fontSize=8)))

    avail = 170 * mm
    if col_widths:
        tw = col_widths
    else:
        tw = [avail / ncols] * ncols

    t = Table(data, colWidths=tw, repeatRows=1)

    style_cmds = [
        ('FONTNAME', (0, 0), (-1, -1), CN),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_BG),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]
    # Alternate row colors
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), TABLE_ALT_BG))

    t.setStyle(TableStyle(style_cmds))
    return t


def md_to_elements(md_text, styles):
    """将 Markdown 文本转为 reportlab 元素列表"""
    elements = []
    lines = md_text.split('\n')
    i = 0
    in_table = False
    table_lines = []

    def flush_table():
        nonlocal table_lines
        if table_lines:
            rows = parse_md_table(table_lines)
            if rows:
                t = make_table(rows, styles)
                if t:
                    elements.append(t)
                    elements.append(Spacer(1, 3*mm))
            table_lines = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip HR
        if stripped == '---' or stripped == '':
            if in_table:
                # could be table separator, check next line
                if not stripped.startswith('|'):
                    flush_table()
                    in_table = False
            i += 1
            continue

        # Table
        if stripped.startswith('|'):
            in_table = True
            table_lines.append(stripped)
            i += 1
            continue
        else:
            if in_table:
                flush_table()
                in_table = False

        # Headers
        if stripped.startswith('# ') and not stripped.startswith('## '):
            text = stripped[2:].strip()
            elements.append(Paragraph(text, styles['title']))
            i += 1
            continue

        if stripped.startswith('## '):
            text = stripped[3:].strip()
            elements.append(Spacer(1, 2*mm))
            elements.append(HRFlowable(width="100%", thickness=1, color=GREEN, spaceAfter=2*mm))
            elements.append(Paragraph(text, styles['h1']))
            i += 1
            continue

        if stripped.startswith('### '):
            text = stripped[4:].strip()
            elements.append(Paragraph(text, styles['h2']))
            i += 1
            continue

        # Bold lines
        if stripped.startswith('**') and stripped.endswith('**'):
            text = stripped[2:-2]
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            elements.append(Paragraph(text, styles['bold_body']))
            i += 1
            continue

        # Bullet points
        if stripped.startswith('- ') or stripped.startswith('* '):
            text = stripped[2:]
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            elements.append(Paragraph(f"  {text}", styles['bullet']))
            i += 1
            continue

        # Numbered list
        m = re.match(r'^(\d+)\.\s+(.*)', stripped)
        if m:
            text = m.group(2)
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            elements.append(Paragraph(f"{m.group(1)}. {text}", styles['bullet']))
            i += 1
            continue

        # Regular paragraph
        text = stripped
        text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
        if text:
            elements.append(Paragraph(text, styles['body']))
        i += 1

    flush_table()
    return elements


def add_page_number(canvas, doc):
    """页脚：页码"""
    CN = 'STSong-Light'
    canvas.saveState()
    canvas.setFont(CN, 8)
    canvas.setFillColor(grey)
    canvas.drawCentredString(A4[0]/2, 15*mm,
                             f"爱买买 VIP 推荐分润系统盈利能力分析报告  —  第 {doc.page} 页")
    canvas.restoreState()


def generate_pdf():
    print("正在生成 PDF 报告...")

    # 读取 Markdown
    with open(MD_PATH, 'r', encoding='utf-8') as f:
        md_text = f.read()

    styles = create_styles()

    doc = SimpleDocTemplate(
        PDF_PATH, pagesize=A4,
        topMargin=20*mm, bottomMargin=25*mm,
        leftMargin=20*mm, rightMargin=20*mm,
    )

    elements = md_to_elements(md_text, styles)

    doc.build(elements, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"PDF 报告已生成: {PDF_PATH}")


if __name__ == "__main__":
    generate_pdf()
