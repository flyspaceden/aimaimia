#!/usr/bin/env python3
"""Generate PDF from refund.md rules document."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# Register Chinese fonts
FONT_PATH = "/System/Library/Fonts/PingFang.ttc"
pdfmetrics.registerFont(TTFont("PingFang", FONT_PATH, subfontIndex=0))
pdfmetrics.registerFont(TTFont("PingFang-Bold", FONT_PATH, subfontIndex=1))

# Colors
PRIMARY = HexColor("#2E7D32")
DARK = HexColor("#1a1a1a")
GRAY = HexColor("#555555")
LIGHT_BG = HexColor("#f5f5f5")
WHITE = HexColor("#ffffff")
BORDER = HexColor("#cccccc")
ACCENT = HexColor("#e8f5e9")

# Styles
styles = {
    "title": ParagraphStyle(
        "title", fontName="PingFang-Bold", fontSize=22,
        textColor=PRIMARY, alignment=TA_CENTER, spaceAfter=6*mm,
        leading=28
    ),
    "subtitle": ParagraphStyle(
        "subtitle", fontName="PingFang", fontSize=10,
        textColor=GRAY, alignment=TA_CENTER, spaceAfter=10*mm
    ),
    "h1": ParagraphStyle(
        "h1", fontName="PingFang-Bold", fontSize=14,
        textColor=PRIMARY, spaceBefore=8*mm, spaceAfter=4*mm,
        leading=20, borderPadding=(0, 0, 2, 0)
    ),
    "h2": ParagraphStyle(
        "h2", fontName="PingFang-Bold", fontSize=11,
        textColor=DARK, spaceBefore=5*mm, spaceAfter=3*mm,
        leading=16
    ),
    "body": ParagraphStyle(
        "body", fontName="PingFang", fontSize=9.5,
        textColor=DARK, spaceAfter=2*mm, leading=16,
        firstLineIndent=0
    ),
    "bullet": ParagraphStyle(
        "bullet", fontName="PingFang", fontSize=9.5,
        textColor=DARK, spaceAfter=1.5*mm, leading=15,
        leftIndent=12, bulletIndent=0
    ),
    "code": ParagraphStyle(
        "code", fontName="PingFang", fontSize=8.5,
        textColor=HexColor("#333333"), spaceAfter=2*mm,
        leading=14, leftIndent=8, backColor=LIGHT_BG
    ),
    "table_header": ParagraphStyle(
        "th", fontName="PingFang-Bold", fontSize=8.5,
        textColor=WHITE, leading=13, alignment=TA_CENTER
    ),
    "table_cell": ParagraphStyle(
        "tc", fontName="PingFang", fontSize=8.5,
        textColor=DARK, leading=13
    ),
    "table_cell_center": ParagraphStyle(
        "tcc", fontName="PingFang", fontSize=8.5,
        textColor=DARK, leading=13, alignment=TA_CENTER
    ),
}


def make_table(headers, rows, col_widths=None):
    """Create a styled table."""
    width = 170 * mm
    if col_widths is None:
        col_widths = [width / len(headers)] * len(headers)

    header_cells = [Paragraph(h, styles["table_header"]) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), styles["table_cell"]) for c in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME", (0, 0), (-1, -1), "PingFang"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, ACCENT]),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def bullet(text):
    return Paragraph(f"•  {text}", styles["bullet"])


def build_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=18*mm, bottomMargin=18*mm,
        title="爱买买 — 退换货系统完整规则文档",
        author="爱买买平台"
    )

    story = []

    # Title page
    story.append(Spacer(1, 30*mm))
    story.append(Paragraph("爱买买", styles["title"]))
    story.append(Paragraph("退换货系统完整规则文档", ParagraphStyle(
        "title2", fontName="PingFang-Bold", fontSize=18,
        textColor=DARK, alignment=TA_CENTER, spaceAfter=8*mm, leading=24
    )))
    story.append(HRFlowable(width="60%", color=PRIMARY, thickness=1.5, spaceAfter=6*mm))
    story.append(Paragraph("版本 v1.0  |  2026-03-30  |  需求确认完成，待设计", styles["subtitle"]))
    story.append(Spacer(1, 20*mm))

    # TOC
    story.append(Paragraph("目 录", ParagraphStyle(
        "toc_title", fontName="PingFang-Bold", fontSize=14,
        textColor=PRIMARY, alignment=TA_CENTER, spaceAfter=6*mm
    )))
    toc_items = [
        "规则 1：退货窗口起算点",
        "规则 2：不可退商品判定方式（两级机制）",
        "规则 3：不可退商品质量问题仍可退",
        "规则 4：审核模式 — 卖家审核 + 平台仲裁",
        "规则 5：价格阈值决定是否需要寄回",
        "规则 6：退款只退商品价格，不退运费",
        "规则 7：平台红包按比例分摊",
        "规则 8：七天无理由退货规则",
        "规则 9：质量问题退货运费平台承担",
        "规则 10：生鲜商品特殊规则",
        "规则 11：非生鲜商品质量问题申报时限",
        "规则 12：统一售后入口 — 三种售后类型",
        "规则 13：部分退货支持",
        "规则 14：退货/换货后奖励归平台",
        "规则 15：分润奖励两层冻结机制",
        "规则 16：完整状态机",
        "规则 17：卖家验收不通过处理",
        "规则 18：超时自动处理机制",
        "规则 19：买家撤销规则",
        "规则 20：订单状态与售后的关系",
        "规则 21：多售后并行规则",
        "规则 22：换货后再退货限制",
        "规则 23：换货也按阈值决定是否寄回",
        "附录 A：后台可配置参数汇总",
        "附录 B：法律依据",
    ]
    for i, item in enumerate(toc_items):
        story.append(Paragraph(item, ParagraphStyle(
            f"toc_{i}", fontName="PingFang", fontSize=9.5,
            textColor=DARK, spaceAfter=1.5*mm, leading=15, leftIndent=10
        )))
    story.append(PageBreak())

    # ===== Rule 1 =====
    story.append(Paragraph("规则 1：退货窗口起算点", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "从订单状态变为 DELIVERED（物流签收）的时间开始计算",
        "系统记录 deliveredAt 时间戳作为起算基准",
        "7 天 = 168 小时，精确到时分秒（例如 3月1日 14:30 签收 → 3月8日 14:30 截止）",
        "如果订单在 DELIVERED 之前买家主动确认收货（跳到 RECEIVED），仍以 DELIVERED 时间为准",
        "如果物流异常没有 DELIVERED 记录，以买家主动确认收货时间为准",
    ]:
        story.append(bullet(t))

    # ===== Rule 2 =====
    story.append(Paragraph("规则 2：不可退商品的判定方式（两级机制）", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("分类级别", styles["h2"]))
    for t in [
        "Category 模型新增 returnPolicy 字段，可选值：RETURNABLE（可退）/ NON_RETURNABLE（不可退）/ INHERIT（继承父分类）",
        "顶级分类默认 RETURNABLE",
        "子分类默认 INHERIT，沿树向上查找最近的非 INHERIT 祖先分类的值",
        "管理员在分类管理页面设置",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("商品级别", styles["h2"]))
    for t in [
        "Product 模型新增 returnPolicy 字段，可选值：RETURNABLE / NON_RETURNABLE / INHERIT（继承分类设置）",
        "默认 INHERIT",
        "卖家发布商品时可选择，管理员可在审核时修改",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("最终判定逻辑", styles["h2"]))
    for t in [
        "1. 先看商品自身的 returnPolicy",
        "2. 如果是 INHERIT，向上查分类的 returnPolicy",
        "3. 分类如果也是 INHERIT，继续向上查父分类，直到找到明确值",
        "4. 最终兜底为 RETURNABLE",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("不可退声明展示", styles["h2"]))
    for t in [
        '商品详情页：不可退商品展示醒目的\u201c不支持7天无理由退货\u201d标签 + 法律依据说明',
        '结账页：包含不可退商品时弹出确认提示',
        '订单详情页：不可退商品旁标注\u201c不支持无理由退货\u201d',
    ]:
        story.append(bullet(t))

    # ===== Rule 3 =====
    story.append(Paragraph("规则 3：不可退商品的质量问题仍可退", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "标记为"不可退"的商品（如生鲜海鲜），仅豁免"七天无理由退货"",
        "如果商品存在质量问题（变质、损坏、发错货等），买家仍可发起"质量问题退货退款"或"质量问题换货"",
        "需要提供照片/视频凭证",
        "生鲜商品质量问题的申报时限为签收后 24 小时（可配置，见规则 10）",
        "审核流程不变：卖家审核 → 平台仲裁",
    ]:
        story.append(bullet(t))

    # ===== Rule 4 =====
    story.append(Paragraph("规则 4：审核模式 — 卖家审核 + 平台仲裁", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("第一级：卖家审核", styles["h2"]))
    for t in [
        "买家提交售后申请后，首先由卖家审核",
        "卖家可以：开始审核（REQUESTED → UNDER_REVIEW）→ 同意（→ APPROVED）或驳回（→ REJECTED）",
        "卖家审核需要查看买家提供的照片凭证、原因描述",
        "仅 OWNER / MANAGER 角色可审核",
        "卖家只能处理自己公司商品的售后申请",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("第二级：平台仲裁", styles["h2"]))
    for t in [
        "触发条件：卖家驳回后，买家不满意可升级到平台仲裁",
        "管理员可查看双方举证，做出最终裁决（同意/驳回）",
        "管理员仲裁结果为最终结果",
        "管理员可在 REQUESTED / UNDER_REVIEW / REJECTED 状态下介入仲裁",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("特殊情况", styles["h2"]))
    story.append(bullet("换货后再退货（规则 22）直接走平台仲裁，跳过卖家审核"))

    # ===== Rule 5 =====
    story.append(Paragraph("规则 5：价格阈值决定是否需要寄回", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("配置项", styles["h2"]))
    for t in [
        "后台管理员可配置全局参数 RETURN_NO_SHIP_THRESHOLD（默认值建议 50 元）",
        "存储在系统配置表中，可随时调整",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("适用场景：质量问题退货退款 + 质量问题换货", styles["h2"]))
    for t in [
        "退货/换货商品的金额（单价 × 数量）≤ 阈值：拍照审核通过后直接退款/补发，不用寄回",
        "退货/换货商品的金额 > 阈值：拍照 + 必须寄回商品",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("不适用场景", styles["h2"]))
    story.append(bullet("七天无理由退货（规则 8 强制寄回，不受阈值影响）"))

    story.append(Paragraph("寄回运费承担", styles["h2"]))
    for t in [
        "质量问题需要寄回：平台承担运费（规则 9）",
        "七天无理由需要寄回：买家自付运费（规则 8）",
    ]:
        story.append(bullet(t))

    # ===== Rule 6 =====
    story.append(Paragraph("规则 6：退款只退商品价格，不退运费", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "退款金额 = 退货商品的实付金额（扣除该商品分摊的红包优惠后）",
        "原订单的运费不退（无论退多少商品）",
        "<b>唯一例外</b>：如果订单所有商品全部退货，运费也应退还（因为整个订单等于没发生）",
        "计算公式：退款金额 = 商品单价 × 退货数量 - 该商品分摊的红包优惠",
    ]:
        story.append(bullet(t))

    # ===== Rule 7 =====
    story.append(Paragraph("规则 7：平台红包按比例分摊", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("分摊算法", styles["h2"]))
    for t in [
        "订单使用了平台红包（CouponInstance）抵扣了 D 元",
        "订单总商品金额 = G 元",
        "退货商品金额 = R 元",
        "该商品分摊的红包优惠 = D × (R / G)",
        "实际退款金额 = R - D × (R / G)",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("举例", styles["h2"]))
    for t in [
        "订单商品：A=100元, B=200元, C=300元，总额 600 元",
        "红包抵扣 60 元，实付 540 元",
        "退商品 A（100 元）：分摊红包 = 60 × (100/600) = 10 元，退款 = 100 - 10 = 90 元",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("红包不退回", styles["h2"]))
    for t in [
        "退货后已使用的红包不退回给用户",
        "红包的 CouponInstance 状态保持 USED，不恢复为 AVAILABLE",
    ]:
        story.append(bullet(t))

    # ===== Rule 8 =====
    story.append(Paragraph("规则 8：七天无理由退货规则", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("适用条件", styles["h2"]))
    for t in [
        "商品的 returnPolicy 最终判定为 RETURNABLE（非生鲜、非不可退商品）",
        "在签收后 7 天内（从 DELIVERED 起算）",
        "商品应当完好（未拆封使用、配件齐全、不影响二次销售）",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("流程要求", styles["h2"]))
    for t in [
        "必须拍照（证明商品完好状态）",
        "一律需要寄回商品（不受价格阈值影响）",
        "退回运费由买家自付",
        "买家填写退回物流单号",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("不适用", styles["h2"]))
    for t in [
        "生鲜/鲜活/易腐商品（returnPolicy = NON_RETURNABLE）",
        "已拆封食品、已使用商品",
        "VIP_PACKAGE 订单",
        "超过 7 天窗口期",
    ]:
        story.append(bullet(t))

    # ===== Rule 9 =====
    story.append(Paragraph("规则 9：质量问题退货运费平台承担", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "质量问题退货/换货中，如果需要寄回（商品金额 > 阈值），运费由平台承担",
        "实现方式：退款时额外加上运费金额补偿给买家",
        "运费金额由买家填写实际运费，设置上限（后台可配置 MAX_RETURN_SHIPPING_FEE，建议默认 30 元）",
        "超出上限部分由买家自付",
    ]:
        story.append(bullet(t))

    # ===== Rule 10 =====
    story.append(Paragraph("规则 10：生鲜商品特殊规则", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("不适用七天无理由退货", styles["h2"]))
    for t in [
        "生鲜/鲜活/冷冻/冰鲜商品属于法定豁免类别",
        "通过分类或商品级 returnPolicy = NON_RETURNABLE 标记",
        "商品详情页和下单页明确告知"不支持7天无理由退货"",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("质量问题可退（唯一售后途径）", styles["h2"]))
    for t in [
        "仅在签收后 24 小时内（可配置，参数 FRESH_RETURN_HOURS，默认 24）",
        "必须提供清晰凭证：商品全貌照、快递面单照、变质/破损/漏发照片",
        "可退情形：变质、异味、严重化冻、包装破损泄漏、重量严重短缺、发错货、漏发",
        "不可退情形：非质量问题的个人原因、签收超时导致变质、无有效凭证、已拆封加工食用",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("处理方式", styles["h2"]))
    for t in [
        "按阈值决定是否需要寄回（生鲜通常不寄回，因为寄回也变质了）",
        "核实后可补发、换货或退款",
    ]:
        story.append(bullet(t))

    # ===== Rule 11 =====
    story.append(Paragraph("规则 11：非生鲜商品质量问题申报时限", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "后台可配置参数 NORMAL_RETURN_DAYS，默认 7 天",
        "从 DELIVERED（物流签收）时间起算",
        "在此期间内买家可以发起"质量问题退货退款"或"质量问题换货"",
        "超过此期限后不再受理质量问题售后",
        "该时限独立于"七天无理由退货"窗口（虽然默认值相同，但可配置为不同值）",
    ]:
        story.append(bullet(t))

    # ===== Rule 12 =====
    story.append(Paragraph("规则 12：统一售后入口 — 三种售后类型", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("买家 App 售后入口", styles["h2"]))
    for t in [
        "订单详情页一个"申请售后"按钮",
        "进入后选择要售后的商品（可选单个或多个）",
        "然后选择售后类型",
    ]:
        story.append(bullet(t))

    w = 170 * mm
    story.append(make_table(
        ["类型", "标识", "结果", "展示条件"],
        [
            ["七天无理由退货", "NO_REASON_RETURN", "退款", "商品可退 + 在 7 天窗口内"],
            ["质量问题退货退款", "QUALITY_RETURN", "退款", "在质量问题时限内"],
            ["质量问题换货", "QUALITY_EXCHANGE", "补发", "在质量问题时限内"],
        ],
        [w*0.18, w*0.22, w*0.1, w*0.5]
    ))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph("动态展示逻辑", styles["h2"]))
    for t in [
        "如果商品是不可退的（生鲜等），隐藏"七天无理由退货"选项",
        "如果超过七天窗口，隐藏"七天无理由退货"选项",
        "如果超过质量问题时限，隐藏两个质量问题选项",
        "如果所有选项都不可用，显示"该商品已超过售后申请期限"",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("原因子类型（质量问题时必选）", styles["h2"]))
    story.append(Paragraph(
        "QUALITY_ISSUE / WRONG_ITEM / DAMAGED / NOT_AS_DESCRIBED / SIZE_ISSUE / EXPIRED / OTHER",
        styles["code"]
    ))

    # ===== Rule 13 =====
    story.append(Paragraph("规则 13：部分退货支持", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "一个订单包含多个商品时，买家可以选择退其中一个或多个",
        "每个售后申请关联具体的 OrderItem（不再是整单）",
        "退款金额按选中商品的实付金额计算（扣除红包分摊）",
        "部分退货后，订单中未退货的商品正常履约",
        "同一个 OrderItem 同一时间只能有一个进行中的售后申请（规则 21）",
    ]:
        story.append(bullet(t))

    # ===== Rule 14 =====
    story.append(Paragraph("规则 14：退货/换货后奖励归平台", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("触发条件", styles["h2"]))
    story.append(bullet("订单中任何一个商品发生了退货退款或换货（无论什么原因）"))

    story.append(Paragraph("处理逻辑", styles["h2"]))
    for t in [
        "该订单的全部分润奖励（所有上级用户的奖励）归平台所有",
        "不是删除奖励记录，而是将收益方从"上级用户"改为"平台账户"",
        "后台仍然正常计算退货后的订单实际金额和对应的分润比例数据",
        "这些数据仅用于平台统计报表，不实际发放给上级用户",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("计算逻辑（用于统计）", styles["h2"]))
    for t in [
        "退货后订单实际金额 = 原订单商品金额 - 退货商品金额",
        "按退货后的实际金额重新计算分润比例",
        "记录在奖励分配记录中，标记为"平台收入"",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("时序", styles["h2"]))
    for t in [
        "如果在 7 天退货保护期内发生退货 → 奖励从 RETURN_FROZEN 直接转为平台收入",
        "如果在 7 天退货保护期后发生退货（质量问题时限内）→ 已释放的奖励需要回收归平台",
    ]:
        story.append(bullet(t))

    # ===== Rule 15 =====
    story.append(Paragraph("规则 15：分润奖励两层冻结机制", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("第一层：退货保护期冻结（新增）", styles["h2"]))
    w = 170 * mm
    story.append(make_table(
        ["阶段", "时间", "奖励状态", "用户可见", "可提现"],
        [
            ["订单 RECEIVED", "T+0", "RETURN_FROZEN", "否", "否"],
            ["DELIVERED 起 7 天内", "T+0 ~ T+7", "RETURN_FROZEN", "否", "否"],
            ["7 天到期无退货", "T+7", "转为 FROZEN", "是", "否"],
            ["7 天内发生退货", "随时", "转为平台收入", "—", "—"],
        ],
        [w*0.22, w*0.16, w*0.24, w*0.18, w*0.20]
    ))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph("第二层：原有第 x 单冻结解冻（现有机制不变）", styles["h2"]))
    for t in [
        "奖励从 RETURN_FROZEN 转为 FROZEN 后，进入现有的"第 x 单完成"冻结/解冻机制",
        "满足条件后 FROZEN → AVAILABLE",
        "AVAILABLE 后用户可在钱包中提现",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("需要新增的 RewardLedgerStatus 枚举值", styles["h2"]))
    story.append(bullet("RETURN_FROZEN — 退货保护期冻结（用户不可见）"))

    # ===== Rule 16 =====
    story.append(Paragraph("规则 16：完整状态机", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("状态定义", styles["h2"]))
    w = 170 * mm
    story.append(make_table(
        ["状态", "含义"],
        [
            ["REQUESTED", "买家提交售后申请"],
            ["UNDER_REVIEW", "卖家开始审核"],
            ["APPROVED", "卖家/管理员同意"],
            ["REJECTED", "卖家/管理员驳回"],
            ["RETURN_SHIPPING", "买家已寄回商品，等待卖家收货"],
            ["RECEIVED_BY_SELLER", "卖家确认收到退回商品"],
            ["SELLER_REJECTED_RETURN", "卖家验收不通过（买家可仲裁）"],
            ["REFUNDING", "退款处理中"],
            ["REFUNDED", "退款完成"],
            ["REPLACEMENT_SHIPPED", "换货新商品已发出"],
            ["COMPLETED", "售后完成"],
            ["CANCELED", "买家主动撤销"],
        ],
        [w*0.35, w*0.65]
    ))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph("退货退款 — 需要寄回", styles["h2"]))
    story.append(Paragraph(
        "REQUESTED → UNDER_REVIEW → APPROVED → RETURN_SHIPPING → RECEIVED_BY_SELLER → REFUNDING → REFUNDED → COMPLETED",
        styles["code"]
    ))
    story.append(bullet("卖家验收不通过时：RECEIVED_BY_SELLER → SELLER_REJECTED_RETURN（买家可仲裁）"))

    story.append(Paragraph("退货退款 — 不用寄回", styles["h2"]))
    story.append(Paragraph(
        "REQUESTED → UNDER_REVIEW → APPROVED → REFUNDING → REFUNDED → COMPLETED",
        styles["code"]
    ))

    story.append(Paragraph("换货 — 需要寄回", styles["h2"]))
    story.append(Paragraph(
        "REQUESTED → UNDER_REVIEW → APPROVED → RETURN_SHIPPING → RECEIVED_BY_SELLER → REPLACEMENT_SHIPPED → COMPLETED",
        styles["code"]
    ))

    story.append(Paragraph("换货 — 不用寄回", styles["h2"]))
    story.append(Paragraph(
        "REQUESTED → UNDER_REVIEW → APPROVED → REPLACEMENT_SHIPPED → COMPLETED",
        styles["code"]
    ))

    story.append(Paragraph("驳回 → 仲裁路径", styles["h2"]))
    story.append(Paragraph(
        "任意审核阶段 → REJECTED → 买家升级仲裁 → 管理员裁决 APPROVED 或维持 REJECTED",
        styles["code"]
    ))

    story.append(Paragraph("撤销路径", styles["h2"]))
    story.append(Paragraph(
        "REQUESTED / UNDER_REVIEW → CANCELED（买家主动撤销）",
        styles["code"]
    ))

    # ===== Rule 17 =====
    story.append(Paragraph("规则 17：卖家验收不通过处理", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("触发条件", styles["h2"]))
    story.append(bullet("买家寄回商品后，卖家收到商品检查发现不符合退货条件"))

    story.append(Paragraph("卖家操作", styles["h2"]))
    for t in [
        "状态从 RECEIVED_BY_SELLER → SELLER_REJECTED_RETURN",
        "卖家必须填写拒绝原因（文字说明）",
        "卖家必须上传举证照片（证明商品不符合退货条件）",
        "卖家需要将商品寄回给买家（填写退回物流单号）",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("买家选择", styles["h2"]))
    for t in [
        "接受拒绝 → 售后关闭，商品寄回买家",
        "不接受 → 升级到平台仲裁",
        "平台管理员查看双方举证后做最终裁决",
    ]:
        story.append(bullet(t))

    # ===== Rule 18 =====
    story.append(Paragraph("规则 18：超时自动处理机制", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    w = 170 * mm
    story.append(make_table(
        ["场景", "参数名", "默认值", "超时处理"],
        [
            ["卖家不审核", "SELLER_REVIEW_TIMEOUT_DAYS", "3 天", "自动同意"],
            ["买家不寄回", "BUYER_SHIP_TIMEOUT_DAYS", "7 天", "自动关闭售后"],
            ["卖家不验收", "SELLER_RECEIVE_TIMEOUT_DAYS", "7 天", "自动视为验收通过"],
            ["换货买家不确认", "BUYER_CONFIRM_TIMEOUT_DAYS", "7 天", "自动确认收货"],
        ],
        [w*0.18, w*0.35, w*0.12, w*0.35]
    ))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph("执行方式", styles["h2"]))
    for t in [
        "定时任务（Cron）定期扫描超时的售后申请",
        "扫描频率：每小时一次",
        "超时处理在 Serializable 事务内执行，防止并发",
    ]:
        story.append(bullet(t))

    # ===== Rule 19 =====
    story.append(Paragraph("规则 19：买家撤销规则", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("可撤销阶段", styles["h2"]))
    for t in [
        "REQUESTED（刚提交，卖家还没看）",
        "UNDER_REVIEW（卖家在审核中，但还没做决定）",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("不可撤销阶段", styles["h2"]))
    story.append(bullet("APPROVED 及之后的所有状态（流程已启动，涉及物流和资金操作）"))

    story.append(Paragraph("撤销后", styles["h2"]))
    for t in [
        "状态变为 CANCELED",
        "该商品可以重新发起售后申请（如果仍在时限内）",
        "不影响订单状态和奖励状态",
    ]:
        story.append(bullet(t))

    # ===== Rule 20 =====
    story.append(Paragraph("规则 20：订单状态与售后的关系", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("部分退货", styles["h2"]))
    for t in [
        "订单状态保持 RECEIVED 不变",
        "订单关联的售后申请中可以查看哪些商品退了",
        "前端通过售后记录显示"部分退款"标记",
        "订单的 totalAmount 不变，通过售后记录计算实际最终金额",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("全部退货", styles["h2"]))
    for t in [
        "订单状态变为 REFUNDED",
        "同时退还运费（规则 6 的例外情况）",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("换货完成 / 售后进行中", styles["h2"]))
    for t in [
        "换货完成：订单状态保持 RECEIVED，售后申请状态为 COMPLETED",
        "售后进行中：前端订单列表标记"售后中"标识，详情页显示售后进度",
    ]:
        story.append(bullet(t))

    # ===== Rule 21 =====
    story.append(Paragraph("规则 21：多售后并行规则", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("同一订单、不同商品", styles["h2"]))
    story.append(bullet("可以同时存在多个售后申请（如商品 A 退货 + 商品 B 换货同时进行）"))

    story.append(Paragraph("同一个 OrderItem", styles["h2"]))
    for t in [
        "同一时间只能有一个进行中的售后申请",
        ""进行中" = REQUESTED / UNDER_REVIEW / APPROVED / RETURN_SHIPPING / RECEIVED_BY_SELLER / SELLER_REJECTED_RETURN / REFUNDING / REPLACEMENT_SHIPPED",
        "上一个售后申请已终结（COMPLETED / REFUNDED / CANCELED / REJECTED 且未升级仲裁）后可重新发起",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("同一订单的奖励影响", styles["h2"]))
    story.append(bullet("只要订单下有任何一个售后申请最终成功（退款完成或换货完成），整单奖励归平台（规则 14）"))

    # ===== Rule 22 =====
    story.append(Paragraph("规则 22：换货后再退货限制", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("背景", styles["h2"]))
    story.append(bullet("防止"换货拿新品 → 无理由退货退款"的薅羊毛路径"))

    story.append(Paragraph("规则", styles["h2"]))
    for t in [
        "换货完成（状态 COMPLETED）后收到的新商品",
        "<b>不允许</b>申请"七天无理由退货"",
        "<b>仅允许</b>申请"质量问题退货退款"（新商品确实有质量问题）",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("审核方式", styles["h2"]))
    for t in [
        "跳过卖家审核，直接走平台仲裁",
        "平台管理员审核照片凭证，判断是否属实",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("实现", styles["h2"]))
    for t in [
        "售后申请记录中标记 isPostReplacement = true",
        "系统自动跳过 UNDER_REVIEW 阶段，状态直接到平台待仲裁",
    ]:
        story.append(bullet(t))

    # ===== Rule 23 =====
    story.append(Paragraph("规则 23：换货也按阈值决定是否寄回", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    story.append(Paragraph("逻辑与退货一致", styles["h2"]))
    for t in [
        "换货商品金额 ≤ RETURN_NO_SHIP_THRESHOLD：不用寄回旧商品，卖家直接补发新商品",
        "换货商品金额 > RETURN_NO_SHIP_THRESHOLD：买家需要寄回旧商品，卖家收到后再发新商品",
    ]:
        story.append(bullet(t))

    story.append(Paragraph("运费承担", styles["h2"]))
    story.append(bullet("质量问题换货需要寄回：运费平台承担（与退货一致）"))

    story.append(Paragraph("流程差异", styles["h2"]))
    for t in [
        "不用寄回：APPROVED → 卖家发出新商品 → REPLACEMENT_SHIPPED → 买家确认 → COMPLETED",
        "需要寄回：APPROVED → 买家寄回 → RETURN_SHIPPING → 卖家验收 → RECEIVED_BY_SELLER → 卖家发新商品 → REPLACEMENT_SHIPPED → 买家确认 → COMPLETED",
    ]:
        story.append(bullet(t))

    # ===== Appendix A =====
    story.append(PageBreak())
    story.append(Paragraph("附录 A：后台可配置参数汇总", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))

    w = 170 * mm
    story.append(make_table(
        ["参数名", "用途", "默认值"],
        [
            ["RETURN_NO_SHIP_THRESHOLD", "质量问题免寄回金额阈值", "50 元"],
            ["MAX_RETURN_SHIPPING_FEE", "平台承担退货运费上限", "30 元"],
            ["FRESH_RETURN_HOURS", "生鲜商品质量问题申报时限", "24 小时"],
            ["NORMAL_RETURN_DAYS", "非生鲜商品质量问题申报时限", "7 天"],
            ["SELLER_REVIEW_TIMEOUT_DAYS", "卖家不审核自动同意时限", "3 天"],
            ["BUYER_SHIP_TIMEOUT_DAYS", "买家不寄回自动关闭时限", "7 天"],
            ["SELLER_RECEIVE_TIMEOUT_DAYS", "卖家不验收自动通过时限", "7 天"],
            ["BUYER_CONFIRM_TIMEOUT_DAYS", "换货买家不确认自动完成时限", "7 天"],
        ],
        [w*0.35, w*0.40, w*0.25]
    ))

    # ===== Appendix B =====
    story.append(Spacer(1, 8*mm))
    story.append(Paragraph("附录 B：法律依据", styles["h1"]))
    story.append(HRFlowable(width="100%", color=PRIMARY, thickness=1, spaceAfter=4*mm))
    for t in [
        "《中华人民共和国电子商务法》",
        "《中华人民共和国消费者权益保护法》第 25 条",
        "《网络购买商品七日无理由退货暂行办法》",
        "鲜活易腐商品属于法定绝对不适用七天无理由退货范畴",
        "拆封后影响安全/品质的商品（如食品）属于经确认可不适用范畴",
    ]:
        story.append(bullet(t))

    # Build
    doc.build(story)
    print(f"PDF generated: {output_path}")


if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    output = os.path.join(project_dir, "refund-rules.pdf")
    build_pdf(output)
