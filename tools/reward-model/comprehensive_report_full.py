#!/usr/bin/env python3
"""
农脉分润奖励系统 — 综合利润测算报告生成器

生成完整的 Markdown 分析报告，包含：
  1. 执行摘要（月度净利润总表）
  2. 单笔订单经济学
  3. 月度 P&L 明细（100万用户）
  4. 逐层奖励分析
  5. 敏感性分析（龙卷风排名）
  6. 人均经济学
  7. 盈亏平衡分析
  8. 风险评估

用法：
  python comprehensive_report.py

输出：
  output/综合测算报告.md
"""

import os
import math
from datetime import datetime

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')

# ============================================================
# 固定参数
# ============================================================

SCALES = [100_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000, 10_000_000]
MARKUPS = [1.20, 1.25, 1.30]

# 分润比例
NORMAL_PLATFORM_PCT = 0.50
NORMAL_REWARD_PCT = 0.16
NORMAL_INDUSTRY_PCT = 0.16
NORMAL_CHARITY_PCT = 0.08
NORMAL_TECH_PCT = 0.08
NORMAL_RESERVE_PCT = 0.02

VIP_PLATFORM_PCT = 0.50
VIP_REWARD_PCT = 0.30
VIP_INDUSTRY_PCT = 0.10
VIP_CHARITY_PCT = 0.02
VIP_TECH_PCT = 0.02
VIP_RESERVE_PCT = 0.06

# 基金比例（平台可控）
NORMAL_FUNDS_PCT = NORMAL_CHARITY_PCT + NORMAL_TECH_PCT + NORMAL_RESERVE_PCT  # 0.18
VIP_FUNDS_PCT = VIP_CHARITY_PCT + VIP_TECH_PCT + VIP_RESERVE_PCT  # 0.10

# 用户行为
AVG_COST_NORMAL = 80.0
AVG_COST_VIP = 120.0
FREQ_NORMAL = 3.0
FREQ_VIP = 6.0
VIP_DISCOUNT = 0.95
COMPLETION_RATE = 0.95

# 树结构
BF_NORMAL = 2
MAX_LAYERS_NORMAL = 8
BF_VIP = 3
MAX_LAYERS_VIP = 13
VIP_FILL = 1.00
VIP_ROOTS = 10

# VIP 购买
VIP_PURCHASE_PROFIT = 100.0
VIP_REFERRAL = 50.0
VIP_REFERRAL_RATE = 0.70
VIP_NEW_RATE = 0.02  # 每月新增VIP占总VIP的2%

# 运营
OPERATING_PCT = 0.05
REPLACEMENT_RATE = 0.03
AVG_SHIPPING = 8.0

# 默认模式过滤参数
DEFAULT_ACTIVE_RATE = 0.95
DEFAULT_WITHDRAWAL_RATE = 0.80


# ============================================================
# 核心计算
# ============================================================

def tree_depth_for_users(n_users, bf_eff):
    """计算容纳 n_users 个用户所需的树深度"""
    if n_users <= 1:
        return 1
    return int(math.ceil(math.log(max(n_users * (bf_eff - 1) + 1, 2)) / math.log(bf_eff)))


def calc_tree_reward_outflow_total(n_users, bf, max_layers, tree_depth,
                                    avg_cost, markup, reward_pct, freq,
                                    vip_discount=1.0, fill_rate=1.0):
    """计算整棵树的月度奖励总流出（树结构方式）

    返回 (总月度流出, 人均月度流出, 实际用户数)
    """
    bf_eff = bf * fill_rate
    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost
    if profit <= 0:
        return 0, 0, 0

    rpo = profit * reward_pct  # 每笔订单的奖励金额
    total_monthly = 0
    actual_users = 0

    for L in range(1, tree_depth + 1):
        users = int(round(bf_eff ** L))
        if actual_users + users > n_users:
            users = max(0, int(n_users) - actual_users)
        actual_users += users
        if users <= 0:
            break

        max_k = min(max_layers, tree_depth - L)
        yearly = 0.0
        for k in range(1, max_k + 1):
            if L + k > tree_depth:
                break
            desc = bf_eff ** k
            months = math.ceil(k / freq)
            if months <= 12:
                yearly += desc * rpo
        total_monthly += (yearly / 12.0) * users

    avg = total_monthly / actual_users if actual_users > 0 else 0
    return total_monthly, avg, actual_users


def calc_unlock_rate(freq, max_layers):
    """解锁率：freq次消费能解锁多少层 / maxLayers"""
    return min(freq, max_layers) / max_layers


