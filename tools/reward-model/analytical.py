#!/usr/bin/env python3
"""
农脉分润奖励系统 — 稳态解析模型 + 参数扫描热力图

用法：
  python analytical.py              # 默认参数运行
  python analytical.py --worst      # 最坏情况模式（100%解锁+100%提现）

输出：
  output/heatmaps/       9张参数扫描热力图（PNG）
  output/worst_case.txt  最坏情况分析报告
  终端输出              默认参数下的P&L摘要
"""

import os
import sys
import math
import numpy as np
import matplotlib
matplotlib.use('Agg')  # 无GUI后端
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm
from dataclasses import dataclass, field, replace

# ── 中文字体设置 ──
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'Heiti TC', 'PingFang SC', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')
HEATMAP_DIR = os.path.join(OUTPUT_DIR, 'heatmaps')


# ============================================================
# 参数定义
# ============================================================

@dataclass
class Params:
    """全部模型参数"""

    # ── 普通系统分润比例（六分，总和=1.0）──
    normal_platform_pct: float = 0.50
    normal_reward_pct: float = 0.16
    normal_industry_pct: float = 0.16
    normal_charity_pct: float = 0.08
    normal_tech_pct: float = 0.08
    normal_reserve_pct: float = 0.02

    # ── VIP系统分润比例（六分，总和=1.0）──
    vip_platform_pct: float = 0.50
    vip_reward_pct: float = 0.30
    vip_industry_pct: float = 0.10
    vip_charity_pct: float = 0.02
    vip_tech_pct: float = 0.02
    vip_reserve_pct: float = 0.06
    vip_discount_rate: float = 0.95
    vip_max_layers: int = 15
    vip_price: float = 399.0
    vip_profit: float = 300.0
    vip_referral: float = 50.0

    # ── 树结构 ──
    branch_factor: int = 3
    max_layers: int = 15
    freeze_days: int = 30

    # ── 定价 ──
    markup: float = 1.30
    avg_cost_normal: float = 80.0    # 普通用户平均客单成本（元）
    avg_cost_vip: float = 120.0      # VIP用户平均客单成本（元）

    # ── 奖励有效期 ──
    normal_reward_expiry_days: int = 30
    vip_reward_expiry_days: int = 30

    # ── 市场行为 ──
    N_normal: int = 9000
    N_vip: int = 1000
    freq_normal: float = 3.0        # 普通用户月均购买次数
    freq_vip: float = 6.0           # VIP用户月均购买次数
    vip_conversion_rate_annual: float = 0.10
    vip_referral_rate: float = 0.70  # M5: 有推荐人的VIP占比
    withdrawal_rate: float = 0.80
    churn_rate: float = 0.05         # M3: 月流失率
    completion_rate: float = 0.95    # M7: 订单完成率

    # ── 抽奖 M6 ──
    lottery_active_rate: float = 0.30
    lottery_win_rate: float = 0.60
    lottery_avg_prize_cost: float = 5.0

    # ── 换货 M10 ──
    replacement_rate: float = 0.03
    avg_shipping_cost: float = 8.0

    # ── 运营 ──
    operating_cost_pct: float = 0.05

    # ── 解锁率（由 estimate_unlock_rate 计算）──
    unlock_rate: float = 0.0        # 自动计算
    unlock_rate_vip: float = 0.0    # 自动计算


def estimate_unlock_rate(freq: float, freeze_days: int, max_layers: int) -> float:
    """
    粗略解锁率：冻结期内能消费的次数 / maxLayers
    解锁第k层需要祖辈消费 >= k 次
    冻结期内最多消费 freq × (freeze_days/30) 次
    """
    consumptions_in_freeze = freq * (freeze_days / 30.0)
    return min(consumptions_in_freeze, max_layers) / max_layers


def tree_depth(n_users: int, branch_factor: int) -> int:
    """平衡多叉树的深度（不含根节点）"""
    if n_users <= 1:
        return 0
    return int(math.ceil(math.log(n_users * (branch_factor - 1) + 1) / math.log(branch_factor)))


# ============================================================
# 核心计算
# ============================================================

