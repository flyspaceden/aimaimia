#!/usr/bin/env python3
"""
VIP树不同填充率下的人均奖励分析

VIP树通过推荐建树，填充率=每个节点平均推荐人数/叉数：
  50% → 平均每人推荐1.5个VIP
  75% → 平均每人推荐2.25个VIP
  100% → 满树，每人推荐3个VIP

13层深度，加价率1.05~1.40扫描。
"""

import os
import math

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def analyze_vip_tree(
    tree_depth: int,
    bf_full: int,
    fill_rate: float,
    max_layers: int,
    avg_cost: float,
    markup: float,
    reward_pct: float,
    freq: float,
    vip_discount: float,
):
    """
    计算VIP树在指定填充率下每层用户的月均奖励。
    fill_rate: 0~1，每个节点平均有 bf_full × fill_rate 个子节点
    """
    bf_eff = bf_full * fill_rate  # 有效叉数

    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost
    if profit <= 0:
        return None

    reward_per_order = profit * reward_pct

    total_users = 0
    total_monthly = 0
    level_data = []

    for L in range(1, tree_depth + 1):
        # 这一层的用户数（从10个根出发）
        users = 10 * (bf_eff ** L)
        if users < 1:
            users_int = max(1, int(round(users)))
        else:
            users_int = int(round(users))

        total_users += users_int

        # 该用户能收的层数
        max_k = min(max_layers, tree_depth - L)

        yearly = 0.0
        for k in range(1, max_k + 1):
            if L + k > tree_depth:
                break
            # 该用户子树中距离k层的后代数
            descendants = bf_eff ** k
            months_needed = math.ceil(k / freq)
            if months_needed <= 12:
                yearly += descendants * reward_per_order

        monthly = yearly / 12.0
        total_monthly += monthly * users_int
        level_data.append({
            'level': L,
            'users': users_int,
            'monthly': monthly,
            'yearly': yearly,
            'max_k': max_k,
        })

    avg = total_monthly / total_users if total_users > 0 else 0
    return {
        'total_users': total_users,
        'total_monthly': total_monthly,
        'avg_monthly': avg,
        'levels': level_data,
        'bf_eff': bf_eff,
    }