def run_scenario(n_total, markup, worst=True,
                 normal_reward_pct=None, vip_reward_pct=None,
                 freq_normal=None, freq_vip=None,
                 avg_cost_normal=None, avg_cost_vip=None,
                 operating_cost_pct=None, vip_ratio=None,
                 completion_rate=None):
    """运行单个场景，返回月度P&L详细数据

    worst=True: 奖励池100%流出
    worst=False: 树结构 × 解锁率 × 活跃率(0.95) × 提现率(0.80)
    completion_rate 在两种模式下始终为 0.95
    """
    # 可覆盖的参数
    rp_n = normal_reward_pct if normal_reward_pct is not None else NORMAL_REWARD_PCT
    rp_v = vip_reward_pct if vip_reward_pct is not None else VIP_REWARD_PCT
    fn = freq_normal if freq_normal is not None else FREQ_NORMAL
    fv = freq_vip if freq_vip is not None else FREQ_VIP
    cn = avg_cost_normal if avg_cost_normal is not None else AVG_COST_NORMAL
    cv = avg_cost_vip if avg_cost_vip is not None else AVG_COST_VIP
    op_pct = operating_cost_pct if operating_cost_pct is not None else OPERATING_PCT
    cr = completion_rate if completion_rate is not None else COMPLETION_RATE

    if vip_ratio is not None:
        n_vip = int(n_total * vip_ratio)
        n_normal = n_total - n_vip
    else:
        n_normal = n_total // 2
        n_vip = n_total - n_normal

    # 调整分润比例：奖励比例变化时，从平台分成扣除
    normal_platform = max(0.05, 1.0 - rp_n - NORMAL_INDUSTRY_PCT - NORMAL_CHARITY_PCT - NORMAL_TECH_PCT - NORMAL_RESERVE_PCT)
    normal_funds = NORMAL_FUNDS_PCT
    vip_platform = max(0.05, 1.0 - rp_v - VIP_INDUSTRY_PCT - VIP_CHARITY_PCT - VIP_TECH_PCT - VIP_RESERVE_PCT)
    vip_funds = VIP_FUNDS_PCT

    # 树深度
    td_n = tree_depth_for_users(n_normal, BF_NORMAL)
    bf_v_eff = BF_VIP * VIP_FILL  # 1.5
    vip_per_root = n_vip / VIP_ROOTS
    td_v = tree_depth_for_users(vip_per_root, bf_v_eff) if vip_per_root > 1 else 1

    # ── 普通系统 ──
    eff_orders_n = n_normal * fn * cr
    sale_n = cn * markup
    profit_per_order_n = sale_n - cn
    gross_profit_n = eff_orders_n * profit_per_order_n

    platform_n = gross_profit_n * normal_platform
    seller_n = gross_profit_n * NORMAL_INDUSTRY_PCT
    funds_n = gross_profit_n * normal_funds
    reward_pool_n = gross_profit_n * rp_n

    if worst:
        reward_out_n = reward_pool_n
    else:
        tree_out_n, _, _ = calc_tree_reward_outflow_total(
            n_normal, BF_NORMAL, MAX_LAYERS_NORMAL, td_n,
            cn, markup, rp_n, fn)
        tree_rate_n = min(tree_out_n / reward_pool_n, 1.0) if reward_pool_n > 0 else 0
        unlock_n = calc_unlock_rate(fn, MAX_LAYERS_NORMAL)
        eff_rate_n = min(tree_rate_n, unlock_n)
        reward_out_n = reward_pool_n * eff_rate_n * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
    reward_return_n = reward_pool_n - reward_out_n

    # ── VIP系统 ──
    eff_orders_v = n_vip * fv * cr
    sale_v = cv * markup * VIP_DISCOUNT
    profit_per_order_v = sale_v - cv
    gross_profit_v = eff_orders_v * profit_per_order_v

    platform_v = gross_profit_v * vip_platform
    seller_v = gross_profit_v * VIP_INDUSTRY_PCT
    funds_v = gross_profit_v * vip_funds
    reward_pool_v = gross_profit_v * rp_v

    if worst:
        reward_out_v = reward_pool_v
    else:
        tree_out_v, _, _ = calc_tree_reward_outflow_total(
            vip_per_root, BF_VIP, MAX_LAYERS_VIP, td_v,
            cv, markup, rp_v, fv, VIP_DISCOUNT, VIP_FILL)
        # 10棵子树
        tree_out_v_total = tree_out_v * VIP_ROOTS
        tree_rate_v = min(tree_out_v_total / reward_pool_v, 1.0) if reward_pool_v > 0 else 0
        unlock_v = calc_unlock_rate(fv, MAX_LAYERS_VIP)
        eff_rate_v = min(tree_rate_v, unlock_v)
        reward_out_v = reward_pool_v * eff_rate_v * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
    reward_return_v = reward_pool_v - reward_out_v

    # VIP购买收入
    monthly_new_vip = n_vip * VIP_NEW_RATE
    vip_income = monthly_new_vip * VIP_PURCHASE_PROFIT
    referral_cost = monthly_new_vip * VIP_REFERRAL * VIP_REFERRAL_RATE

    # 换货成本
    total_orders = eff_orders_n + eff_orders_v
    replace_cost = total_orders * REPLACEMENT_RATE * AVG_SHIPPING

    # 运营成本（基于总营收）
    total_rev = n_normal * fn * sale_n + n_vip * fv * sale_v + monthly_new_vip * 399
    op_cost = total_rev * op_pct

    # 净利润
    total_platform_ctrl = platform_n + funds_n + platform_v + funds_v
    total_seller = seller_n + seller_v
    total_reward_out = reward_out_n + reward_out_v
    total_reward_return = reward_return_n + reward_return_v
    total_reward_pool = reward_pool_n + reward_pool_v

    net = (total_platform_ctrl + total_reward_return + vip_income
           - total_seller - total_reward_out - referral_cost
           - replace_cost - op_cost)

    net_margin = net / total_rev * 100 if total_rev > 0 else 0

    return {
        'n_total': n_total,
        'n_normal': n_normal,
        'n_vip': n_vip,
        'markup': markup,
        'worst': worst,
        'tree_depth_n': td_n,
        'tree_depth_v': td_v,
        # 收入
        'total_rev': total_rev,
        'gross_profit_n': gross_profit_n,
        'gross_profit_v': gross_profit_v,
        'gross_profit': gross_profit_n + gross_profit_v,
        # 分润
        'platform_n': platform_n,
        'platform_v': platform_v,
        'funds_n': funds_n,
        'funds_v': funds_v,
        'seller_n': seller_n,
        'seller_v': seller_v,
        'reward_pool_n': reward_pool_n,
        'reward_pool_v': reward_pool_v,
        'reward_pool': total_reward_pool,
        'reward_out_n': reward_out_n,
        'reward_out_v': reward_out_v,
        'reward_outflow': total_reward_out,
        'reward_return_n': reward_return_n,
        'reward_return_v': reward_return_v,
        'reward_return': total_reward_return,
        # 其他
        'platform_controlled': total_platform_ctrl,
        'seller_payout': total_seller,
        'vip_income': vip_income,
        'referral_cost': referral_cost,
        'replace_cost': replace_cost,
        'op_cost': op_cost,
        # 结果
        'net_profit': net,
        'net_margin': net_margin,
        # 人均
        'avg_reward_n': reward_out_n / n_normal if n_normal > 0 else 0,
        'avg_reward_v': reward_out_v / n_vip if n_vip > 0 else 0,
        # 每笔订单
        'sale_n': sale_n,
        'sale_v': sale_v,
        'profit_per_order_n': profit_per_order_n,
        'profit_per_order_v': profit_per_order_v,
        'eff_orders_n': eff_orders_n,
        'eff_orders_v': eff_orders_v,
    }


