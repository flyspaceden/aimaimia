#!/usr/bin/env python3
"""
农脉分润奖励系统 — maxLayers 对人均奖励的影响

固定13层三叉树（~239万用户），扫描 maxLayers=5~13，
分别计算普通树和VIP树每个用户的平均月奖励。
加价率扫描 1.05~1.40。最坏情况。
"""

import os
import math

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def calc_avg_reward(
    tree_depth: int,
    bf: int,
    max_layers: int,
    avg_cost: float,
    markup: float,
    reward_pct: float,
    freq: float,
    vip_discount: float = 1.0,
):
    """
    计算整棵树所有用户的平均月奖励。
    返回: (人均月奖, 总月流出, 各层数据列表)
    """
    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost
    if profit <= 0:
        total_users = (bf ** (tree_depth + 1) - 1) // (bf - 1) - 1
        return 0, 0, total_users, []

    reward_per_order = profit * reward_pct

    total_users = 0
    total_monthly_reward = 0
    level_data = []

    for L in range(1, tree_depth + 1):
        users = bf ** L
        total_users += users

        max_k = min(max_layers, tree_depth - L)
        yearly = 0.0
        for k in range(1, max_k + 1):
            if L + k > tree_depth:
                break
            descendants = bf ** k
            months_needed = math.ceil(k / freq)
            if months_needed <= 12:
                yearly += descendants * reward_per_order

        monthly = yearly / 12.0
        total_monthly_reward += monthly * users
        level_data.append({
            'level': L,
            'users': users,
            'monthly': monthly,
            'max_k': max_k,
        })

    avg_monthly = total_monthly_reward / total_users if total_users > 0 else 0
    return avg_monthly, total_monthly_reward, total_users, level_data


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
    rpath = os.path.join(OUTPUT_DIR, 'maxlayer_avg_reward.txt')
    rf = open(rpath, 'w', encoding='utf-8')
    old = sys.stdout
    sys.stdout = Tee(old, rf)

    tree_depth = 13
    bf = 3
    markups = [1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40]
    max_layers_range = list(range(5, 14))  # 5~13

    total_users = (bf ** (tree_depth + 1) - 1) // (bf - 1) - 1
    print('=' * 100)
    print('  maxLayers 对人均奖励的影响（13层三叉树，最坏情况，所有人同时在树里）')
    print('=' * 100)
    print(f'  树深: {tree_depth}层 | 叉数: {bf} | 总用户: {total_users:,}')
    print()

    # ── 普通用户 ──
    print('█' * 100)
    print('  普通用户树（成本80元，奖励16%，频率3次/月）')
    print('█' * 100)

    # 表头
    header = f'  {"加价率":>6} {"售价":>6} {"利润":>6} {"每笔奖励":>8}'
    for ml in max_layers_range:
        header += f' {"ML="+str(ml):>10}'
    print(header)
    print('  ' + '-' * (30 + 11 * len(max_layers_range)))

    for markup in markups:
        sale = 80 * markup
        profit = sale - 80
        rpo = profit * 0.16
        line = f'  {markup:>6.2f} ¥{sale:>4.0f} ¥{profit:>4.0f} ¥{rpo:>7.2f}'
        for ml in max_layers_range:
            avg, _, _, _ = calc_avg_reward(tree_depth, bf, ml, 80, markup, 0.16, 3.0)
            line += f' ¥{avg:>8.2f}'
        print(line)

    # 逐层详细（加价率1.30）
    print(f'\n  加价率=1.30 逐层详细:')
    header2 = f'  {"Level":>6} {"用户数":>10} {"占比":>7}'
    for ml in max_layers_range:
        header2 += f' {"ML="+str(ml):>10}'
    print(header2)
    print('  ' + '-' * (25 + 11 * len(max_layers_range)))

    for L in range(1, tree_depth + 1):
        users = bf ** L
        pct = users / total_users * 100
        line = f'  {L:>6} {users:>10,} {pct:>6.1f}%'
        for ml in max_layers_range:
            _, _, _, ld = calc_avg_reward(tree_depth, bf, ml, 80, 1.30, 0.16, 3.0)
            m = ld[L - 1]['monthly'] if L - 1 < len(ld) else 0
            line += f' ¥{m:>8.0f}'
        print(line)

    # 总流出
    print(f'\n  月度总流出对比:')
    line = f'  {"":>30}'
    for ml in max_layers_range:
        line += f' {"ML="+str(ml):>10}'
    print(line)
    print('  ' + '-' * (30 + 11 * len(max_layers_range)))
    for markup in markups:
        line = f'  加价率={markup:.2f}                '
        for ml in max_layers_range:
            _, total, _, _ = calc_avg_reward(tree_depth, bf, ml, 80, markup, 0.16, 3.0)
            line += f' ¥{total/10000:>7.0f}万'
        print(line)

    # ── VIP用户 ──
    print('\n' + '█' * 100)
    print('  VIP用户树（成本120元，折扣0.95，奖励30%，频率6次/月）')
    print('█' * 100)

    header = f'  {"加价率":>6} {"售价":>6} {"利润":>6} {"每笔奖励":>8}'
    for ml in max_layers_range:
        header += f' {"ML="+str(ml):>10}'
    print(header)
    print('  ' + '-' * (30 + 11 * len(max_layers_range)))

    for markup in markups:
        sale = 120 * markup * 0.95
        profit = sale - 120
        rpo = profit * 0.30
        line = f'  {markup:>6.2f} ¥{sale:>4.0f} ¥{profit:>4.0f} ¥{rpo:>7.2f}'
        for ml in max_layers_range:
            avg, _, _, _ = calc_avg_reward(tree_depth, bf, ml, 120, markup, 0.30, 6.0, 0.95)
            line += f' ¥{avg:>8.2f}'
        print(line)

    # VIP逐层详细（加价率1.30）
    print(f'\n  加价率=1.30 逐层详细:')
    print(header2)
    print('  ' + '-' * (25 + 11 * len(max_layers_range)))

    for L in range(1, tree_depth + 1):
        users = bf ** L
        pct = users / total_users * 100
        line = f'  {L:>6} {users:>10,} {pct:>6.1f}%'
        for ml in max_layers_range:
            _, _, _, ld = calc_avg_reward(tree_depth, bf, ml, 120, 1.30, 0.30, 6.0, 0.95)
            m = ld[L - 1]['monthly'] if L - 1 < len(ld) else 0
            line += f' ¥{m:>8.0f}'
        print(line)

    # VIP总流出
    print(f'\n  月度总流出对比:')
    print(f'  {"":>30}', end='')
    for ml in max_layers_range:
        print(f' {"ML="+str(ml):>10}', end='')
    print()
    print('  ' + '-' * (30 + 11 * len(max_layers_range)))
    for markup in markups:
        line = f'  加价率={markup:.2f}                '
        for ml in max_layers_range:
            _, total, _, _ = calc_avg_reward(tree_depth, bf, ml, 120, markup, 0.30, 6.0, 0.95)
            line += f' ¥{total/10000:>7.0f}万'
        print(line)

    # ── 综合对比 ──
    print('\n' + '=' * 100)
    print('  综合：maxLayers 每增加1层，人均月奖励增加多少？（加价率1.30）')
    print('=' * 100)
    print(f'  {"maxLayers":>10} {"普通人均/月":>12} {"较上层增量":>12} {"VIP人均/月":>12} {"较上层增量":>12}')
    print('  ' + '-' * 60)

    prev_n, prev_v = 0, 0
    for ml in max_layers_range:
        avg_n, _, _, _ = calc_avg_reward(tree_depth, bf, ml, 80, 1.30, 0.16, 3.0)
        avg_v, _, _, _ = calc_avg_reward(tree_depth, bf, ml, 120, 1.30, 0.30, 6.0, 0.95)
        delta_n = avg_n - prev_n
        delta_v = avg_v - prev_v
        pct_n = f'+{delta_n/prev_n*100:.0f}%' if prev_n > 0 else '—'
        pct_v = f'+{delta_v/prev_v*100:.0f}%' if prev_v > 0 else '—'
        print(f'  {ml:>10} ¥{avg_n:>10.2f} ¥{delta_n:>8.2f}({pct_n:>5}) '
              f'¥{avg_v:>10.2f} ¥{delta_v:>8.2f}({pct_v:>5})')
        prev_n, prev_v = avg_n, avg_v

    print()
    sys.stdout = old
    rf.close()
    print(f'报告已保存: {rpath}')


if __name__ == '__main__':
    main()