def calculate_monthly_pnl(p: Params) -> dict:
    """稳态月均P&L（解析公式）"""

    # 自动计算解锁率（如果未手动设置 > 0）
    unlock_n = p.unlock_rate if p.unlock_rate > 0 else estimate_unlock_rate(p.freq_normal, p.freeze_days, p.max_layers)
    unlock_v = p.unlock_rate_vip if p.unlock_rate_vip > 0 else estimate_unlock_rate(p.freq_vip, p.freeze_days, p.vip_max_layers)

    # ── 普通系统 ──
    eff_orders_n = p.N_normal * p.freq_normal * p.completion_rate
    profit_n = eff_orders_n * p.avg_cost_normal * (p.markup - 1)

    platform_ctrl_n = profit_n * (p.normal_platform_pct + p.normal_charity_pct + p.normal_tech_pct + p.normal_reserve_pct)
    seller_payout = profit_n * p.normal_industry_pct
    reward_pool_n = profit_n * p.normal_reward_pct

    # 四层过滤
    avail_retain_n = 1 - (1 - p.withdrawal_rate) ** (p.normal_reward_expiry_days / 30.0)
    active_rate = 1.0 - p.churn_rate
    reward_out_n = reward_pool_n * unlock_n * avail_retain_n * active_rate * p.withdrawal_rate
    reward_return_n = reward_pool_n - reward_out_n

    # ── VIP系统 ──
    eff_orders_v = p.N_vip * p.freq_vip * p.completion_rate
    vip_sale = p.avg_cost_vip * p.markup * p.vip_discount_rate
    profit_v = eff_orders_v * (vip_sale - p.avg_cost_vip)

    # 六分利润（与普通系统同构）
    platform_ctrl_v = profit_v * (p.vip_platform_pct + p.vip_charity_pct + p.vip_tech_pct + p.vip_reserve_pct)
    seller_payout_v = profit_v * p.vip_industry_pct
    reward_pool_v = profit_v * p.vip_reward_pct
    avail_retain_v = 1 - (1 - p.withdrawal_rate) ** (p.vip_reward_expiry_days / 30.0)
    reward_out_v = reward_pool_v * unlock_v * avail_retain_v * active_rate * p.withdrawal_rate
    reward_return_v = reward_pool_v - reward_out_v

    # M4: 出局VIP纯利润
    exit_rate = min(1.0, p.freq_vip / p.vip_max_layers) * 0.1
    exited_count = p.N_vip * exit_rate
    exited_profit = exited_count * p.freq_vip * p.completion_rate * (vip_sale - p.avg_cost_vip)

    # VIP购买收入
    new_vips = p.N_normal * p.vip_conversion_rate_annual / 12.0
    vip_sales_rev = new_vips * p.vip_price
    vip_income = new_vips * p.vip_profit
    referral_cost = new_vips * p.vip_referral * p.vip_referral_rate

    # 抽奖成本
    daily_lottery = (p.N_normal + p.N_vip) * p.lottery_active_rate
    lottery_cost = daily_lottery * 30.0 * p.lottery_win_rate * p.lottery_avg_prize_cost

    # 换货成本
    total_orders = eff_orders_n + eff_orders_v
    replace_cost = total_orders * p.replacement_rate * p.avg_shipping_cost

    # 运营成本
    total_rev = (
        p.N_normal * p.freq_normal * p.avg_cost_normal * p.markup
        + p.N_vip * p.freq_vip * vip_sale
        + vip_sales_rev
    )
    op_cost = total_rev * p.operating_cost_pct

    # 净利润
    total_seller = seller_payout + seller_payout_v
    net = (
        platform_ctrl_n + reward_return_n
        + platform_ctrl_v + reward_return_v
        + exited_profit
        + vip_income
        - total_seller
        - reward_out_n
        - reward_out_v
        - referral_cost
        - lottery_cost
        - replace_cost
        - op_cost
    )

    return {
        'net_profit': net,
        'net_margin': net / total_rev if total_rev > 0 else 0,
        'total_revenue': total_rev,
        'profit_normal': profit_n,
        'profit_vip': profit_v,
        'platform_controlled': platform_ctrl_n + platform_ctrl_v,
        'seller_payout': total_seller,
        'reward_pool_total': reward_pool_n + reward_pool_v,
        'reward_outflow': reward_out_n + reward_out_v,
        'reward_return': reward_return_n + reward_return_v,
        'exited_vip_profit': exited_profit,
        'vip_purchase_income': vip_income,
        'referral_cost': referral_cost,
        'lottery_cost': lottery_cost,
        'replacement_cost': replace_cost,
        'operating_cost': op_cost,
        'unlock_rate_normal': unlock_n,
        'unlock_rate_vip': unlock_v,
    }