# ============================================================
# 逐层奖励分析
# ============================================================

def per_level_analysis(bf, max_layers, tree_depth, avg_cost, markup,
                       reward_pct, freq, vip_discount=1.0, fill_rate=1.0,
                       n_users_cap=None):
    """逐层分析每个用户的月均奖励

    返回列表: [{level, users, max_k, yearly_reward, monthly_reward}, ...]
    """
    bf_eff = bf * fill_rate
    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost
    rpo = profit * reward_pct

    results = []
    total_actual = 0

    for L in range(1, tree_depth + 1):
        users = int(round(bf_eff ** L))
        if n_users_cap is not None:
            if total_actual + users > n_users_cap:
                users = max(0, int(n_users_cap) - total_actual)
        total_actual += users
        if users <= 0:
            break

        max_k = min(max_layers, tree_depth - L)
        yearly = 0.0
        for k in range(1, max_k + 1):
            if L + k > tree_depth:
                break
            desc = bf_eff ** k
            months = math.ceil(k / freq)
            if months <= 12:
                yearly += desc * rpo

        monthly = yearly / 12.0
        results.append({
            'level': L,
            'users': users,
            'max_k': max_k,
            'yearly_reward': yearly,
            'monthly_reward': monthly,
        })

    return results, total_actual


# ============================================================
# 报告生成
# ============================================================

def wan(v):
    """金额转万元字符串"""
    return f"{v / 10000:,.2f}"


def wan0(v):
    """金额转万元字符串（整数）"""
    return f"{v / 10000:,.0f}"


def pct(v):
    """百分比字符串"""
    return f"{v:.2f}%"


