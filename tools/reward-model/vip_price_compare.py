#!/usr/bin/env python3
"""
VIP礼包价格方案对比报告

对比3种VIP定价方案：
  A: 399元，VIP奖励30%
  B: 899元，VIP奖励35%
  C: 1599元，VIP奖励40%

其他参数不变。生成对比报告 + PDF。
"""

import os
import math
from datetime import datetime

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')

# ============================================================
# 固定参数（与满树版一致）
# ============================================================

SCALES = [100_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000, 10_000_000]
MARKUPS = [1.20, 1.25, 1.30]

NORMAL_PLATFORM_PCT = 0.50
NORMAL_REWARD_PCT = 0.16
NORMAL_INDUSTRY_PCT = 0.16
NORMAL_FUNDS_PCT = 0.18

AVG_COST_NORMAL = 80.0
AVG_COST_VIP = 120.0
FREQ_NORMAL = 3.0
FREQ_VIP = 6.0
VIP_DISCOUNT = 0.95
COMPLETION_RATE = 0.95

BF_NORMAL = 2
MAX_LAYERS_NORMAL = 8
BF_VIP = 3
MAX_LAYERS_VIP = 13
VIP_FILL = 1.00
VIP_ROOTS = 10

VIP_REFERRAL = 50.0
VIP_REFERRAL_RATE = 0.70
VIP_NEW_RATE = 0.02
OPERATING_PCT = 0.05
REPLACEMENT_RATE = 0.03
AVG_SHIPPING = 8.0

DEFAULT_ACTIVE_RATE = 0.95
DEFAULT_WITHDRAWAL_RATE = 0.80

# 3种方案
PLANS = [
    {'name': '方案A', 'vip_price': 399, 'vip_profit': 100, 'vip_reward_pct': 0.30,
     'vip_platform_pct': 0.50, 'vip_industry_pct': 0.10, 'vip_funds_pct': 0.10,
     'desc': '399元/30%奖励'},
    {'name': '方案B', 'vip_price': 899, 'vip_profit': 450, 'vip_reward_pct': 0.35,
     'vip_platform_pct': 0.45, 'vip_industry_pct': 0.10, 'vip_funds_pct': 0.10,
     'desc': '899元/35%奖励'},
    {'name': '方案C', 'vip_price': 1599, 'vip_profit': 800, 'vip_reward_pct': 0.40,
     'vip_platform_pct': 0.40, 'vip_industry_pct': 0.10, 'vip_funds_pct': 0.10,
     'desc': '1599元/40%奖励'},
]


def tree_depth_for_users(n, bf):
    if n <= 1 or bf <= 1:
        return max(1, int(n))
    return int(math.ceil(math.log(max(n * (bf - 1) + 1, 2)) / math.log(bf)))


def calc_unlock_rate(freq, max_layers):
    return min(freq * 1.0, max_layers) / max_layers


def calc_tree_outflow(n_users, bf, max_layers, td, cost, markup, reward_pct, freq,
                      discount=1.0, fill=1.0):
    bf_eff = bf * fill
    sale = cost * markup * discount
    profit = sale - cost
    if profit <= 0:
        return 0, 0
    rpo = profit * reward_pct
    total = 0
    actual = 0
    for L in range(1, td + 1):
        u = int(round(bf_eff ** L))
        if actual + u > n_users:
            u = max(0, n_users - actual)
        actual += u
        if u <= 0:
            break
        mk = min(max_layers, td - L)
        y = sum(bf_eff ** k * rpo for k in range(1, mk + 1)
                if L + k <= td and math.ceil(k / freq) <= 12)
        total += y / 12.0 * u
    avg = total / actual if actual > 0 else 0
    return total, avg


