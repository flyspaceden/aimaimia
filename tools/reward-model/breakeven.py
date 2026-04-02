#!/usr/bin/env python3
"""
农脉分润奖励系统 — 盈亏平衡点分析

找每个参数的极限值：到底最低/最高设到多少还能赚钱？
分两种模式：最坏情况（100%解锁+提现）和默认参数。
分两种抽奖：无抽奖 和 抽奖5元/次。

用法：
  python breakeven.py
"""

import os
import sys
import numpy as np
from dataclasses import replace

sys.path.insert(0, os.path.dirname(__file__))
from analytical import Params, calculate_monthly_pnl, worst_case_params

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def find_breakeven(base: Params, key: str, values, worst: bool = True) -> float:
    """
    二分查找盈亏平衡点。
    返回刚好 net_profit=0 的参数值。
    worst=True: 最坏情况; False: 默认参数
    """
    # 先用粗扫找到变号区间
    profits = []
    for v in values:
        p = apply_param(base, key, v)
        if p is None:
            profits.append(None)
            continue
        if worst:
            p = make_worst(p)
        r = calculate_monthly_pnl(p)
        profits.append(r['net_profit'])

    # 找变号点
    for i in range(len(profits) - 1):
        if profits[i] is None or profits[i+1] is None:
            continue
        if (profits[i] >= 0 and profits[i+1] < 0) or (profits[i] < 0 and profits[i+1] >= 0):
            # 在 values[i] 和 values[i+1] 之间二分
            lo, hi = float(values[i]), float(values[i+1])
            for _ in range(50):  # 精度足够
                mid = (lo + hi) / 2
                p = apply_param(base, key, mid)
                if p is None:
                    hi = mid
                    continue
                if worst:
                    p = make_worst(p)
                r = calculate_monthly_pnl(p)
                if (profits[i] >= 0 and r['net_profit'] >= 0) or (profits[i] < 0 and r['net_profit'] < 0):
                    lo = mid
                else:
                    hi = mid
            return round((lo + hi) / 2, 4)

    # 全盈利或全亏损
    if all(p is not None and p >= 0 for p in profits):
        return None  # 全范围盈利，无平衡点
    if all(p is not None and p < 0 for p in profits):
        return None  # 全范围亏损，无平衡点
    return None


def apply_param(base: Params, key: str, val) -> Params:
    """设置参数，处理联动"""
    if key == 'normal_reward_pct':
        fixed = base.normal_industry_pct + base.normal_charity_pct + base.normal_tech_pct + base.normal_reserve_pct
        new_platform = 1.0 - float(val) - fixed
        if new_platform < 0.05:
            return None
        return replace(base, normal_reward_pct=float(val), normal_platform_pct=new_platform,
                       unlock_rate=0, unlock_rate_vip=0)
    elif key == 'vip_reward_pct':
        vr = float(val)
        fixed_sum = base.vip_industry_pct + base.vip_charity_pct + base.vip_tech_pct + base.vip_reserve_pct
        new_platform = 1.0 - vr - fixed_sum
        if new_platform < 0.05:
            return None
        return replace(base, vip_reward_pct=vr, vip_platform_pct=new_platform,
                       unlock_rate=0, unlock_rate_vip=0)
    elif key == 'freq':
        return replace(base, freq_normal=float(val), freq_vip=float(val)*2,
                       unlock_rate=0, unlock_rate_vip=0)
    else:
        return replace(base, **{key: val}, unlock_rate=0, unlock_rate_vip=0)


def make_worst(p: Params) -> Params:
    """最坏情况"""
    from analytical import worst_case_params
    wp = worst_case_params(p)
    return replace(wp, unlock_rate=1.0, unlock_rate_vip=1.0)