def generate_report():
    """生成完整的综合测算报告"""

    lines = []

    def add(s=''):
        lines.append(s)

    def add_table_row(cells, align=None):
        """生成 Markdown 表格行"""
        lines.append('| ' + ' | '.join(str(c) for c in cells) + ' |')

    def add_table_sep(n, aligns=None):
        """生成 Markdown 表格分隔行"""
        if aligns:
            seps = []
            for a in aligns:
                if a == 'r':
                    seps.append('---:')
                elif a == 'c':
                    seps.append(':---:')
                else:
                    seps.append(':---')
            lines.append('| ' + ' | '.join(seps) + ' |')
        else:
            lines.append('| ' + ' | '.join(['---'] * n) + ' |')

    # ============================================================
    # 报告头
    # ============================================================

    add('# 农脉分润奖励系统 — 综合利润测算报告')
    add()
    add(f'> 生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}')
    add()
    add('## 参数设定')
    add()
    add('| 参数 | 普通用户 | VIP用户 |')
    add('| :--- | :--- | :--- |')
    add(f'| 树结构 | 2叉树, maxLayers=8 | 3叉树, 13层, {int(VIP_FILL*100)}%填充率, 10个根 |')
    add(f'| 用户比例 | 50% | 50% |')
    add(f'| 平均客单成本 | {AVG_COST_NORMAL:.0f}元 | {AVG_COST_VIP:.0f}元 |')
    add(f'| 月购买频率 | {FREQ_NORMAL:.0f}次 | {FREQ_VIP:.0f}次 |')
    add(f'| 奖励比例 | {NORMAL_REWARD_PCT*100:.0f}% | {VIP_REWARD_PCT*100:.0f}% |')
    add(f'| VIP折扣 | — | {VIP_DISCOUNT} |')
    add(f'| 加价率 | {", ".join(str(m) for m in MARKUPS)} | 同左 |')
    add(f'| 运营成本 | {OPERATING_PCT*100:.0f}% | 同左 |')
    add(f'| 订单完成率 | {COMPLETION_RATE*100:.0f}% | 同左 |')
    add(f'| VIP购买利润 | — | {VIP_PURCHASE_PROFIT:.0f}元/人 |')
    add(f'| 抽奖 | 无 | 无 |')
    add()
    add('**模式说明：**')
    add('- **最坏情况**：奖励池100%流出（所有奖励均被领取，无过期）')
    add('- **默认参数**：树结构流出 × 解锁率 × 95%活跃率 × 80%提现率')
    add('- 两种模式下订单完成率均为95%')
    add()
    add('---')
    add()

    # ============================================================
    # Section 1: 执行摘要
    # ============================================================

    add('## 一、执行摘要 — 月度净利润总表')
    add()
    add('> 这是最核心的决策参考表：不同用户规模 × 不同加价率 × 两种风险模式下的月度净利润。')
    add()

    for worst in [True, False]:
        mode_label = '最坏情况（100%奖励流出）' if worst else '默认参数（含过期/流失）'
        add(f'### {mode_label}')
        add()

        header = ['用户规模']
        for m in MARKUPS:
            header.append(f'加价{m} 净利润(万)')
            header.append(f'净利率')
        add_table_row(header)
        aligns = ['l'] + ['r', 'r'] * len(MARKUPS)
        add_table_sep(len(header), aligns)

        for n in SCALES:
            row = [f'{n//10000}万']
            for m in MARKUPS:
                r = run_scenario(n, m, worst)
                profit_str = wan(r['net_profit'])
                margin_str = pct(r['net_margin'])
                row.append(profit_str)
                row.append(margin_str)
            add_table_row(row)

        add()

    # 盈亏状态速查
    add('### 盈亏状态速查')
    add()
    header = ['用户规模']
    for m in MARKUPS:
        header.append(f'加价{m}(最坏)')
        header.append(f'加价{m}(默认)')
    add_table_row(header)
    add_table_sep(len(header), ['l'] + ['c'] * (len(MARKUPS) * 2))

    for n in SCALES:
        row = [f'{n//10000}万']
        for m in MARKUPS:
            rw = run_scenario(n, m, True)
            rd = run_scenario(n, m, False)
            sw = '盈利' if rw['net_profit'] > 0 else '**亏损**'
            sd = '盈利' if rd['net_profit'] > 0 else '**亏损**'
            row.append(f'{sw} ({pct(rw["net_margin"])})')
            row.append(f'{sd} ({pct(rd["net_margin"])})')
        add_table_row(row)

    add()
    add('---')
    add()

    # ============================================================
    # Section 2: 单笔订单经济学
    # ============================================================

    add('## 二、单笔订单经济学')
    add()
    add('每笔订单的资金流向拆解，展示平台在单笔交易中的收支结构。')
    add()

    for m in MARKUPS:
        add(f'### 加价率 = {m}')
        add()

        # 普通用户
        sale_n = AVG_COST_NORMAL * m
        profit_n = sale_n - AVG_COST_NORMAL
        plat_n = profit_n * NORMAL_PLATFORM_PCT
        funds_n = profit_n * NORMAL_FUNDS_PCT
        seller_n = profit_n * NORMAL_INDUSTRY_PCT
        reward_n = profit_n * NORMAL_REWARD_PCT
        # 最坏：奖励全流出
        net_worst_n = plat_n + funds_n - reward_n
        # 默认：奖励部分流出
        unlock_n = calc_unlock_rate(FREQ_NORMAL, MAX_LAYERS_NORMAL)
        reward_out_default_n = reward_n * unlock_n * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
        net_default_n = plat_n + funds_n - reward_out_default_n

        # VIP用户
        sale_v = AVG_COST_VIP * m * VIP_DISCOUNT
        profit_v = sale_v - AVG_COST_VIP
        plat_v = profit_v * VIP_PLATFORM_PCT
        funds_v = profit_v * VIP_FUNDS_PCT
        seller_v = profit_v * VIP_INDUSTRY_PCT
        reward_v = profit_v * VIP_REWARD_PCT
        net_worst_v = plat_v + funds_v - reward_v
        unlock_v = calc_unlock_rate(FREQ_VIP, MAX_LAYERS_VIP)
        reward_out_default_v = reward_v * unlock_v * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
        net_default_v = plat_v + funds_v - reward_out_default_v

        add('**普通用户订单：**')
        add()
        add(f'| 项目 | 金额 | 说明 |')
        add(f'| :--- | ---: | :--- |')
        add(f'| 成本 | ¥{AVG_COST_NORMAL:.2f} | 商品成本 |')
        add(f'| 售价 | ¥{sale_n:.2f} | 成本×{m} |')
        add(f'| **利润** | **¥{profit_n:.2f}** | 售价-成本 |')
        add(f'| 平台分成(50%) | ¥{plat_n:.2f} | 平台可控 |')
        add(f'| 基金池(18%) | ¥{funds_n:.2f} | 慈善8%+科技8%+备用2% |')
        add(f'| 卖家产业基金(16%) | ¥{seller_n:.2f} | 支出给卖家 |')
        add(f'| 奖励池(16%) | ¥{reward_n:.2f} | 分润奖励 |')
        add(f'| **平台净收(最坏)** | **¥{net_worst_n:.2f}** | 平台+基金-全部奖励 |')
        add(f'| **平台净收(默认)** | **¥{net_default_n:.2f}** | 奖励仅{unlock_n*DEFAULT_ACTIVE_RATE*DEFAULT_WITHDRAWAL_RATE*100:.0f}%流出 |')
        add()

        add('**VIP用户订单：**')
        add()
        add(f'| 项目 | 金额 | 说明 |')
        add(f'| :--- | ---: | :--- |')
        add(f'| 成本 | ¥{AVG_COST_VIP:.2f} | 商品成本 |')
        add(f'| 售价 | ¥{sale_v:.2f} | 成本×{m}×{VIP_DISCOUNT}折扣 |')
        add(f'| **利润** | **¥{profit_v:.2f}** | 售价-成本 |')
        add(f'| 平台分成(50%) | ¥{plat_v:.2f} | 平台可控 |')
        add(f'| 基金池(10%) | ¥{funds_v:.2f} | 慈善2%+科技2%+备用6% |')
        add(f'| 卖家产业基金(10%) | ¥{seller_v:.2f} | 支出给卖家 |')
        add(f'| 奖励池(30%) | ¥{reward_v:.2f} | 分润奖励 |')
        add(f'| **平台净收(最坏)** | **¥{net_worst_v:.2f}** | 平台+基金-全部奖励 |')
        add(f'| **平台净收(默认)** | **¥{net_default_v:.2f}** | 奖励仅{unlock_v*DEFAULT_ACTIVE_RATE*DEFAULT_WITHDRAWAL_RATE*100:.0f}%流出 |')
        add()

    add('---')
    add()

    # ============================================================
    # Section 3: 月度P&L明细（100万用户）
    # ============================================================

    add('## 三、月度P&L明细（100万用户）')
    add()
    add('以100万用户规模为例，展示完整的月度损益表。')
    add()

    for m in MARKUPS:
        add(f'### 加价率 = {m}')
        add()

        for worst in [True, False]:
            mode = '最坏情况' if worst else '默认参数'
            r = run_scenario(1_000_000, m, worst)

            add(f'#### {mode}')
            add()
            add(f'| 科目 | 金额(万元) | 备注 |')
            add(f'| :--- | ---: | :--- |')
            add(f'| **月总营收** | **{wan(r["total_rev"])}** | 含VIP礼包销售 |')
            add(f'| 普通系统毛利 | {wan(r["gross_profit_n"])} | {r["n_normal"]//10000}万人×{FREQ_NORMAL:.0f}次×¥{r["profit_per_order_n"]:.1f} |')
            add(f'| VIP系统毛利 | {wan(r["gross_profit_v"])} | {r["n_vip"]//10000}万人×{FREQ_VIP:.0f}次×¥{r["profit_per_order_v"]:.1f} |')
            add(f'| **总毛利** | **{wan(r["gross_profit"])}** | |')
            add(f'| | | |')
            add(f'| 平台可控收入(含基金) | +{wan(r["platform_controlled"])} | 平台分成+基金池 |')
            add(f'| 奖励过期回流 | +{wan(r["reward_return"])} | 未领取/过期奖励 |')
            add(f'| VIP购买收入 | +{wan(r["vip_income"])} | 新增VIP利润 |')
            add(f'| | | |')
            add(f'| 卖家产业基金 | -{wan(r["seller_payout"])} | 支出 |')
            add(f'| 奖励提现流出 | -{wan(r["reward_outflow"])} | 用户提走 |')
            add(f'| VIP推荐奖励 | -{wan(r["referral_cost"])} | 推荐人奖金 |')
            add(f'| 换货成本 | -{wan(r["replace_cost"])} | 退换运费 |')
            add(f'| 运营成本 | -{wan(r["op_cost"])} | 营收×{OPERATING_PCT*100:.0f}% |')
            add(f'| | | |')
            add(f'| **月度净利润** | **{wan(r["net_profit"])}** | |')
            add(f'| **净利率** | **{pct(r["net_margin"])}** | |')
            add(f'| 奖励池总量 | {wan(r["reward_pool"])} | |')
            out_rate = r['reward_outflow'] / r['reward_pool'] * 100 if r['reward_pool'] > 0 else 0
            add(f'| 奖励流出率 | {pct(out_rate)} | |')
            add()

    add('---')
    add()

    # ============================================================
    # Section 4: 逐层奖励分析
    # ============================================================

    add('## 四、逐层奖励分析')
    add()
    add('展示每一层用户的数量和月均可获得的奖励金额。按加价率1.20、1.25、1.30分别展示。')
    add()

    for m in MARKUPS:
        sale_n = AVG_COST_NORMAL * m
        profit_n = sale_n - AVG_COST_NORMAL
        sale_v = AVG_COST_VIP * m * VIP_DISCOUNT
        profit_v = sale_v - AVG_COST_VIP
        rpo_n = profit_n * NORMAL_REWARD_PCT
        rpo_v = profit_v * VIP_REWARD_PCT

        add(f'### 加价率 = {m}')
        add()
        add(f'普通订单: 售价¥{sale_n:.0f}, 利润¥{profit_n:.0f}, 每笔奖励¥{rpo_n:.2f}')
        add(f'VIP订单: 售价¥{sale_v:.0f}, 利润¥{profit_v:.1f}, 每笔奖励¥{rpo_v:.2f}')
        add()

        for worst in [True, False]:
            mode = '最坏情况' if worst else '默认参数'
            add(f'#### {mode}')
            add()

            # 普通树（2叉，maxLayers=8）
            add(f'**普通树（2叉, maxLayers={MAX_LAYERS_NORMAL}）**')
            add()

            n_normal = 500_000
            td_n = tree_depth_for_users(n_normal, BF_NORMAL)

            results_n, total_n = per_level_analysis(
                bf=BF_NORMAL, max_layers=MAX_LAYERS_NORMAL, tree_depth=td_n,
                avg_cost=AVG_COST_NORMAL, markup=m, reward_pct=NORMAL_REWARD_PCT,
                freq=FREQ_NORMAL, n_users_cap=n_normal)

            add(f'树深度: {td_n}层, 用户总数: {n_normal:,}')
            add()
            add(f'| 层级 | 该层用户数 | 占比 | 可收奖层数 | 月均奖励/人(元) | 说明 |')
            add(f'| ---: | ---: | ---: | ---: | ---: | :--- |')

            for r in results_n:
                pct_str = f'{r["users"]/total_n*100:.1f}%' if total_n > 0 else '0%'
                if worst:
                    monthly = r['monthly_reward']
                else:
                    unlock = calc_unlock_rate(FREQ_NORMAL, MAX_LAYERS_NORMAL)
                    monthly = r['monthly_reward'] * unlock * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
                note = ''
                if r['max_k'] == 0:
                    note = '底层，无后代'
                elif r['level'] <= 3:
                    note = '早期用户，奖励丰厚'
                add(f'| {r["level"]} | {r["users"]:,} | {pct_str} | {r["max_k"]} | {monthly:,.2f} | {note} |')

            add()

            # VIP树
            add(f'**VIP树（3叉×{int(VIP_FILL*100)}%填充, maxLayers={MAX_LAYERS_VIP}, 10个根节点）**')
            add()

            n_vip = 500_000
            vip_per_root = n_vip // VIP_ROOTS
            td_v = tree_depth_for_users(vip_per_root, BF_VIP * VIP_FILL)

            results_v, total_v = per_level_analysis(
                bf=BF_VIP, max_layers=MAX_LAYERS_VIP, tree_depth=td_v,
                avg_cost=AVG_COST_VIP, markup=m, reward_pct=VIP_REWARD_PCT,
                freq=FREQ_VIP, vip_discount=VIP_DISCOUNT, fill_rate=VIP_FILL,
                n_users_cap=vip_per_root)

            add(f'每棵子树深度: {td_v}层, 每棵用户数: {vip_per_root:,}, 总VIP: {n_vip:,}')
            add()
            add(f'| 层级 | 每棵该层用户 | 10棵总用户 | 占比 | 可收奖层数 | 月均奖励/人(元) | 说明 |')
            add(f'| ---: | ---: | ---: | ---: | ---: | ---: | :--- |')

            for r in results_v:
                total_users_10 = r['users'] * VIP_ROOTS
                pct_str = f'{r["users"]/total_v*100:.1f}%' if total_v > 0 else '0%'
                if worst:
                    monthly = r['monthly_reward']
                else:
                    unlock = calc_unlock_rate(FREQ_VIP, MAX_LAYERS_VIP)
                    monthly = r['monthly_reward'] * unlock * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
                note = ''
                if r['max_k'] == 0:
                    note = '底层，无后代'
                elif r['level'] <= 3:
                    note = '早期VIP'
                add(f'| {r["level"]} | {r["users"]:,} | {total_users_10:,} | {pct_str} | {r["max_k"]} | {monthly:,.2f} | {note} |')

            add()

    add('---')
    add()

    # ============================================================
    # Section 5: 敏感性分析
    # ============================================================

    add('## 五、敏感性分析（龙卷风排名）')
    add()
    add('基线：加价率=1.30, 100万用户，分别将每个参数上下浮动20%，观察净利润变化。')
    add()

    baseline = run_scenario(1_000_000, 1.30, True)  # 最坏情况
    baseline_net = baseline['net_profit']
    baseline_default = run_scenario(1_000_000, 1.30, False)
    baseline_default_net = baseline_default['net_profit']

    params_to_test = [
        ('加价率(markup)', 'markup', 1.30, 1.30*0.8, 1.30*1.2),
        ('普通奖励比例', 'normal_reward_pct', 0.16, 0.16*0.8, 0.16*1.2),
        ('VIP奖励比例', 'vip_reward_pct', 0.30, 0.30*0.8, 0.30*1.2),
        ('普通购买频率', 'freq_normal', 3.0, 3.0*0.8, 3.0*1.2),
        ('VIP购买频率', 'freq_vip', 6.0, 6.0*0.8, 6.0*1.2),
        ('普通客单成本', 'avg_cost_normal', 80.0, 80.0*0.8, 80.0*1.2),
        ('VIP客单成本', 'avg_cost_vip', 120.0, 120.0*0.8, 120.0*1.2),
        ('运营成本比例', 'operating_cost_pct', 0.05, 0.05*0.8, 0.05*1.2),
    ]

    for worst in [True, False]:
        mode = '最坏情况' if worst else '默认参数'
        base_net = baseline_net if worst else baseline_default_net

        add(f'### {mode}')
        add()
        add(f'基线净利润: **{wan(base_net)}万元**')
        add()

        sensitivity = []
        for name, key, base_val, low_val, high_val in params_to_test:
            kwargs_low = {key: low_val}
            kwargs_high = {key: high_val}
            # markup is special - it's a positional arg
            if key == 'markup':
                r_low = run_scenario(1_000_000, low_val, worst)
                r_high = run_scenario(1_000_000, high_val, worst)
            else:
                r_low = run_scenario(1_000_000, 1.30, worst, **kwargs_low)
                r_high = run_scenario(1_000_000, 1.30, worst, **kwargs_high)

            net_low = r_low['net_profit']
            net_high = r_high['net_profit']
            swing = abs(net_high - net_low)
            sensitivity.append({
                'name': name,
                'base': base_val,
                'low': low_val,
                'high': high_val,
                'net_low': net_low,
                'net_high': net_high,
                'swing': swing,
                'change_low': (net_low - base_net) / abs(base_net) * 100 if base_net != 0 else 0,
                'change_high': (net_high - base_net) / abs(base_net) * 100 if base_net != 0 else 0,
            })

        # 按影响幅度排序
        sensitivity.sort(key=lambda x: x['swing'], reverse=True)

        add(f'| 排名 | 参数 | -20%值 | +20%值 | -20%净利(万) | +20%净利(万) | 影响幅度(万) | 影响比例 |')
        add(f'| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: |')

        for i, s in enumerate(sensitivity, 1):
            add(f'| {i} | {s["name"]} | {s["low"]:.3f} | {s["high"]:.3f} | '
                f'{wan(s["net_low"])} | {wan(s["net_high"])} | '
                f'{wan(s["swing"])} | {pct(s["swing"]/abs(base_net)*100 if base_net != 0 else 0)} |')

        add()

        # 龙卷风文本图
        add('**龙卷风排名（影响幅度从大到小）：**')
        add()
        add('```')
        max_bar = 40
        max_swing = sensitivity[0]['swing'] if sensitivity else 1
        for i, s in enumerate(sensitivity, 1):
            bar_len = int(s['swing'] / max_swing * max_bar)
            bar = '█' * bar_len
            add(f'  {i}. {s["name"]:<16} {bar} ({wan(s["swing"])}万)')
        add('```')
        add()

    add('---')
    add()

    # ============================================================
    # Section 6: 人均经济学
    # ============================================================

    add('## 六、人均经济学')
    add()
    add('平台在每个用户身上的月度收支。')
    add()

    for m in MARKUPS:
        add(f'### 加价率 = {m}')
        add()

        for worst in [True, False]:
            mode = '最坏情况' if worst else '默认参数'
            r = run_scenario(1_000_000, m, worst)

            n_normal = r['n_normal']
            n_vip = r['n_vip']

            # 普通用户人均
            rev_per_normal = n_normal * FREQ_NORMAL * (AVG_COST_NORMAL * m) / n_normal  # = FREQ * sale
            cost_per_normal = n_normal * FREQ_NORMAL * AVG_COST_NORMAL / n_normal
            profit_per_normal = r['gross_profit_n'] / n_normal
            platform_per_normal = (r['platform_n'] + r['funds_n']) / n_normal
            reward_per_normal = r['avg_reward_n']
            seller_per_normal = r['seller_n'] / n_normal
            # 运营成本按人头分摊（简化）
            op_per_user = r['op_cost'] / r['n_total']
            replace_per_user = r['replace_cost'] / r['n_total']
            net_per_normal = platform_per_normal - reward_per_normal - op_per_user - replace_per_user

            # VIP用户人均
            rev_per_vip = FREQ_VIP * (AVG_COST_VIP * m * VIP_DISCOUNT)
            profit_per_vip = r['gross_profit_v'] / n_vip
            platform_per_vip = (r['platform_v'] + r['funds_v']) / n_vip
            reward_per_vip = r['avg_reward_v']
            seller_per_vip = r['seller_v'] / n_vip
            net_per_vip = platform_per_vip - reward_per_vip - op_per_user - replace_per_user

            # ROI = 平台净收 / 奖励支出
            roi_normal = net_per_normal / reward_per_normal if reward_per_normal > 0 else float('inf')
            roi_vip = net_per_vip / reward_per_vip if reward_per_vip > 0 else float('inf')

            add(f'#### {mode}')
            add()
            add(f'| 指标 | 普通用户 | VIP用户 |')
            add(f'| :--- | ---: | ---: |')
            add(f'| 月均消费额 | ¥{rev_per_normal:,.2f} | ¥{rev_per_vip:,.2f} |')
            add(f'| 月均毛利 | ¥{profit_per_normal:,.2f} | ¥{profit_per_vip:,.2f} |')
            add(f'| 平台可控收入/人 | ¥{platform_per_normal:,.2f} | ¥{platform_per_vip:,.2f} |')
            add(f'| 奖励支出/人 | ¥{reward_per_normal:,.2f} | ¥{reward_per_vip:,.2f} |')
            add(f'| 卖家分成/人 | ¥{seller_per_normal:,.2f} | ¥{seller_per_vip:,.2f} |')
            add(f'| 运营+换货成本/人 | ¥{op_per_user + replace_per_user:,.2f} | ¥{op_per_user + replace_per_user:,.2f} |')
            add(f'| **平台净收/人** | **¥{net_per_normal:,.2f}** | **¥{net_per_vip:,.2f}** |')
            add(f'| **奖励ROI** | **{roi_normal:,.2f}** | **{roi_vip:,.2f}** |')
            add()

    add('---')
    add()

    # ============================================================
    # Section 7: 盈亏平衡分析
    # ============================================================

    add('## 七、盈亏平衡分析')
    add()

    # 7a: 最大可承受奖励比例
    add('### 最大可承受奖励比例（100万用户，最坏情况）')
    add()
    add('在其他参数不变的情况下，奖励比例最高能到多少平台仍不亏损？')
    add()

    add(f'| 加价率 | 普通最大奖励比例 | VIP最大奖励比例 |')
    add(f'| ---: | ---: | ---: |')

    for m in MARKUPS:
        # 二分法求普通最大奖励比例
        lo, hi = 0.0, 1.0
        for _ in range(50):
            mid = (lo + hi) / 2
            r = run_scenario(1_000_000, m, True, normal_reward_pct=mid)
            if r['net_profit'] > 0:
                lo = mid
            else:
                hi = mid
        max_normal_rp = lo

        # 二分法求VIP最大奖励比例
        lo, hi = 0.0, 1.0
        for _ in range(50):
            mid = (lo + hi) / 2
            r = run_scenario(1_000_000, m, True, vip_reward_pct=mid)
            if r['net_profit'] > 0:
                lo = mid
            else:
                hi = mid
        max_vip_rp = lo

        add(f'| {m} | {max_normal_rp*100:.1f}% | {max_vip_rp*100:.1f}% |')

    add()

    # 7b: 最低加价率
    add('### 最低加价率（100万用户）')
    add()
    add('平台要保持盈利，加价率最低需要多少？')
    add()

    add(f'| 模式 | 最低加价率 |')
    add(f'| :--- | ---: |')

    for worst in [True, False]:
        mode = '最坏情况' if worst else '默认参数'
        lo, hi = 1.001, 3.0
        for _ in range(50):
            mid = (lo + hi) / 2
            r = run_scenario(1_000_000, mid, worst)
            if r['net_profit'] > 0:
                hi = mid
            else:
                lo = mid
        min_markup = hi
        add(f'| {mode} | {min_markup:.4f} |')

    add()
    add('---')
    add()

    # ============================================================
    # Section 8: 风险评估
    # ============================================================

    add('## 八、风险评估')
    add()

    # 8a: 奖励流出翻倍
    add('### 场景A：奖励流出翻倍（从默认翻倍）')
    add()
    add('如果默认参数下的奖励流出量翻倍，会发生什么？')
    add()

    add(f'| 加价率 | 默认净利(万) | 流出翻倍净利(万) | 变化 |')
    add(f'| ---: | ---: | ---: | ---: |')

    for m in MARKUPS:
        r_default = run_scenario(1_000_000, m, False)
        # 流出翻倍 = 从默认向最坏方向移动
        # 简化计算：额外扣除一倍的默认奖励流出
        extra_outflow = r_default['reward_outflow']
        net_doubled = r_default['net_profit'] - extra_outflow
        change = (net_doubled - r_default['net_profit']) / abs(r_default['net_profit']) * 100 if r_default['net_profit'] != 0 else 0
        add(f'| {m} | {wan(r_default["net_profit"])} | {wan(net_doubled)} | {change:+.1f}% |')

    add()

    # 8b: 购买频率下降50%
    add('### 场景B：购买频率下降50%')
    add()

    add(f'| 加价率 | 模式 | 正常净利(万) | 频率-50%净利(万) | 变化 |')
    add(f'| ---: | :--- | ---: | ---: | ---: |')

    for m in MARKUPS:
        for worst in [True, False]:
            mode = '最坏' if worst else '默认'
            r_normal = run_scenario(1_000_000, m, worst)
            r_half = run_scenario(1_000_000, m, worst,
                                   freq_normal=FREQ_NORMAL * 0.5,
                                   freq_vip=FREQ_VIP * 0.5)
            change = (r_half['net_profit'] - r_normal['net_profit']) / abs(r_normal['net_profit']) * 100 if r_normal['net_profit'] != 0 else 0
            add(f'| {m} | {mode} | {wan(r_normal["net_profit"])} | {wan(r_half["net_profit"])} | {change:+.1f}% |')

    add()

    # 8c: VIP比例变化
    add('### 场景C：VIP用户比例变化')
    add()
    add('将普通:VIP比例从50:50调整为30:70和70:30。')
    add()

    add(f'| 加价率 | 模式 | 50:50净利(万) | 30:70净利(万) | 70:30净利(万) |')
    add(f'| ---: | :--- | ---: | ---: | ---: |')

    for m in MARKUPS:
        for worst in [True, False]:
            mode = '最坏' if worst else '默认'
            r_50 = run_scenario(1_000_000, m, worst)
            r_30_70 = run_scenario(1_000_000, m, worst, vip_ratio=0.70)
            r_70_30 = run_scenario(1_000_000, m, worst, vip_ratio=0.30)
            add(f'| {m} | {mode} | {wan(r_50["net_profit"])} | {wan(r_30_70["net_profit"])} | {wan(r_70_30["net_profit"])} |')

    add()

    # 8d: 综合极端场景
    add('### 场景D：综合极端场景（最坏×频率-50%×VIP比例70%）')
    add()

    add(f'| 加价率 | 正常最坏(万) | 极端场景(万) | 是否亏损 |')
    add(f'| ---: | ---: | ---: | :--- |')

    for m in MARKUPS:
        r_normal = run_scenario(1_000_000, m, True)
        r_extreme = run_scenario(1_000_000, m, True,
                                  freq_normal=FREQ_NORMAL * 0.5,
                                  freq_vip=FREQ_VIP * 0.5,
                                  vip_ratio=0.70)
        status = '亏损' if r_extreme['net_profit'] < 0 else '盈利'
        add(f'| {m} | {wan(r_normal["net_profit"])} | {wan(r_extreme["net_profit"])} | {status} |')

    add()
    add('---')
    add()

    # ============================================================
    # 结语
    # ============================================================

    add('## 核心结论')
    add()

    # 计算关键指标
    r_130_worst = run_scenario(1_000_000, 1.30, True)
    r_130_default = run_scenario(1_000_000, 1.30, False)

    add(f'1. **盈利能力**：在100万用户、加价率1.30的情况下，最坏情况月净利润为 **{wan(r_130_worst["net_profit"])}万元**'
        f'（净利率{pct(r_130_worst["net_margin"])}），默认参数为 **{wan(r_130_default["net_profit"])}万元**'
        f'（净利率{pct(r_130_default["net_margin"])}）。')
    add()

    # 盈亏分界
    all_profitable = True
    for m in MARKUPS:
        r = run_scenario(1_000_000, m, True)
        if r['net_profit'] <= 0:
            all_profitable = False
            break
    if all_profitable:
        add(f'2. **盈亏安全**：在所有测试的加价率（{MARKUPS}）和用户规模下，即使最坏情况平台也保持盈利。')
    else:
        breakeven_markups = []
        for m in MARKUPS:
            r = run_scenario(1_000_000, m, True)
            if r['net_profit'] <= 0:
                breakeven_markups.append(m)
        add(f'2. **盈亏风险**：加价率 {breakeven_markups} 在最坏情况下存在亏损风险。')
    add()

    add(f'3. **敏感度**：加价率(markup)是影响利润最大的单一参数，其次是VIP客单成本和购买频率。')
    add()
    add(f'4. **VIP系统**：VIP用户虽然享受折扣且奖励比例更高(30% vs 16%)，但由于购买频率高(6次 vs 3次)、'
        f'客单价高(120元 vs 80元)，对平台总利润贡献更大。')
    add()
    add(f'5. **风险缓冲**：从最坏情况到默认参数，净利率提升显著，说明树结构的解锁机制和过期机制为平台提供了有效的风险缓冲。')
    add()

    return '\n'.join(lines)


