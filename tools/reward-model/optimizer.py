#!/usr/bin/env python3
"""
农脉分润奖励系统 — 全参数联合优化器

对所有可控参数做网格搜索，找出：
1. 最坏情况下也能盈利的安全参数组合
2. 默认参数下利润最高的推荐配置
3. 不同策略（保守/平衡/激进）的最优参数

用法：
  python optimizer.py
"""

import os
import sys
import itertools
import numpy as np
from dataclasses import replace

sys.path.insert(0, os.path.dirname(__file__))
from analytical import Params, calculate_monthly_pnl, worst_case_params

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


# ================================================================
# 搜索空间定义
# ================================================================

# 可控参数及其候选值
SEARCH_SPACE = {
    # 定价（约束：1.0 ~ 1.6）
    'markup':             [1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.45, 1.50, 1.55, 1.60],

    # 普通系统奖励比例（约束：10% ~ 50%）
    'normal_reward_pct':  [0.10, 0.15, 0.16, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50],

    # VIP奖励占利润比例（约束：10% ~ 50%，六分比例中的奖励份额）
    'vip_reward_pct':     [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50],

    # 树结构
    'max_layers':         [5, 8, 10, 12, 15],

    # 冻结天数
    'freeze_days':        [15, 20, 30, 45],
}

# 抽奖单独分两轮跑（0 和 5元/次）
LOTTERY_SCENARIOS = [0, 5]

# 用户规模场景
USER_SCENARIOS = {
    '1万用户':   {'N_normal': 9_000,   'N_vip': 1_000},
    '10万用户':  {'N_normal': 90_000,  'N_vip': 10_000},
    '100万用户': {'N_normal': 900_000, 'N_vip': 100_000},
}

# 用户行为场景（不可控，测试鲁棒性）
BEHAVIOR_SCENARIOS = {
    '低活跃(普2/VIP4)':  {'freq_normal': 2.0, 'freq_vip': 4.0},
    '中活跃(普3/VIP6)':  {'freq_normal': 3.0, 'freq_vip': 6.0},
    '高活跃(普6/VIP10)': {'freq_normal': 6.0, 'freq_vip': 10.0},
}


def adjust_normal_ratios(base: Params, reward_pct: float) -> Params:
    """
    调整普通系统奖励比例时，保持六分总和=100%
    策略：奖励比例变化的差值从平台分成中扣除/增加
    产业基金(16%)和基金池(慈善8%+科技8%+备用2%=18%)保持不变
    """
    fixed_sum = base.normal_industry_pct + base.normal_charity_pct + base.normal_tech_pct + base.normal_reserve_pct
    new_platform = 1.0 - reward_pct - fixed_sum
    if new_platform < 0.05:  # 平台至少保留5%
        return None
    return replace(base,
        normal_reward_pct=reward_pct,
        normal_platform_pct=new_platform,
    )


def apply_vip_reward_pct(base: Params, vip_reward_pct: float) -> Params:
    """
    设置VIP奖励占利润的比例（六分体系）。
    VIP奖励 = profit × vip_reward_pct

    策略：奖励比例变化的差值从平台分成中扣除/增加。
    产业基金(10%)和基金池(慈善2%+科技2%+备用6%=10%)保持不变。
    """
    fixed_sum = base.vip_industry_pct + base.vip_charity_pct + base.vip_tech_pct + base.vip_reserve_pct
    new_platform = 1.0 - vip_reward_pct - fixed_sum
    if new_platform < 0.05:  # 平台至少保留5%
        return None
    return replace(base,
        vip_reward_pct=vip_reward_pct,
        vip_platform_pct=new_platform,
    )