def sweep_param(base: Params, key: str, values, label: str, unit: str = '',
                direction: str = 'min', worst: bool = True):
    """
    扫描一个参数，打印每个值的净利润，标记平衡点。
    direction: 'min'=找最低能盈利的值, 'max'=找最高能盈利的值
    """
    mode = '最坏' if worst else '默认'
    results = []
    for v in values:
        p = apply_param(base, key, v)
        if p is None:
            results.append((v, None, None))
            continue
        if worst:
            p = make_worst(p)
        r = calculate_monthly_pnl(p)
        results.append((v, r['net_profit'], r['net_margin']))

    # 找平衡点
    bp = find_breakeven(base, key, values, worst)

    print(f'\n  {label} [{mode}情况]')
    print(f'  ' + '-' * 60)
    for v, profit, margin in results:
        if profit is None:
            print(f'    {v:>8}{unit}  → 无效组合')
            continue
        marker = '  ✓' if profit >= 0 else '  ✗'
        print(f'    {v:>8}{unit}  → 净利润 ¥{profit:>12,.0f}  净利率 {margin*100:>6.1f}%{marker}')

    if bp is not None:
        if direction == 'min':
            print(f'  ★ 盈亏平衡点: {label} 最低 = {bp}{unit}')
        else:
            print(f'  ★ 盈亏平衡点: {label} 最高 = {bp}{unit}')
    else:
        all_profit = all(r[1] is not None and r[1] >= 0 for r in results)
        if all_profit:
            print(f'  ★ 全范围盈利，无平衡点（{label}在测试范围内随便设都赚钱）')
        else:
            print(f'  ★ 全范围亏损，无平衡点（需要调整其他参数）')

    return bp