# ============================================================
# 主入口
# ============================================================

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print('=' * 60)
    print('  农脉分润奖励系统 — 综合利润测算报告生成器')
    print('=' * 60)
    print()

    # 生成报告
    print('正在计算所有场景...')
    report = generate_report()

    # 保存
    report_path = os.path.join(OUTPUT_DIR, '综合测算报告.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)

    print(f'报告已保存: {report_path}')
    print()

    # 终端打印关键结果
    print('=' * 60)
    print('  关键结果摘要')
    print('=' * 60)
    print()

    print('月度净利润（万元）:')
    print()
    print(f'  {"用户规模":<10}', end='')
    for m in MARKUPS:
        print(f'  {"加价"+str(m)+"(最坏)":>16}  {"加价"+str(m)+"(默认)":>16}', end='')
    print()
    print('  ' + '-' * (10 + 34 * len(MARKUPS)))

    for n in SCALES:
        line = f'  {n//10000:>6}万  '
        for m in MARKUPS:
            rw = run_scenario(n, m, True)
            rd = run_scenario(n, m, False)
            line += f'  {rw["net_profit"]/10000:>12,.0f}万  {rd["net_profit"]/10000:>12,.0f}万'
        print(line)

    print()

    # 100万用户 详细
    print('100万用户 加价率1.30 详细:')
    print()
    for worst in [True, False]:
        mode = '最坏' if worst else '默认'
        r = run_scenario(1_000_000, 1.30, worst)
        print(f'  [{mode}] 净利润: ¥{r["net_profit"]/10000:,.0f}万  净利率: {r["net_margin"]:.2f}%  '
              f'普通人均奖: ¥{r["avg_reward_n"]:.2f}/月  VIP人均奖: ¥{r["avg_reward_v"]:.2f}/月')

    print()
    print(f'报告路径: {report_path}')
    print('完成!')


if __name__ == '__main__':
    main()