# ============================================================
# 最坏情况
# ============================================================

def worst_case_params(base: Params) -> Params:
    """最坏情况：100%解锁，100%提现，无过期，无流失"""
    return replace(base,
        unlock_rate=1.0,
        unlock_rate_vip=1.0,
        withdrawal_rate=1.0,
        churn_rate=0.0,
        normal_reward_expiry_days=9999,
        vip_reward_expiry_days=9999,
        completion_rate=1.0,
    )


# ============================================================
# 热力图扫描
# ============================================================

def make_heatmap(title: str, xlabel: str, ylabel: str,
                 x_values, y_values, z_matrix,
                 filename: str, z_label: str = '净利率%',
                 show_zero_contour: bool = True):
    """生成热力图并保存"""
    fig, ax = plt.subplots(figsize=(10, 7))

    z_pct = z_matrix * 100  # 转百分比

    # 颜色映射：红=亏损, 白=0, 绿=盈利
    vmin, vmax = z_pct.min(), z_pct.max()
    if vmin < 0 and vmax > 0:
        norm = TwoSlopeNorm(vmin=vmin, vcenter=0, vmax=vmax)
        cmap = 'RdYlGn'
    elif vmax <= 0:
        norm = None
        cmap = 'Reds_r'
    else:
        norm = None
        cmap = 'Greens'

    im = ax.imshow(z_pct, aspect='auto', origin='lower', cmap=cmap, norm=norm,
                   extent=[x_values[0], x_values[-1], y_values[0], y_values[-1]])
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label(z_label, fontsize=12)

    # 盈利边界线（净利率=0）
    if show_zero_contour and vmin < 0 and vmax > 0:
        try:
            ax.contour(z_pct, levels=[0], colors='black', linewidths=2,
                       extent=[x_values[0], x_values[-1], y_values[0], y_values[-1]])
        except Exception:
            pass

    ax.set_xlabel(xlabel, fontsize=13)
    ax.set_ylabel(ylabel, fontsize=13)
    ax.set_title(title, fontsize=14, fontweight='bold')

    os.makedirs(HEATMAP_DIR, exist_ok=True)
    path = os.path.join(HEATMAP_DIR, filename)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def apply_param(base: Params, key: str, val) -> Params:
    """
    设置参数，处理特殊联动：
    - 'freq' → 同时设 freq_normal=val, freq_vip=val*2（VIP购买频率是普通的2倍）
    - 'avg_cost' → 同时设 avg_cost_normal=val, avg_cost_vip=val*1.5
    - 'N_total' → 按VIP转化率拆分
    """
    if key == 'freq':
        return replace(base, freq_normal=float(val), freq_vip=float(val) * 2)
    elif key == 'avg_cost':
        return replace(base, avg_cost_normal=float(val), avg_cost_vip=float(val) * 1.5)
    elif key == 'vip_reward_pct':
        # 调整VIP奖励比例时，保持六分总和=1.0（差值从平台分成扣除/增加）
        vr = float(val)
        fixed_sum = base.vip_industry_pct + base.vip_charity_pct + base.vip_tech_pct + base.vip_reserve_pct
        new_platform = 1.0 - vr - fixed_sum
        if new_platform < 0.05:
            return replace(base, vip_reward_pct=vr, vip_platform_pct=0.05)
        return replace(base, vip_reward_pct=vr, vip_platform_pct=new_platform)
    elif key == 'normal_reward_pct':
        # 调整普通奖励比例时，保持六分总和=1.0
        nr = float(val)
        fixed_sum = base.normal_industry_pct + base.normal_charity_pct + base.normal_tech_pct + base.normal_reserve_pct
        new_platform = 1.0 - nr - fixed_sum
        if new_platform < 0.05:
            return replace(base, normal_reward_pct=nr, normal_platform_pct=0.05)
        return replace(base, normal_reward_pct=nr, normal_platform_pct=new_platform)
    else:
        return replace(base, **{key: val})