def main():
    import sys, io

    class Tee:
        def __init__(self, *f):
            self.files = f
        def write(self, t):
            for f in self.files:
                f.write(t)
        def flush(self):
            for f in self.files:
                f.flush()

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    rpath = os.path.join(OUTPUT_DIR, 'vip_tree_fill_report.txt')
    rf = open(rpath, 'w', encoding='utf-8')
    old = sys.stdout
    sys.stdout = Tee(old, rf)

    tree_depth = 13
    bf = 3
    max_layers = 15
    avg_cost = 120.0
    reward_pct = 0.30
    freq = 6.0
    vip_discount = 0.95

    fill_rates = [0.50, 0.75, 1.00]
    markups = [1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40]

    print('=' * 100)
    print('  VIP树不同填充率下的人均奖励分析（最坏情况，13层深度）')
    print('=' * 100)
    print(f'  VIP参数: 成本={avg_cost}元, 折扣={vip_discount}, 奖励比例={reward_pct*100:.0f}%, 频率={freq}次/月')
    print(f'  填充率说明:')
    for fr in fill_rates:
        eff = bf * fr
        n = 0
        for L in range(1, tree_depth + 1):
            n += int(round(10 * eff ** L))
        print(f'    {fr*100:.0f}%填充 → 平均每人推荐{eff:.1f}个VIP → 总用户≈{n:,}')
    print()

    # ── 汇总对比表 ──
    print('█' * 100)
    print('  汇总：不同加价率 × 不同填充率 → 人均月奖励')
    print('█' * 100)

    header = f'  {"加价率":>6} {"售价":>6} {"利润":>6} {"每笔奖励":>8}'
    for fr in fill_rates:
        header += f'  {f"{fr*100:.0f}%填充":>12}'
    print(header)
    print('  ' + '-' * (30 + 14 * len(fill_rates)))

    for markup in markups:
        sale = avg_cost * markup * vip_discount
        profit = sale - avg_cost
        rpo = profit * reward_pct
        line = f'  {markup:>6.2f} ¥{sale:>4.0f} ¥{profit:>4.0f} ¥{rpo:>7.2f}'
        for fr in fill_rates:
            r = analyze_vip_tree(tree_depth, bf, fr, max_layers, avg_cost, markup, reward_pct, freq, vip_discount)
            if r:
                line += f'  ¥{r["avg_monthly"]:>10.2f}'
            else:
                line += f'  {"利润≤0":>12}'
        print(line)

    # ── 逐层详细（加价率1.30）──
    for fr in fill_rates:
        eff = bf * fr
        print(f'\n{"=" * 100}')
        print(f'  {fr*100:.0f}%填充（每人推荐{eff:.1f}个VIP）加价率=1.30 逐层详细')
        print(f'{"=" * 100}')

        r = analyze_vip_tree(tree_depth, bf, fr, max_layers, avg_cost, 1.30, reward_pct, freq, vip_discount)
        if not r:
            print('  利润≤0，无奖励')
            continue

        print(f'  有效叉数: {r["bf_eff"]:.2f} | 总用户: {r["total_users"]:,} | 人均月奖: ¥{r["avg_monthly"]:.2f}')
        print()
        print(f'  {"Level":>6} {"用户数":>12} {"占比":>7} {"可收层数":>8} {"月均奖励/人":>14} {"年总奖励/人":>14}')
        print(f'  {"-"*70}')

        for ld in r['levels']:
            pct = ld['users'] / r['total_users'] * 100
            print(f'  {ld["level"]:>6} {ld["users"]:>12,} {pct:>6.1f}% {ld["max_k"]:>8} '
                  f'¥{ld["monthly"]:>12,.2f} ¥{ld["yearly"]:>12,.2f}')

        print(f'  {"-"*70}')
        print(f'  {"平均":>6} {r["total_users"]:>12,} {"100%":>7} {"":>8} '
              f'¥{r["avg_monthly"]:>12,.2f}')

        # 底部分析
        bottom = r['levels'][-1]
        zero_users = sum(ld['users'] for ld in r['levels'] if ld['max_k'] == 0)
        top3_users = sum(ld['users'] for ld in r['levels'][:3])
        top3_reward = sum(ld['monthly'] * ld['users'] for ld in r['levels'][:3])
        top3_pct = top3_reward / r['total_monthly'] * 100 if r['total_monthly'] > 0 else 0

        print(f'\n  底层(Level {bottom["level"]}): {bottom["users"]:,}人, 月均¥{bottom["monthly"]:.2f}')
        print(f'  奖励=0的用户: {zero_users:,}人 ({zero_users/r["total_users"]*100:.1f}%)')
        print(f'  顶部3层: {top3_users:,}人, 占总奖励 {top3_pct:.1f}%')

    # ── 对比：同一层用户在不同填充率下的奖励差异 ──
    print(f'\n{"=" * 100}')
    print(f'  同一层用户在不同填充率下的月均奖励对比（加价率=1.30）')
    print(f'{"=" * 100}')

    results_by_fill = {}
    for fr in fill_rates:
        results_by_fill[fr] = analyze_vip_tree(tree_depth, bf, fr, max_layers, avg_cost, 1.30, reward_pct, freq, vip_discount)

    header = f'  {"Level":>6}'
    for fr in fill_rates:
        header += f'  {f"{fr*100:.0f}%月均奖":>14}  {f"{fr*100:.0f}%用户数":>10}'
    print(header)
    print('  ' + '-' * (6 + 26 * len(fill_rates)))

    for L in range(1, tree_depth + 1):
        line = f'  {L:>6}'
        for fr in fill_rates:
            r = results_by_fill[fr]
            if r and L - 1 < len(r['levels']):
                ld = r['levels'][L - 1]
                line += f'  ¥{ld["monthly"]:>12,.2f}  {ld["users"]:>10,}'
            else:
                line += f'  {"—":>14}  {"—":>10}'
        print(line)

    print()
    line = f'  {"人均":>6}'
    for fr in fill_rates:
        r = results_by_fill[fr]
        if r:
            line += f'  ¥{r["avg_monthly"]:>12,.2f}  {r["total_users"]:>10,}'
    print(line)

    # ── maxLayers扫描（按填充率）──
    print(f'\n{"=" * 100}')
    print(f'  maxLayers × 填充率 → 人均月奖（加价率=1.30）')
    print(f'{"=" * 100}')

    ml_range = list(range(5, 14))
    header = f'  {"maxLayers":>10}'
    for fr in fill_rates:
        header += f'  {f"{fr*100:.0f}%人均月奖":>14}'
    print(header)
    print('  ' + '-' * (10 + 16 * len(fill_rates)))

    for ml in ml_range:
        line = f'  {ml:>10}'
        for fr in fill_rates:
            r = analyze_vip_tree(tree_depth, bf, fr, ml, avg_cost, 1.30, reward_pct, freq, vip_discount)
            if r:
                line += f'  ¥{r["avg_monthly"]:>12.2f}'
            else:
                line += f'  {"—":>14}'
        print(line)

    print()
    sys.stdout = old
    rf.close()
    print(f'报告已保存: {rpath}')


if __name__ == '__main__':
    main()
