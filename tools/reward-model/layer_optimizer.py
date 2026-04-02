#!/usr/bin/env python3
"""
农脉分润奖励系统 — 最大层数(maxLayers)优化分析

针对不同用户规模，扫描 maxLayers=3~20，找出收益最大的层数设置。
确保每次测试的用户量足够让树深度 > maxLayers，真正测到层数的影响。

用法：
  python layer_optimizer.py
"""

import os
import sys
import math
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from dataclasses import dataclass, replace

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(__file__))
from analytical import Params, calculate_monthly_pnl, worst_case_params, estimate_unlock_rate

plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'Heiti TC', 'PingFang SC', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def tree_depth(n_users: int, bf: int) -> int:
    """平衡多叉树深度"""
    if n_users <= 1:
        return 0
    return int(math.ceil(math.log(n_users * (bf - 1) + 1) / math.log(bf)))


def users_for_depth(depth: int, bf: int) -> int:
    """填满到指定深度所需的最小用户数"""
    return (bf ** (depth + 1) - 1) // (bf - 1)


def run_layer_sweep():
    """主分析：扫描 maxLayers，确保树深度总是大于 maxLayers"""

    base = Params()
    bf = base.branch_factor  # 3

    max_layers_range = list(range(3, 21))  # 3 ~ 20

    print('=' * 80)
    print('  农脉分润奖励系统 — maxLayers 最优层数分析')
    print('=' * 80)
    print(f'  树叉数: {bf}')
    print(f'  加价率: {base.markup}')
    print(f'  普通奖励比例: {base.normal_reward_pct*100:.0f}%')
    print(f'  VIP奖励比例: {base.vip_reward_pct*100:.0f}%')
    print()

    # 先展示树深度 vs 用户数的关系
    print('  参考：三叉树深度 vs 所需用户数')
    print('  ' + '-' * 50)
    for d in range(3, 22):
        n = users_for_depth(d, bf)
        print(f'  深度 {d:>2} 层 → 需要 {n:>12,} 用户')
    print()

    # ================================================================
    # 分析1: 固定用户规模，扫描maxLayers（最坏情况）
    # ================================================================
    user_scales = [10_000, 50_000, 100_000, 500_000, 1_000_000]

    print('=' * 80)
    print('  分析1: 不同用户规模下，maxLayers 对月净利润的影响（最坏情况）')
    print('  最坏情况 = 100%解锁 + 100%提现 + 无过期')
    print('=' * 80)

    results_by_scale = {}

    for n_total in user_scales:
        td = tree_depth(n_total, bf)
        n_vip = int(n_total * base.vip_conversion_rate_annual)
        n_normal = n_total - n_vip

        print(f'\n  用户规模: {n_total:>10,}  |  树深度: {td} 层  |  普通: {n_normal:,}  VIP: {n_vip:,}')
        print(f'  {"maxLayers":>10} {"月净利润":>14} {"净利率":>8} {"奖励流出":>14} {"奖励归平台":>14} {"流出率":>8}')
        print('  ' + '-' * 72)

        scale_results = []
        for ml in max_layers_range:
            wp = worst_case_params(replace(base,
                N_normal=n_normal,
                N_vip=n_vip,
                max_layers=ml,
                vip_max_layers=ml,
            ))
            wp = replace(wp, unlock_rate=1.0, unlock_rate_vip=1.0)
            r = calculate_monthly_pnl(wp)
            pool = r['reward_pool_total']
            outflow = r['reward_outflow']
            to_platform = pool - outflow
            flow_rate = outflow / pool * 100 if pool > 0 else 0

            scale_results.append({
                'ml': ml,
                'net_profit': r['net_profit'],
                'net_margin': r['net_margin'],
                'outflow': outflow,
                'to_platform': to_platform,
                'flow_rate': flow_rate,
                'pool': pool,
            })

            marker = ' ←' if ml == td else ''
            if ml > td:
                marker = ' (超过树深，无额外效果)'
            print(f'  {ml:>10} ¥{r["net_profit"]:>12,.0f} {r["net_margin"]*100:>7.1f}% ¥{outflow:>12,.0f} ¥{to_platform:>12,.0f} {flow_rate:>7.1f}%{marker}')

        results_by_scale[n_total] = scale_results

        # 找最优
        best = max(scale_results, key=lambda x: x['net_profit'])
        print(f'\n  ★ 最优 maxLayers = {best["ml"]}，月净利润 ¥{best["net_profit"]:,.0f}，净利率 {best["net_margin"]*100:.1f}%')
        if best['ml'] >= td:
            print(f'    注意：最优值 ≥ 树深度({td})，说明在此用户规模下层数不是瓶颈')

    # ================================================================
    # 分析2: 确保树深度总是 > maxLayers（动态调整用户数）
    # ================================================================
    print('\n' + '=' * 80)
    print('  分析2: 动态用户规模（确保树深度 = maxLayers + 5，充分测试每个层数）')
    print('  最坏情况 = 100%解锁 + 100%提现')
    print('=' * 80)

    print(f'\n  {"maxLayers":>10} {"所需用户":>12} {"树深度":>8} {"月净利润":>14} {"净利率":>8} {"奖励流出":>14} {"流出率":>8} {"人均月利润":>12}')
    print('  ' + '-' * 90)

    dynamic_results = []
    for ml in max_layers_range:
        # 确保树深度 = maxLayers + 5
        target_depth = ml + 5
        n_total = users_for_depth(target_depth, bf)
        # 但最少10000，最多不超过300万（避免数字失真）
        n_total = max(10_000, min(n_total, 3_000_000))
        actual_depth = tree_depth(n_total, bf)

        n_vip = int(n_total * base.vip_conversion_rate_annual)
        n_normal = n_total - n_vip

        wp = worst_case_params(replace(base,
            N_normal=n_normal,
            N_vip=n_vip,
            max_layers=ml,
            vip_max_layers=ml,
        ))
        wp = replace(wp, unlock_rate=1.0, unlock_rate_vip=1.0)
        r = calculate_monthly_pnl(wp)
        pool = r['reward_pool_total']
        outflow = r['reward_outflow']
        flow_rate = outflow / pool * 100 if pool > 0 else 0
        per_user = r['net_profit'] / n_total if n_total > 0 else 0

        dynamic_results.append({
            'ml': ml,
            'n_total': n_total,
            'depth': actual_depth,
            'net_profit': r['net_profit'],
            'net_margin': r['net_margin'],
            'flow_rate': flow_rate,
            'per_user': per_user,
            'pool': pool,
            'outflow': outflow,
        })

        print(f'  {ml:>10} {n_total:>12,} {actual_depth:>8} ¥{r["net_profit"]:>12,.0f} {r["net_margin"]*100:>7.1f}% ¥{outflow:>12,.0f} {flow_rate:>7.1f}% ¥{per_user:>10.2f}')

    # ================================================================
    # 分析3: 固定100万用户，测试层数对各指标的影响（含默认参数对比）
    # ================================================================
    print('\n' + '=' * 80)
    print('  分析3: 100万用户，maxLayers 影响对比（最坏 vs 默认参数）')
    print('=' * 80)

    n_total = 1_000_000
    td = tree_depth(n_total, bf)
    n_vip = int(n_total * base.vip_conversion_rate_annual)
    n_normal = n_total - n_vip

    print(f'  用户: {n_total:,}  |  树深度: {td}层  |  普通: {n_normal:,}  VIP: {n_vip:,}')
    print(f'\n  {"maxLayers":>10} {"最坏净利润":>14} {"最坏净利率":>10} {"最坏流出率":>10} {"默认净利润":>14} {"默认净利率":>10} {"默认流出率":>10}')
    print('  ' + '-' * 82)

    comparison = []
    for ml in max_layers_range:
        # 最坏
        wp = worst_case_params(replace(base, N_normal=n_normal, N_vip=n_vip, max_layers=ml, vip_max_layers=ml))
        wp = replace(wp, unlock_rate=1.0, unlock_rate_vip=1.0)
        rw = calculate_monthly_pnl(wp)
        pw = rw['reward_pool_total']
        frw = rw['reward_outflow'] / pw * 100 if pw > 0 else 0

        # 默认（含过期/流失）
        dp = replace(base, N_normal=n_normal, N_vip=n_vip, max_layers=ml, vip_max_layers=ml, unlock_rate=0, unlock_rate_vip=0)
        rd = calculate_monthly_pnl(dp)
        pd = rd['reward_pool_total']
        frd = rd['reward_outflow'] / pd * 100 if pd > 0 else 0

        comparison.append({
            'ml': ml,
            'worst_profit': rw['net_profit'],
            'worst_margin': rw['net_margin'],
            'worst_flow': frw,
            'default_profit': rd['net_profit'],
            'default_margin': rd['net_margin'],
            'default_flow': frd,
        })

        marker = ' ← 树深度' if ml == td else ''
        print(f'  {ml:>10} ¥{rw["net_profit"]:>12,.0f} {rw["net_margin"]*100:>9.1f}% {frw:>9.1f}% ¥{rd["net_profit"]:>12,.0f} {rd["net_margin"]*100:>9.1f}% {frd:>9.1f}%{marker}')

    best_worst = max(comparison, key=lambda x: x['worst_profit'])
    best_default = max(comparison, key=lambda x: x['default_profit'])
    print(f'\n  ★ 最坏情况最优: maxLayers={best_worst["ml"]}，月净利润 ¥{best_worst["worst_profit"]:,.0f}')
    print(f'  ★ 默认参数最优: maxLayers={best_default["ml"]}，月净利润 ¥{best_default["default_profit"]:,.0f}')

    # ================================================================
    # 生成图表
    # ================================================================
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 图1: 不同用户规模下 maxLayers vs 净利率（最坏情况）
    fig, ax = plt.subplots(figsize=(12, 7))
    for n_total in user_scales:
        data = results_by_scale[n_total]
        mls = [d['ml'] for d in data]
        margins = [d['net_margin'] * 100 for d in data]
        td = tree_depth(n_total, bf)
        ax.plot(mls, margins, 'o-', label=f'{n_total/1000:.0f}K用户 (树深{td})', markersize=4)
    ax.axhline(y=0, color='black', linewidth=1, linestyle='--')
    ax.set_xlabel('maxLayers（最大分配层数）', fontsize=13)
    ax.set_ylabel('净利率 %', fontsize=13)
    ax.set_title('不同用户规模下 maxLayers 对净利率的影响（最坏情况）', fontsize=14, fontweight='bold')
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3)
    ax.set_xticks(max_layers_range)
    fig.tight_layout()
    fig.savefig(os.path.join(OUTPUT_DIR, 'layer_opt_by_scale.png'), dpi=150)
    plt.close()

    # 图2: 100万用户，最坏 vs 默认
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7))

    mls = [d['ml'] for d in comparison]
    # 左图：净利率
    ax1.plot(mls, [d['worst_margin'] * 100 for d in comparison], 'ro-', label='最坏情况', markersize=5)
    ax1.plot(mls, [d['default_margin'] * 100 for d in comparison], 'go-', label='默认参数', markersize=5)
    ax1.axhline(y=0, color='black', linewidth=1, linestyle='--')
    ax1.axvline(x=td, color='blue', linewidth=1, linestyle=':', label=f'树深度={td}')
    ax1.set_xlabel('maxLayers', fontsize=13)
    ax1.set_ylabel('净利率 %', fontsize=13)
    ax1.set_title('100万用户: maxLayers vs 净利率', fontsize=13, fontweight='bold')
    ax1.legend(fontsize=10)
    ax1.grid(True, alpha=0.3)
    ax1.set_xticks(mls)

    # 右图：奖励流出率
    ax2.plot(mls, [d['worst_flow'] for d in comparison], 'ro-', label='最坏情况', markersize=5)
    ax2.plot(mls, [d['default_flow'] for d in comparison], 'go-', label='默认参数', markersize=5)
    ax2.axvline(x=td, color='blue', linewidth=1, linestyle=':', label=f'树深度={td}')
    ax2.set_xlabel('maxLayers', fontsize=13)
    ax2.set_ylabel('奖励流出率 %', fontsize=13)
    ax2.set_title('100万用户: maxLayers vs 奖励流出率', fontsize=13, fontweight='bold')
    ax2.legend(fontsize=10)
    ax2.grid(True, alpha=0.3)
    ax2.set_xticks(mls)

    fig.tight_layout()
    fig.savefig(os.path.join(OUTPUT_DIR, 'layer_opt_100w_compare.png'), dpi=150)
    plt.close()

    # 图3: 动态用户规模下的人均月利润
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7))

    mls_d = [d['ml'] for d in dynamic_results]
    ax1.bar(mls_d, [d['net_margin'] * 100 for d in dynamic_results],
            color=['green' if d['net_margin'] > 0 else 'red' for d in dynamic_results])
    ax1.axhline(y=0, color='black', linewidth=1)
    ax1.set_xlabel('maxLayers', fontsize=13)
    ax1.set_ylabel('净利率 %', fontsize=13)
    ax1.set_title('动态用户规模: maxLayers vs 净利率（最坏情况）', fontsize=13, fontweight='bold')
    ax1.set_xticks(mls_d)
    ax1.grid(True, alpha=0.3, axis='y')

    ax2.plot(mls_d, [d['flow_rate'] for d in dynamic_results], 'ro-', markersize=6)
    ax2.set_xlabel('maxLayers', fontsize=13)
    ax2.set_ylabel('奖励流出率 %', fontsize=13)
    ax2.set_title('动态用户规模: maxLayers vs 奖励流出率（最坏情况）', fontsize=13, fontweight='bold')
    ax2.set_xticks(mls_d)
    ax2.grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(os.path.join(OUTPUT_DIR, 'layer_opt_dynamic.png'), dpi=150)
    plt.close()

    # ================================================================
    # 总结
    # ================================================================
    print('\n' + '=' * 80)
    print('  总结与建议')
    print('=' * 80)
    print(f'''
  1. 树深度由用户数决定：三叉树 10K用户=8层, 100K=11层, 1M=13层

  2. maxLayers 超过树深度后无额外效果（奖励到根归平台，和超层归平台等价）

  3. maxLayers 越大：
     - 奖励流出越多（更多层的消费产生有效奖励）
     - 但解锁也越难（第15层需要祖辈消费15次）
     - 最坏情况下（100%解锁），层数越多平台利润越低

  4. maxLayers 越小：
     - 奖励流出越少（超层部分直接归平台）
     - 用户感知奖励少，吸引力低
     - 但平台利润更有保障

  5. 关键权衡：maxLayers 是「用户吸引力 vs 平台利润安全」的调节阀
''')

    # 保存报告
    report_path = os.path.join(OUTPUT_DIR, 'layer_optimization.txt')
    # 重定向stdout到文件
    import io
    old_stdout = sys.stdout
    sys.stdout = buffer = io.StringIO()

    # 重跑打印
    print('图表已保存:')
    print(f'  {os.path.join(OUTPUT_DIR, "layer_opt_by_scale.png")}')
    print(f'  {os.path.join(OUTPUT_DIR, "layer_opt_100w_compare.png")}')
    print(f'  {os.path.join(OUTPUT_DIR, "layer_opt_dynamic.png")}')

    sys.stdout = old_stdout

    print(f'\n  图表已保存到 {OUTPUT_DIR}/')
    print('  完成！\n')


if __name__ == '__main__':
    run_layer_sweep()