def run_scan(base: Params, x_key: str, x_vals, y_key: str, y_vals,
             title: str, xlabel: str, ylabel: str, filename: str,
             z_func=None, z_label='净利率%'):
    """通用二维参数扫描"""
    z = np.zeros((len(y_vals), len(x_vals)))
    for j, yv in enumerate(y_vals):
        for i, xv in enumerate(x_vals):
            p = apply_param(base, x_key, xv)
            p = apply_param(p, y_key, yv)
            # 特殊处理：N_total/VIP转化率联动
            if x_key == 'N_total' or y_key == 'N_total':
                n_total = xv if x_key == 'N_total' else yv
                vip_rate = yv if y_key == 'vip_conversion_rate_annual' else p.vip_conversion_rate_annual
                if x_key == 'vip_conversion_rate_annual':
                    vip_rate = xv
                n_vip = int(n_total * vip_rate)
                n_normal = n_total - n_vip
                p = replace(p, N_normal=max(n_normal, 0), N_vip=max(n_vip, 0))
            # 解锁率需要跟随 freq/freeze/maxLayers 变化
            p = replace(p, unlock_rate=0, unlock_rate_vip=0)
            result = calculate_monthly_pnl(p)
            if z_func:
                z[j, i] = z_func(result)
            else:
                z[j, i] = result['net_margin']
    return make_heatmap(title, xlabel, ylabel, x_vals, y_vals, z, filename, z_label)