def run_breakeven():
    """主分析"""

    base = Params(
        N_normal=90_000, N_vip=10_000,  # 10万用户
        avg_cost_normal=80, avg_cost_vip=120,
        freq_normal=3.0, freq_vip=6.0,
        markup=1.30,
        normal_reward_pct=0.16, normal_platform_pct=0.50,
        vip_reward_pct=0.30, vip_platform_pct=0.50,  # VIP六分
        max_layers=15, freeze_days=30,
    )

    lottery_scenarios = [
        ('无抽奖', 0),
        ('有抽奖(5元/次)', 5),
    ]

    for lottery_label, lottery_cost in lottery_scenarios:
        b = replace(base, lottery_avg_prize_cost=lottery_cost)

        print('\n' + '█' * 70)
        print(f'  盈亏平衡点分析 — {lottery_label}')
        print(f'  基准: 10万用户, 普通80元/3次月, VIP120元/6次月')
        print(f'  基准参数: 加价率1.30, 普通奖励16%, VIP奖励30%, 层数15, 冻结30天')
        print('█' * 70)

        for worst in [True, False]:
            mode = '最坏情况(100%解锁+提现)' if worst else '默认参数(含过期/流失)'
            print(f'\n{"=" * 70}')
            print(f'  模式: {mode}')
            print(f'{"=" * 70}')

            # 先看基准配置是否盈利
            bp = apply_param(b, 'markup', b.markup)
            if worst:
                bp = make_worst(bp)
            r0 = calculate_monthly_pnl(bp)
            print(f'\n  基准配置净利润: ¥{r0["net_profit"]:,.0f} (净利率 {r0["net_margin"]*100:.1f}%)')
            if r0['net_profit'] >= 0:
                print(f'  基准配置盈利 ✓ → 下面找每个参数能压到多极端还能赚')
            else:
                print(f'  基准配置亏损 ✗ → 下面找每个参数要调到多少才能赚')

            results = {}

            # 1. 加价率：最低多少能赚钱？
            results['markup'] = sweep_param(b, 'markup',
                np.arange(1.00, 1.65, 0.05),
                '加价率', '', 'min', worst)

            # 2. 普通奖励比例：最高多少还能赚？
            results['normal_reward'] = sweep_param(b, 'normal_reward_pct',
                np.arange(0.10, 0.55, 0.05),
                '普通奖励比例', '%（×100）', 'max', worst)

            # 3. VIP奖励比例：最高多少还能赚？（六分体系，最高不超过平台底线5%+固定20%=75%）
            results['vip_reward'] = sweep_param(b, 'vip_reward_pct',
                np.arange(0.10, 0.76, 0.05),
                'VIP奖励比例', '%（×100）', 'max', worst)

            # 4. maxLayers：影响大不大？
            results['max_layers'] = sweep_param(b, 'max_layers',
                [3, 5, 8, 10, 12, 15, 20],
                '最大层数', '层', 'max', worst)

            # 5. 冻结天数：最长多少？
            results['freeze_days'] = sweep_param(b, 'freeze_days',
                [7, 10, 15, 20, 30, 45, 60, 90],
                '冻结天数', '天', 'max', worst)

            # 6. 购买频率：最低多少能赚？（用户行为，不可控但需要知道底线）
            results['freq'] = sweep_param(b, 'freq',
                [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 8.0, 10.0],
                '月购买频率(普通)', '次/月(VIP=2倍)', 'min', worst)

            # 总结
            print(f'\n{"=" * 70}')
            print(f'  [{lottery_label}] [{mode}] 盈亏平衡点总结')
            print(f'{"=" * 70}')
            print(f'  基准: 加价率1.30, 普通奖励16%, VIP奖励30%, 层数15, 冻结30天, 普通3次/月')
            print()
            for name, bp in results.items():
                if bp is not None:
                    print(f'    {name}: 平衡点 = {bp}')
                else:
                    print(f'    {name}: 无平衡点（全范围盈利或全范围亏损）')

    # ============================================================
    # 组合极限测试：多个参数同时设到极端
    # ============================================================
    print('\n' + '█' * 70)
    print('  组合极限测试：多个参数同时极端化')
    print('█' * 70)

    combos = [
        ('最保守（对平台最有利）',
         dict(markup=1.60, normal_reward_pct=0.10, vip_rp=0.25, max_layers=5, freeze_days=15)),
        ('基准配置',
         dict(markup=1.30, normal_reward_pct=0.16, vip_rp=0.30, max_layers=15, freeze_days=30)),
        ('中等激进',
         dict(markup=1.30, normal_reward_pct=0.25, vip_rp=0.40, max_layers=15, freeze_days=30)),
        ('高激进',
         dict(markup=1.30, normal_reward_pct=0.35, vip_rp=0.50, max_layers=15, freeze_days=30)),
        ('极端激进',
         dict(markup=1.30, normal_reward_pct=0.50, vip_rp=0.70, max_layers=15, freeze_days=45)),
        ('低加价+中奖励',
         dict(markup=1.15, normal_reward_pct=0.20, vip_rp=0.35, max_layers=12, freeze_days=30)),
        ('低加价+高奖励',
         dict(markup=1.15, normal_reward_pct=0.35, vip_rp=0.50, max_layers=15, freeze_days=30)),
        ('超低加价+最低奖励',
         dict(markup=1.10, normal_reward_pct=0.10, vip_rp=0.25, max_layers=10, freeze_days=15)),
    ]

    for lottery_label, lottery_cost in lottery_scenarios:
        print(f'\n  [{lottery_label}]')
        b = replace(base, lottery_avg_prize_cost=lottery_cost)

        print(f'  {"配置":<25} {"加价":>5} {"普通":>5} {"VIP":>5} {"层数":>4} {"冻结":>4}'
              f'  {"默认净利率":>10} {"最坏净利率":>10} {"安全":>4}')
        print('  ' + '-' * 85)

        for label, cfg in combos:
            p = replace(b,
                markup=cfg['markup'],
                max_layers=cfg['max_layers'],
                freeze_days=cfg['freeze_days'],
            )
            p = apply_param(p, 'normal_reward_pct', cfg['normal_reward_pct'])
            if p is None:
                print(f'  {label:<25} → 无效组合（平台分成不足）')
                continue
            p = apply_param(p, 'vip_reward_pct', cfg['vip_rp'])
            if p is None:
                print(f'  {label:<25} → 无效组合（VIP比例过高）')
                continue

            # 默认
            rd = calculate_monthly_pnl(p)
            # 最坏
            pw = make_worst(p)
            rw = calculate_monthly_pnl(pw)

            safe = '✓' if rw['net_profit'] >= 0 else '✗'
            print(f'  {label:<25} {cfg["markup"]:>5.2f} {cfg["normal_reward_pct"]*100:>4.0f}% '
                  f'{cfg["vip_rp"]*100:>4.0f}% {cfg["max_layers"]:>4} {cfg["freeze_days"]:>4}'
                  f'  {rd["net_margin"]*100:>9.1f}% {rw["net_margin"]*100:>9.1f}%   {safe}')


def main():
    import io

    class Tee:
        def __init__(self, *files):
            self.files = files
        def write(self, text):
            for f in self.files:
                f.write(text)
        def flush(self):
            for f in self.files:
                f.flush()

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    report_path = os.path.join(OUTPUT_DIR, 'breakeven_report.txt')
    report_file = open(report_path, 'w', encoding='utf-8')
    old_stdout = sys.stdout
    sys.stdout = Tee(old_stdout, report_file)

    run_breakeven()

    sys.stdout = old_stdout
    report_file.close()
    print(f'\n报告已保存: {report_path}')


if __name__ == '__main__':
    main()