def run_optimization():
    """主优化流程"""

    base = Params()

    # 生成所有参数组合
    keys = list(SEARCH_SPACE.keys())
    values = list(SEARCH_SPACE.values())
    all_combos = list(itertools.product(*values))
    total = len(all_combos)

    print('=' * 90)
    print('  农脉分润奖励系统 — 全参数联合优化器（加价率1.0~1.6约束）')
    print('=' * 90)
    print(f'  搜索空间: {" × ".join(str(len(v)) for v in values)} = {total:,} 种参数组合')
    print(f'  抽奖场景: 无抽奖(0元) / 有抽奖(5元/次)')
    print(f'  用户规模场景: {len(USER_SCENARIOS)} 种')
    print(f'  用户行为场景: {len(BEHAVIOR_SCENARIOS)} 种')
    print()

    # 对每个抽奖场景分别跑
    for lottery_cost in LOTTERY_SCENARIOS:
        lottery_label = '无抽奖' if lottery_cost == 0 else f'抽奖{lottery_cost}元/次'
        print('\n' + '#' * 90)
        print(f'  抽奖场景: {lottery_label}')
        print('#' * 90)

        # 只跑10万用户（中等规模，最有代表性）
        scale_name = '10万用户'
        scale_params = USER_SCENARIOS[scale_name]

        print(f'  用户规模: {scale_name} (普通={scale_params["N_normal"]:,}, VIP={scale_params["N_vip"]:,})')
        print()

        results = []

        for combo in all_combos:
            config = dict(zip(keys, combo))

            # 调整普通系统比例
            p = replace(base, **scale_params)
            p = adjust_normal_ratios(p, config['normal_reward_pct'])
            if p is None:
                continue

            # 调整VIP奖励比例
            p = apply_vip_reward_pct(p, config['vip_reward_pct'])
            if p is None:
                continue

            p = replace(p,
                markup=config['markup'],
                max_layers=config['max_layers'],
                vip_max_layers=config['max_layers'],
                freeze_days=config['freeze_days'],
                lottery_avg_prize_cost=lottery_cost,
                unlock_rate=0, unlock_rate_vip=0,
            )

            # 对每种行为场景计算
            behavior_results = {}
            for bname, bparams in BEHAVIOR_SCENARIOS.items():
                pb = replace(p, **bparams, unlock_rate=0, unlock_rate_vip=0)
                r_default = calculate_monthly_pnl(pb)

                pw = worst_case_params(pb)
                pw = replace(pw, unlock_rate=1.0, unlock_rate_vip=1.0)
                r_worst = calculate_monthly_pnl(pw)

                behavior_results[bname] = {
                    'default': r_default,
                    'worst': r_worst,
                }

            results.append({
                'config': config,
                'behaviors': behavior_results,
            })

        print(f'  有效参数组合: {len(results):,}')

        # ============================================================
        # 策略1: 最坏情况全场景盈利
        # ============================================================
        safe_results = []
        for r in results:
            all_worst_profitable = all(
                r['behaviors'][b]['worst']['net_profit'] > 0
                for b in BEHAVIOR_SCENARIOS
            )
            if all_worst_profitable:
                mid_worst = r['behaviors']['中活跃(普3/VIP6)']['worst']['net_profit']
                safe_results.append((mid_worst, r))
        safe_results.sort(key=lambda x: x[0], reverse=True)

        print(f'\n  策略1: 最坏情况全场景盈利: {len(safe_results)} 种')
        if safe_results:
            print_top_configs(f'    [{lottery_label}] 最坏安全 TOP 15',
                              safe_results[:15], 'worst')
        else:
            relaxed = [(r['behaviors']['中活跃(普3/VIP6)']['worst']['net_profit'], r)
                       for r in results
                       if r['behaviors']['中活跃(普3/VIP6)']['worst']['net_profit'] > 0]
            relaxed.sort(key=lambda x: x[0], reverse=True)
            print(f'    全场景安全=0种。放宽为仅中活跃最坏盈利: {len(relaxed)} 种')
            if relaxed:
                print_top_configs(f'    [{lottery_label}] 中活跃最坏盈利 TOP 15',
                                  relaxed[:15], 'worst')
            else:
                print('    连中活跃最坏都无法盈利！需要提高加价率上限。')

        # ============================================================
        # 策略2: 默认参数利润最高
        # ============================================================
        default_ranked = [(r['behaviors']['中活跃(普3/VIP6)']['default']['net_profit'], r)
                          for r in results]
        default_ranked.sort(key=lambda x: x[0], reverse=True)
        print()
        print_top_configs(f'  [{lottery_label}] 策略2: 默认参数利润最高 TOP 15',
                          default_ranked[:15], 'default')

        # ============================================================
        # 策略3: 平衡型
        # ============================================================
        balanced = []
        for r in results:
            d = r['behaviors']['中活跃(普3/VIP6)']['default']
            w = r['behaviors']['中活跃(普3/VIP6)']['worst']
            score = d['net_margin'] * 0.6 + w['net_margin'] * 0.4
            balanced.append((score, r))
        balanced.sort(key=lambda x: x[0], reverse=True)
        print()
        print_top_configs(f'  [{lottery_label}] 策略3: 平衡型 TOP 15（默认60%+最坏40%加权）',
                          balanced[:15], 'both')

        # ============================================================
        # 策略4: 鲁棒盈利（所有行为场景默认都盈利）
        # ============================================================
        robust = []
        for r in results:
            all_ok = all(
                r['behaviors'][b]['default']['net_profit'] > 0
                for b in BEHAVIOR_SCENARIOS
            )
            if all_ok:
                min_margin = min(r['behaviors'][b]['default']['net_margin'] for b in BEHAVIOR_SCENARIOS)
                robust.append((min_margin, r))
        robust.sort(key=lambda x: x[0], reverse=True)
        print()
        print(f'  [{lottery_label}] 策略4: 所有行为场景默认都盈利: {len(robust)} 种')
        if robust:
            print_top_configs(f'    鲁棒盈利 TOP 10', robust[:10], 'default', show_all_behaviors=True)

        # ============================================================
        # 推荐配置总结
        # ============================================================
        print()
        print('=' * 90)
        print(f'  [{lottery_label}] 推荐参数配置')
        print('=' * 90)

        if safe_results:
            _, best_safe = safe_results[0]
            c = best_safe['config']
            d = best_safe['behaviors']['中活跃(普3/VIP6)']['default']
            w = best_safe['behaviors']['中活跃(普3/VIP6)']['worst']
            print(f'\n  保守型（最坏情况也盈利）:')
            print(f'    加价率={c["markup"]:.2f}, 普通奖励={c["normal_reward_pct"]*100:.0f}%, '
                  f'VIP奖励={c["vip_reward_pct"]*100:.0f}%, 层数={c["max_layers"]}, 冻结={c["freeze_days"]}天')
            print(f'    默认净利率: {d["net_margin"]*100:.1f}%  |  最坏净利率: {w["net_margin"]*100:.1f}%')

        if len(balanced) > 0:
            _, best_bal = balanced[0]
            c = best_bal['config']
            d = best_bal['behaviors']['中活跃(普3/VIP6)']['default']
            w = best_bal['behaviors']['中活跃(普3/VIP6)']['worst']
            print(f'\n  平衡型（默认利润高+最坏可控）:')
            print(f'    加价率={c["markup"]:.2f}, 普通奖励={c["normal_reward_pct"]*100:.0f}%, '
                  f'VIP奖励={c["vip_reward_pct"]*100:.0f}%, 层数={c["max_layers"]}, 冻结={c["freeze_days"]}天')
            print(f'    默认净利率: {d["net_margin"]*100:.1f}%  |  最坏净利率: {w["net_margin"]*100:.1f}%')

        if len(default_ranked) > 0:
            _, best_def = default_ranked[0]
            c = best_def['config']
            d = best_def['behaviors']['中活跃(普3/VIP6)']['default']
            w = best_def['behaviors']['中活跃(普3/VIP6)']['worst']
            print(f'\n  激进型（默认利润最大化）:')
            print(f'    加价率={c["markup"]:.2f}, 普通奖励={c["normal_reward_pct"]*100:.0f}%, '
                  f'VIP奖励={c["vip_reward_pct"]*100:.0f}%, 层数={c["max_layers"]}, 冻结={c["freeze_days"]}天')
            print(f'    默认净利率: {d["net_margin"]*100:.1f}%  |  最坏净利率: {w["net_margin"]*100:.1f}%')

        print()