def run_all_scans(base: Params):
    """执行9组热力图扫描"""
    paths = []

    # 扫描1: 加价率 × 普通奖励比例
    paths.append(run_scan(base,
        'markup', np.arange(1.10, 2.05, 0.05),
        'normal_reward_pct', np.arange(0.05, 0.31, 0.01),
        '扫描1: 加价率 × 普通奖励比例（最坏情况）',
        '加价率', '普通奖励比例',
        'scan1_markup_vs_reward.png'))

    # 扫描2: 加价率 × 购买频率
    paths.append(run_scan(base,
        'markup', np.arange(1.10, 2.05, 0.05),
        'freq', np.arange(1, 16, 1).astype(float),
        '扫描2: 加价率 × 月购买频率（最坏情况）',
        '加价率', '月购买频率(次)',
        'scan2_markup_vs_freq.png'))

    # 扫描3: VIP奖励比例 × 购买频率
    paths.append(run_scan(base,
        'vip_reward_pct', np.arange(0.10, 0.55, 0.05),
        'freq', np.arange(1, 16, 1).astype(float),
        '扫描3: VIP奖励比例 × 月购买频率（最坏情况）',
        'VIP奖励比例', '月购买频率(次)',
        'scan3_vip_reward_vs_freq.png'))

    # 扫描4: 用户总量 × VIP转化率 — 需要特殊处理
    n_totals = np.array([1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000])
    vip_rates = np.arange(0.03, 0.31, 0.01)
    z4 = np.zeros((len(vip_rates), len(n_totals)))
    for j, vr in enumerate(vip_rates):
        for i, nt in enumerate(n_totals):
            nv = int(nt * vr)
            nn = nt - nv
            p = replace(base, N_normal=nn, N_vip=nv, unlock_rate=0, unlock_rate_vip=0)
            r = calculate_monthly_pnl(p)
            z4[j, i] = r['net_margin']
    # 用log刻度的位置标签
    log_positions = np.log10(n_totals)
    paths.append(make_heatmap(
        '扫描4: 用户总量 × VIP转化率（最坏情况）',
        '用户总量(log10)', 'VIP转化率',
        log_positions, vip_rates, z4,
        'scan4_users_vs_viprate.png'))

    # 扫描5: 冻结天数 × 购买频率
    paths.append(run_scan(base,
        'freeze_days', np.arange(15, 65, 5).astype(int),
        'freq', np.arange(1, 16, 1).astype(float),
        '扫描5: 冻结天数 × 月购买频率',
        '冻结天数', '月购买频率(次)',
        'scan5_freeze_vs_freq.png'))

    # 扫描6: maxLayers × 购买频率
    paths.append(run_scan(base,
        'max_layers', np.arange(8, 21, 1).astype(int),
        'freq', np.arange(1, 16, 1).astype(float),
        '扫描6: 最大层数 × 月购买频率（最坏情况）',
        '最大层数', '月购买频率(次)',
        'scan6_layers_vs_freq.png'))

    # 扫描7: maxLayers × 奖励比例
    paths.append(run_scan(base,
        'max_layers', np.arange(8, 21, 1).astype(int),
        'normal_reward_pct', np.arange(0.05, 0.31, 0.01),
        '扫描7: 最大层数 × 普通奖励比例（最坏情况, freq=3）',
        '最大层数', '普通奖励比例',
        'scan7_layers_vs_reward.png'))

    # 扫描8: 叉数 × maxLayers — 颜色=奖励流出率
    bf_vals = np.arange(2, 6, 1).astype(int)
    ml_vals = np.arange(8, 21, 1).astype(int)
    z8 = np.zeros((len(ml_vals), len(bf_vals)))
    for j, ml in enumerate(ml_vals):
        for i, bf in enumerate(bf_vals):
            p = replace(base, branch_factor=bf, max_layers=ml, unlock_rate=0, unlock_rate_vip=0)
            r = calculate_monthly_pnl(p)
            pool = r['reward_pool_total']
            z8[j, i] = r['reward_outflow'] / pool if pool > 0 else 0
    paths.append(make_heatmap(
        '扫描8: 叉数 × 最大层数 → 奖励流出率（最坏情况）',
        '树叉数', '最大层数',
        bf_vals.astype(float), ml_vals.astype(float), z8,
        'scan8_branch_vs_layers.png',
        z_label='奖励流出率%', show_zero_contour=False))

    # 扫描9: 用户总量 × maxLayers
    z9 = np.zeros((len(ml_vals), len(n_totals)))
    for j, ml in enumerate(ml_vals):
        for i, nt in enumerate(n_totals):
            nv = int(nt * base.vip_conversion_rate_annual)
            nn = nt - nv
            p = replace(base, N_normal=nn, N_vip=nv, max_layers=ml, unlock_rate=0, unlock_rate_vip=0)
            r = calculate_monthly_pnl(p)
            z9[j, i] = r['net_margin']
    paths.append(make_heatmap(
        '扫描9: 用户总量 × 最大层数（最坏情况）',
        '用户总量(log10)', '最大层数',
        log_positions, ml_vals.astype(float), z9,
        'scan9_users_vs_layers.png'))

    return paths


# ============================================================
# P&L 报表
# ============================================================

def format_pnl(result: dict, label: str = '', params: Params = None) -> str:
    """格式化P&L输出"""
    lines = []
    lines.append('=' * 60)
    if label:
        lines.append(f'  {label}')
        lines.append('=' * 60)
    lines.append(f"  月总营收:           ¥{result['total_revenue']:>14,.2f}")
    lines.append(f"  ├ 普通系统毛利:     ¥{result['profit_normal']:>14,.2f}")
    lines.append(f"  ├ VIP系统毛利:      ¥{result['profit_vip']:>14,.2f}")
    lines.append(f"  ├ VIP礼包收入:      ¥{result['vip_purchase_income']:>14,.2f}")
    lines.append(f"  ├ 出局VIP纯利:      ¥{result['exited_vip_profit']:>14,.2f}")
    lines.append(f"  平台可控收入:       ¥{result['platform_controlled']:>14,.2f}")
    lines.append(f"  奖励回流(过期):     ¥{result['reward_return']:>14,.2f}")
    lines.append('-' * 60)
    lines.append(f"  卖家产业基金:      -¥{result['seller_payout']:>14,.2f}")
    lines.append(f"  奖励提现流出:      -¥{result['reward_outflow']:>14,.2f}")
    lines.append(f"  VIP推荐奖励:       -¥{result['referral_cost']:>14,.2f}")
    lines.append(f"  抽奖净成本:        -¥{result['lottery_cost']:>14,.2f}")
    lines.append(f"  换货成本:          -¥{result['replacement_cost']:>14,.2f}")
    lines.append(f"  运营成本:          -¥{result['operating_cost']:>14,.2f}")
    lines.append('=' * 60)
    lines.append(f"  月度净利润:         ¥{result['net_profit']:>14,.2f}")
    lines.append(f"  净利率:             {result['net_margin']*100:>13.2f}%")
    lines.append('-' * 60)
    lines.append(f"  奖励池总量:         ¥{result['reward_pool_total']:>14,.2f}")
    lines.append(f"  奖励实际流出:       ¥{result['reward_outflow']:>14,.2f}")
    pool = result['reward_pool_total']
    flow_rate = result['reward_outflow'] / pool * 100 if pool > 0 else 0
    lines.append(f"  奖励流出率:         {flow_rate:>13.1f}%")
    lines.append(f"  解锁率(普通/VIP):   {result['unlock_rate_normal']*100:.1f}% / {result['unlock_rate_vip']*100:.1f}%")
    lines.append('=' * 60)
    return '\n'.join(lines)