def run_scenario(n_total, markup, plan, worst=True):
    n_normal = n_total // 2
    n_vip = n_total - n_normal

    sale_n = AVG_COST_NORMAL * markup
    profit_per_n = sale_n - AVG_COST_NORMAL
    sale_v = AVG_COST_VIP * markup * VIP_DISCOUNT
    profit_per_v = sale_v - AVG_COST_VIP

    eff_orders_n = n_normal * FREQ_NORMAL * COMPLETION_RATE
    eff_orders_v = n_vip * FREQ_VIP * COMPLETION_RATE

    profit_n = eff_orders_n * profit_per_n
    profit_v = eff_orders_v * profit_per_v

    vip_reward_pct = plan['vip_reward_pct']
    vip_platform_pct = plan['vip_platform_pct']
    vip_industry_pct = plan['vip_industry_pct']
    vip_funds_pct = plan['vip_funds_pct']

    platform_n = profit_n * (NORMAL_PLATFORM_PCT + NORMAL_FUNDS_PCT)
    seller_n = profit_n * NORMAL_INDUSTRY_PCT
    reward_pool_n = profit_n * NORMAL_REWARD_PCT

    platform_v = profit_v * (vip_platform_pct + vip_funds_pct)
    seller_v = profit_v * vip_industry_pct
    reward_pool_v = profit_v * vip_reward_pct

    if worst:
        reward_out_n = reward_pool_n
        reward_out_v = reward_pool_v
    else:
        td_n = tree_depth_for_users(n_normal, BF_NORMAL)
        tree_out_n, _ = calc_tree_outflow(n_normal, BF_NORMAL, MAX_LAYERS_NORMAL, td_n,
                                           AVG_COST_NORMAL, markup, NORMAL_REWARD_PCT, FREQ_NORMAL)
        tree_rate_n = min(tree_out_n / reward_pool_n, 1.0) if reward_pool_n > 0 else 0
        unlock_n = calc_unlock_rate(FREQ_NORMAL, MAX_LAYERS_NORMAL)
        eff_n = min(tree_rate_n, unlock_n)
        reward_out_n = reward_pool_n * eff_n * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE

        bf_eff = BF_VIP * VIP_FILL
        vip_per_root = n_vip // VIP_ROOTS
        td_v = tree_depth_for_users(vip_per_root, bf_eff) if vip_per_root > 1 else 1
        tree_out_v, _ = calc_tree_outflow(vip_per_root, BF_VIP, MAX_LAYERS_VIP, td_v,
                                           AVG_COST_VIP, markup, vip_reward_pct, FREQ_VIP,
                                           VIP_DISCOUNT, VIP_FILL)
        tree_out_v *= VIP_ROOTS
        tree_rate_v = min(tree_out_v / reward_pool_v, 1.0) if reward_pool_v > 0 else 0
        unlock_v = calc_unlock_rate(FREQ_VIP, MAX_LAYERS_VIP)
        eff_v = min(tree_rate_v, unlock_v)
        reward_out_v = reward_pool_v * eff_v * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE

    reward_return_n = reward_pool_n - reward_out_n
    reward_return_v = reward_pool_v - reward_out_v

    new_vips = n_vip * VIP_NEW_RATE
    vip_income = new_vips * plan['vip_profit']
    referral_cost = new_vips * VIP_REFERRAL * VIP_REFERRAL_RATE

    total_orders = eff_orders_n + eff_orders_v
    replace_cost = total_orders * REPLACEMENT_RATE * AVG_SHIPPING

    total_rev = n_normal * FREQ_NORMAL * sale_n + n_vip * FREQ_VIP * sale_v + new_vips * plan['vip_price']
    op_cost = total_rev * OPERATING_PCT

    net = (platform_n + reward_return_n + platform_v + reward_return_v
           + vip_income - seller_n - seller_v - reward_out_n - reward_out_v
           - referral_cost - replace_cost - op_cost)

    return {
        'net_profit': net,
        'net_margin': net / total_rev * 100 if total_rev > 0 else 0,
        'total_rev': total_rev,
        'profit_n': profit_n, 'profit_v': profit_v,
        'platform': platform_n + platform_v,
        'seller': seller_n + seller_v,
        'reward_pool': reward_pool_n + reward_pool_v,
        'reward_out': reward_out_n + reward_out_v,
        'reward_return': reward_return_n + reward_return_v,
        'vip_income': vip_income,
        'referral_cost': referral_cost,
        'replace_cost': replace_cost,
        'op_cost': op_cost,
        'avg_reward_n': reward_out_n / n_normal if n_normal > 0 else 0,
        'avg_reward_v': reward_out_v / n_vip if n_vip > 0 else 0,
    }