def print_top_configs(title: str, ranked: list, mode: str,
                      show_all_behaviors: bool = False):
    """打印排名表"""
    print()
    print(title)
    print('  ' + '-' * 86)

    header = (f'  {"#":>3} {"加价率":>6} {"普通奖励":>8} {"VIP奖励":>8} {"层数":>4} '
              f'{"冻结":>4}')
    if mode == 'worst':
        header += f' {"最坏净利润":>12} {"最坏净利率":>10}'
    elif mode == 'default':
        header += f' {"默认净利润":>12} {"默认净利率":>10}'
    else:
        header += f' {"默认净利率":>10} {"最坏净利率":>10}'
    print(header)
    print('  ' + '-' * 76)

    for i, (score, r) in enumerate(ranked):
        c = r['config']
        d = r['behaviors']['中活跃(普3/VIP6)']['default']
        w = r['behaviors']['中活跃(普3/VIP6)']['worst']

        line = (f'  {i+1:>3} {c["markup"]:>6.2f} {c["normal_reward_pct"]*100:>7.0f}% '
                f'{c["vip_reward_pct"]*100:>7.0f}% {c["max_layers"]:>4} '
                f'{c["freeze_days"]:>4}')

        if mode == 'worst':
            line += f' ¥{w["net_profit"]:>10,.0f} {w["net_margin"]*100:>9.1f}%'
        elif mode == 'default':
            line += f' ¥{d["net_profit"]:>10,.0f} {d["net_margin"]*100:>9.1f}%'
        else:
            line += f' {d["net_margin"]*100:>9.1f}% {w["net_margin"]*100:>9.1f}%'

        print(line)

        if show_all_behaviors and i < 3:
            for bname in BEHAVIOR_SCENARIOS:
                bd = r['behaviors'][bname]['default']
                bw = r['behaviors'][bname]['worst']
                print(f'      {bname}: 默认={bd["net_margin"]*100:.1f}% 最坏={bw["net_margin"]*100:.1f}%')


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 捕获输出到文件
    import io

    # 同时输出到终端和文件
    class Tee:
        def __init__(self, *files):
            self.files = files
        def write(self, text):
            for f in self.files:
                f.write(text)
        def flush(self):
            for f in self.files:
                f.flush()

    report_path = os.path.join(OUTPUT_DIR, 'optimization_report.txt')
    report_file = open(report_path, 'w', encoding='utf-8')
    old_stdout = sys.stdout
    sys.stdout = Tee(old_stdout, report_file)

    run_optimization()

    sys.stdout = old_stdout
    report_file.close()
    print(f'\n报告已保存: {report_path}')


if __name__ == '__main__':
    main()