# ============================================================
# 场景对比
# ============================================================

def run_scenarios(base: Params) -> str:
    """四场景 + 最坏情况对比"""
    scenarios = [
        ('A 冷清 (普1/VIP2)', replace(base, freq_normal=1.0, freq_vip=2.0)),
        ('B 正常 (普3/VIP6)', replace(base, freq_normal=3.0, freq_vip=6.0)),
        ('C 活跃 (普8/VIP12)', replace(base, freq_normal=8.0, freq_vip=12.0)),
        ('D 极端 (普15/VIP15)', replace(base, freq_normal=15.0, freq_vip=15.0)),
    ]

    lines = ['\n' + '=' * 60]
    lines.append('  四场景对比（默认参数 + 最坏情况）')
    lines.append('=' * 60)

    header = f"{'场景':<20} {'月净利润':>12} {'净利率':>8} {'奖励流出率':>10} {'解锁率':>8}"
    lines.append(header)
    lines.append('-' * 60)

    for label, p in scenarios:
        # 最坏情况
        wp = worst_case_params(p)
        wp = replace(wp, unlock_rate=0, unlock_rate_vip=0)  # 让它自动算（freq决定）
        # 但最坏=100%解锁
        wp = replace(wp, unlock_rate=1.0, unlock_rate_vip=1.0)
        r = calculate_monthly_pnl(wp)
        pool = r['reward_pool_total']
        fr = r['reward_outflow'] / pool * 100 if pool > 0 else 0
        lines.append(f"{label:<20} ¥{r['net_profit']:>10,.0f} {r['net_margin']*100:>7.1f}% {fr:>9.1f}% {r['unlock_rate_normal']*100:>6.0f}%")

    lines.append('=' * 60)
    lines.append('  注：最坏情况 = 100%解锁 + 100%提现 + 无过期 + 无流失')
    lines.append('')
    return '\n'.join(lines)


# ============================================================
# 单笔订单分析
# ============================================================