def wan(v):
    return f'{v / 10000:,.0f}'


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    lines = []
    def add(s=''):
        lines.append(s)

    add('# VIP礼包定价方案对比报告')
    add()
    add(f'> 生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}')
    add()

    add('## 方案定义')
    add()
    add('| 方案 | VIP售价 | 平台利润 | VIP奖励比例 | VIP平台分成 | 说明 |')
    add('| :--- | ---: | ---: | ---: | ---: | :--- |')
    for p in PLANS:
        add(f'| **{p["name"]}** | ¥{p["vip_price"]} | ¥{p["vip_profit"]} | '
            f'{p["vip_reward_pct"]*100:.0f}% | {p["vip_platform_pct"]*100:.0f}% | {p["desc"]} |')
    add()
    add('其他参数不变：普通树2叉/ML=8，VIP树3叉满树/ML=13，普通:VIP=50:50，无抽奖')
    add()
    add('---')
    add()

    # ============================================================
    # Section 1: 月度净利润总表对比
    # ============================================================
    add('## 一、月度净利润对比')
    add()

    for worst in [True, False]:
        mode = '最坏情况（100%奖励流出）' if worst else '默认参数（含过期/流失）'
        add(f'### {mode}')
        add()

        for markup in MARKUPS:
            add(f'**加价率 = {markup}**')
            add()
            header = '| 用户规模 |'
            sep = '| :--- |'
            for p in PLANS:
                header += f' {p["name"]}净利润(万) | {p["name"]}净利率 |'
                sep += ' ---: | ---: |'
            add(header)
            add(sep)

            for n in SCALES:
                row = f'| {n//10000}万 |'
                for p in PLANS:
                    r = run_scenario(n, markup, p, worst)
                    row += f' {wan(r["net_profit"])} | {r["net_margin"]:.1f}% |'
                add(row)
            add()

    add('---')
    add()

    # ============================================================
    # Section 2: 单笔VIP订单对比
    # ============================================================
    add('## 二、单笔VIP订单经济学对比')
    add()

    for markup in MARKUPS:
        sale_v = AVG_COST_VIP * markup * VIP_DISCOUNT
        profit_v = sale_v - AVG_COST_VIP

        add(f'### 加价率 = {markup}（VIP售价¥{sale_v:.0f}，利润¥{profit_v:.1f}）')
        add()
        add('| 项目 | 方案A(30%) | 方案B(35%) | 方案C(40%) |')
        add('| :--- | ---: | ---: | ---: |')
        add(f'| 利润 | ¥{profit_v:.2f} | ¥{profit_v:.2f} | ¥{profit_v:.2f} |')

        for p in PLANS:
            rp = p['vip_reward_pct']
            pp = p['vip_platform_pct']
            fp = p['vip_funds_pct']
            ip = p['vip_industry_pct']
        # 按列输出
        rewards = [profit_v * p['vip_reward_pct'] for p in PLANS]
        platforms = [profit_v * p['vip_platform_pct'] for p in PLANS]
        funds = [profit_v * p['vip_funds_pct'] for p in PLANS]
        sellers = [profit_v * p['vip_industry_pct'] for p in PLANS]
        nets_worst = [profit_v * (p['vip_platform_pct'] + p['vip_funds_pct']) - profit_v * p['vip_reward_pct'] for p in PLANS]
        # 默认
        unlock = calc_unlock_rate(FREQ_VIP, MAX_LAYERS_VIP)
        eff_rate = unlock * DEFAULT_ACTIVE_RATE * DEFAULT_WITHDRAWAL_RATE
        nets_default = [profit_v * (p['vip_platform_pct'] + p['vip_funds_pct']) - profit_v * p['vip_reward_pct'] * eff_rate for p in PLANS]

        add(f'| 平台分成 | ¥{platforms[0]:.2f}(50%) | ¥{platforms[1]:.2f}(45%) | ¥{platforms[2]:.2f}(40%) |')
        add(f'| 基金池 | ¥{funds[0]:.2f}(10%) | ¥{funds[1]:.2f}(10%) | ¥{funds[2]:.2f}(10%) |')
        add(f'| 卖家产业基金 | ¥{sellers[0]:.2f}(10%) | ¥{sellers[1]:.2f}(10%) | ¥{sellers[2]:.2f}(10%) |')
        add(f'| **奖励池** | **¥{rewards[0]:.2f}(30%)** | **¥{rewards[1]:.2f}(35%)** | **¥{rewards[2]:.2f}(40%)** |')
        add(f'| 平台净收(最坏) | ¥{nets_worst[0]:.2f} | ¥{nets_worst[1]:.2f} | ¥{nets_worst[2]:.2f} |')
        add(f'| 平台净收(默认) | ¥{nets_default[0]:.2f} | ¥{nets_default[1]:.2f} | ¥{nets_default[2]:.2f} |')
        add()

    add('---')
    add()

    # ============================================================
    # Section 3: VIP购买收入对比
    # ============================================================
    add('## 三、VIP购买一次性收入对比')
    add()
    add('| 指标 | 方案A(399) | 方案B(899) | 方案C(1599) |')
    add('| :--- | ---: | ---: | ---: |')
    add(f'| VIP售价 | ¥399 | ¥899 | ¥1,599 |')
    add(f'| 平台利润 | ¥100 | ¥450 | ¥800 |')
    add(f'| 推荐奖励 | -¥50 | -¥50 | -¥50 |')
    add(f'| 净收/人 | ¥50 | ¥400 | ¥750 |')
    add(f'| 净收/人(70%有推荐) | ¥65 | ¥415 | ¥765 |')
    add()

    for n in [100_000, 1_000_000, 10_000_000]:
        n_vip = n // 2
        new_vips = n_vip * VIP_NEW_RATE
        add(f'**{n//10000}万用户（{n_vip//10000}万VIP，月新增{new_vips:.0f}人）：**')
        add()
        add('| 月VIP购买收入 | 方案A | 方案B | 方案C |')
        add('| :--- | ---: | ---: | ---: |')
        for p in PLANS:
            income = new_vips * p['vip_profit']
            ref = new_vips * VIP_REFERRAL * VIP_REFERRAL_RATE
            net = income - ref
            add(f'| {p["name"]}利润 | ¥{income/10000:,.0f}万 | — | — |' if p == PLANS[0] else '')
        # 重做这个表
        lines.pop(); lines.pop(); lines.pop(); lines.pop(); lines.pop()
        add('| 指标 | 方案A | 方案B | 方案C |')
        add('| :--- | ---: | ---: | ---: |')
        incomes = [new_vips * p['vip_profit'] for p in PLANS]
        ref = new_vips * VIP_REFERRAL * VIP_REFERRAL_RATE
        nets = [i - ref for i in incomes]
        add(f'| 月VIP利润 | ¥{wan(incomes[0])}万 | ¥{wan(incomes[1])}万 | ¥{wan(incomes[2])}万 |')
        add(f'| 推荐奖励 | -¥{wan(ref)}万 | -¥{wan(ref)}万 | -¥{wan(ref)}万 |')
        add(f'| 净收入 | ¥{wan(nets[0])}万 | ¥{wan(nets[1])}万 | ¥{wan(nets[2])}万 |')
        add()

    add('---')
    add()

    # ============================================================
    # Section 4: 详细P&L对比（100万用户，加价率1.30）
    # ============================================================
    add('## 四、详细月度P&L对比（100万用户，加价率=1.30）')
    add()

    for worst in [True, False]:
        mode = '最坏情况' if worst else '默认参数'
        add(f'### {mode}')
        add()
        add('| 科目 | 方案A(399/30%) | 方案B(899/35%) | 方案C(1599/40%) |')
        add('| :--- | ---: | ---: | ---: |')

        results = [run_scenario(1_000_000, 1.30, p, worst) for p in PLANS]

        items = [
            ('月总营收', 'total_rev'),
            ('普通毛利', 'profit_n'),
            ('VIP毛利', 'profit_v'),
            ('平台可控收入', 'platform'),
            ('奖励过期回流', 'reward_return'),
            ('VIP购买收入', 'vip_income'),
            ('卖家产业基金', 'seller', True),
            ('奖励提现流出', 'reward_out', True),
            ('VIP推荐奖励', 'referral_cost', True),
            ('换货成本', 'replace_cost', True),
            ('运营成本', 'op_cost', True),
        ]

        for item in items:
            label = item[0]
            key = item[1]
            neg = len(item) > 2
            prefix = '-' if neg else ''
            row = f'| {prefix}{label} |'
            for r in results:
                row += f' {prefix}¥{wan(r[key])}万 |'
            add(row)

        add('| | | | |')
        row = '| **月度净利润** |'
        for r in results:
            row += f' **¥{wan(r["net_profit"])}万** |'
        add(row)
        row = '| **净利率** |'
        for r in results:
            row += f' **{r["net_margin"]:.1f}%** |'
        add(row)

        add('| | | | |')
        row = '| 奖励流出率 |'
        for r in results:
            rate = r['reward_out'] / r['reward_pool'] * 100 if r['reward_pool'] > 0 else 0
            row += f' {rate:.1f}% |'
        add(row)
        row = '| 普通人均月奖 |'
        for r in results:
            row += f' ¥{r["avg_reward_n"]:.2f} |'
        add(row)
        row = '| VIP人均月奖 |'
        for r in results:
            row += f' ¥{r["avg_reward_v"]:.2f} |'
        add(row)
        add()

    add('---')
    add()

    # ============================================================
    # Section 5: 三方案差异汇总
    # ============================================================
    add('## 五、三方案核心差异汇总')
    add()
    add('以100万用户、加价率1.30为基准：')
    add()

    add('| 指标 | 方案A(399/30%) | 方案B(899/35%) | 方案C(1599/40%) |')
    add('| :--- | ---: | ---: | ---: |')

    rw = [run_scenario(1_000_000, 1.30, p, True) for p in PLANS]
    rd = [run_scenario(1_000_000, 1.30, p, False) for p in PLANS]

    add(f'| VIP礼包售价 | ¥399 | ¥899 | ¥1,599 |')
    add(f'| VIP购买门槛 | 低 | 中 | 高 |')
    add(f'| 月VIP购买净收 | ¥{wan(rw[0]["vip_income"])}万 | ¥{wan(rw[1]["vip_income"])}万 | ¥{wan(rw[2]["vip_income"])}万 |')
    add(f'| VIP奖励比例 | 30% | 35% | 40% |')
    add(f'| 月奖励流出(最坏) | ¥{wan(rw[0]["reward_out"])}万 | ¥{wan(rw[1]["reward_out"])}万 | ¥{wan(rw[2]["reward_out"])}万 |')
    add(f'| 月奖励流出(默认) | ¥{wan(rd[0]["reward_out"])}万 | ¥{wan(rd[1]["reward_out"])}万 | ¥{wan(rd[2]["reward_out"])}万 |')
    add(f'| **最坏净利润** | **¥{wan(rw[0]["net_profit"])}万** | **¥{wan(rw[1]["net_profit"])}万** | **¥{wan(rw[2]["net_profit"])}万** |')
    add(f'| **最坏净利率** | **{rw[0]["net_margin"]:.1f}%** | **{rw[1]["net_margin"]:.1f}%** | **{rw[2]["net_margin"]:.1f}%** |')
    add(f'| **默认净利润** | **¥{wan(rd[0]["net_profit"])}万** | **¥{wan(rd[1]["net_profit"])}万** | **¥{wan(rd[2]["net_profit"])}万** |')
    add(f'| **默认净利率** | **{rd[0]["net_margin"]:.1f}%** | **{rd[1]["net_margin"]:.1f}%** | **{rd[2]["net_margin"]:.1f}%** |')
    add(f'| VIP人均月奖(默认) | ¥{rd[0]["avg_reward_v"]:.2f} | ¥{rd[1]["avg_reward_v"]:.2f} | ¥{rd[2]["avg_reward_v"]:.2f} |')

    # 方案B/C相对A的增量
    add()
    add('### 方案B/C相对方案A的增量')
    add()
    add('| 指标 | 方案B vs A | 方案C vs A |')
    add('| :--- | ---: | ---: |')
    add(f'| VIP购买收入增量 | +¥{wan(rw[1]["vip_income"]-rw[0]["vip_income"])}万/月 | +¥{wan(rw[2]["vip_income"]-rw[0]["vip_income"])}万/月 |')
    add(f'| 奖励流出增量(最坏) | +¥{wan(rw[1]["reward_out"]-rw[0]["reward_out"])}万/月 | +¥{wan(rw[2]["reward_out"]-rw[0]["reward_out"])}万/月 |')
    add(f'| 净利润增量(最坏) | +¥{wan(rw[1]["net_profit"]-rw[0]["net_profit"])}万/月 | +¥{wan(rw[2]["net_profit"]-rw[0]["net_profit"])}万/月 |')
    add(f'| 净利润增量(默认) | +¥{wan(rd[1]["net_profit"]-rd[0]["net_profit"])}万/月 | +¥{wan(rd[2]["net_profit"]-rd[0]["net_profit"])}万/月 |')
    add(f'| 净利率变化(最坏) | {rw[1]["net_margin"]-rw[0]["net_margin"]:+.1f}pp | {rw[2]["net_margin"]-rw[0]["net_margin"]:+.1f}pp |')
    add(f'| 净利率变化(默认) | {rd[1]["net_margin"]-rd[0]["net_margin"]:+.1f}pp | {rd[2]["net_margin"]-rd[0]["net_margin"]:+.1f}pp |')

    add()
    add('---')
    add()

    # ============================================================
    # Section 6: 结论
    # ============================================================
    add('## 六、结论与建议')
    add()

    # 判断最优
    best_worst = max(range(3), key=lambda i: rw[i]['net_profit'])
    best_default = max(range(3), key=lambda i: rd[i]['net_profit'])

    add(f'1. **最坏情况最优**：{PLANS[best_worst]["name"]}（{PLANS[best_worst]["desc"]}），'
        f'净利率{rw[best_worst]["net_margin"]:.1f}%')
    add(f'2. **默认参数最优**：{PLANS[best_default]["name"]}（{PLANS[best_default]["desc"]}），'
        f'净利率{rd[best_default]["net_margin"]:.1f}%')
    add()

    vip_income_diff_bc = rw[2]['vip_income'] - rw[0]['vip_income']
    reward_diff_bc = rw[2]['reward_out'] - rw[0]['reward_out']
    add(f'3. **VIP定价提高的核心效应**：')
    add(f'   - 方案C比方案A每月多收VIP购买利润 ¥{wan(vip_income_diff_bc)}万')
    add(f'   - 方案C比方案A每月多流出奖励 ¥{wan(reward_diff_bc)}万（因奖励比例从30%升到40%）')
    net_diff = rw[2]['net_profit'] - rw[0]['net_profit']
    add(f'   - 净效果：方案C比方案A每月多赚 ¥{wan(net_diff)}万（VIP购买增量 > 奖励增量）')
    add()
    add(f'4. **风险提示**：VIP定价越高，转化率可能下降。模型假设VIP数量不受价格影响（均为50%），'
        f'实际中1599元方案的VIP转化率可能远低于399元方案。建议结合市场测试。')

    # 写文件
    md_path = os.path.join(OUTPUT_DIR, 'VIP定价方案对比报告.md')
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'报告已保存: {md_path}')

    # 生成PDF
    pdf_path = os.path.join(OUTPUT_DIR, 'VIP定价方案对比报告.pdf')
    ret = os.system(
        f'cd "{OUTPUT_DIR}" && pandoc "VIP定价方案对比报告.md" -o "VIP定价方案对比报告.pdf" '
        f'--pdf-engine=xelatex -V mainfont="PingFang SC" -V CJKmainfont="PingFang SC" '
        f'-V geometry:margin=2cm -V fontsize=10pt 2>/dev/null'
    )
    if ret == 0:
        print(f'PDF已保存: {pdf_path}')
    else:
        print('PDF生成失败，请手动用pandoc转换')


if __name__ == '__main__':
    main()