def per_order_analysis(p: Params) -> str:
    """单笔订单的资金流分析"""
    lines = ['\n' + '=' * 60]
    lines.append('  单笔订单资金流分析（最坏情况：100%解锁+提现）')
    lines.append('=' * 60)

    markup = p.markup

    # 普通订单
    cost_n = p.avg_cost_normal
    sale_n = cost_n * markup
    profit_n = sale_n - cost_n
    platform_n = profit_n * p.normal_platform_pct
    seller_n = profit_n * p.normal_industry_pct
    reward_n = profit_n * p.normal_reward_pct
    funds_n = profit_n * (p.normal_charity_pct + p.normal_tech_pct + p.normal_reserve_pct)
    net_n = platform_n + funds_n - reward_n  # 最坏情况：奖励全流出

    lines.append(f'\n  普通用户订单 (成本={cost_n:.0f}元, 加价率={markup:.2f})')
    lines.append(f"  售价:             ¥{sale_n:>8.2f}")
    lines.append(f"  利润:             ¥{profit_n:>8.2f}")
    lines.append(f"  平台利润(50%):    ¥{platform_n:>8.2f}  ← 可控")
    lines.append(f"  基金池(18%):      ¥{funds_n:>8.2f}  ← 可控")
    lines.append(f"  卖家产业基金(16%): -¥{seller_n:>7.2f}  ← 支出")
    lines.append(f"  奖励流出(16%):    -¥{reward_n:>7.2f}  ← 最坏=全部流出")
    lines.append(f"  ────────────────────────────")
    lines.append(f"  平台单笔净收入:   ¥{net_n:>8.2f}  ({net_n/sale_n*100:.1f}% of 售价)")

    # VIP订单（六分利润，与普通系统同构）
    cost_v = p.avg_cost_vip
    vip_sale = cost_v * markup * p.vip_discount_rate
    profit_v = vip_sale - cost_v
    plat_v = profit_v * p.vip_platform_pct
    reward_v = profit_v * p.vip_reward_pct
    seller_v = profit_v * p.vip_industry_pct
    funds_v = profit_v * (p.vip_charity_pct + p.vip_tech_pct + p.vip_reserve_pct)
    net_v = plat_v + funds_v - reward_v  # 最坏情况：奖励全流出

    lines.append(f'\n  VIP用户订单 (折扣率={p.vip_discount_rate}, 六分利润)')
    lines.append(f"  售价:             ¥{vip_sale:>8.2f}")
    lines.append(f"  利润:             ¥{profit_v:>8.2f}")
    lines.append(f"  平台利润(50%):    ¥{plat_v:>8.2f}  ← 可控")
    lines.append(f"  基金池(10%):      ¥{funds_v:>8.2f}  ← 可控")
    lines.append(f"  卖家产业基金(10%): -¥{seller_v:>7.2f}  ← 支出")
    lines.append(f"  奖励流出(30%):    -¥{reward_v:>7.2f}  ← 最坏=全部流出")
    lines.append(f"  ────────────────────────────")
    lines.append(f"  平台单笔净收入:   ¥{net_v:>8.2f}  ({net_v/vip_sale*100:.1f}% of 售价)")

    lines.append('=' * 60)
    return '\n'.join(lines)


# ============================================================
# 主入口
# ============================================================

def main():
    worst_mode = '--worst' in sys.argv

    base = Params()
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print('\n农脉分润奖励系统 — 稳态解析模型')
    print('=' * 60)

    # 单笔订单分析
    print(per_order_analysis(base))

    # 默认参数 P&L
    default_result = calculate_monthly_pnl(base)
    print(format_pnl(default_result, '默认参数 月度P&L（含过期/流失等现实因素）', base))

    # 最坏情况 P&L
    wp = worst_case_params(base)
    wp = replace(wp, unlock_rate=1.0, unlock_rate_vip=1.0)
    worst_result = calculate_monthly_pnl(wp)
    print(format_pnl(worst_result, '最坏情况 月度P&L（100%解锁+100%提现）', wp))

    # 场景对比
    print(run_scenarios(base))

    # 保存最坏情况报告
    report_path = os.path.join(OUTPUT_DIR, 'worst_case.txt')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('农脉分润奖励系统 — 最坏情况盈利分析报告\n')
        f.write(f'生成时间: {__import__("datetime").datetime.now().isoformat()}\n\n')
        f.write(per_order_analysis(base))
        f.write('\n\n')
        f.write(format_pnl(worst_result, '最坏情况 月度P&L（100%解锁+100%提现）', wp))
        f.write('\n\n')
        f.write(run_scenarios(base))
    print(f'\n报告已保存: {report_path}')

    # 生成热力图（使用最坏情况参数）
    print('\n生成热力图（最坏情况参数扫描）...')
    scan_base = worst_case_params(base)
    scan_base = replace(scan_base, unlock_rate=1.0, unlock_rate_vip=1.0)
    paths = run_all_scans(scan_base)
    for p in paths:
        print(f'  ✓ {os.path.basename(p)}')

    print(f'\n全部热力图已保存到: {HEATMAP_DIR}/')
    print('完成！\n')


if __name__ == '__main__':
    main()
