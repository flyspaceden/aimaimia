#!/usr/bin/env python3
"""
普通用户树 — 叉数(1/2/3) × maxLayers(6~10) 逐层人均奖励分析

普通树：轮询平衡插入，无推荐码。
最坏情况，加价率1.30，所有人同时在树里。
"""

import os
import math

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def calc_tree(tree_depth, bf, max_layers, avg_cost, markup, reward_pct, freq):
    """计算每层月均奖励"""
    profit = avg_cost * (markup - 1)
    if profit <= 0:
        return None
    rpo = profit * reward_pct

    total_users = 0
    total_monthly = 0
    levels = []

    for L in range(1, tree_depth + 1):
        users = bf ** L
        total_users += users

        max_k = min(max_layers, tree_depth - L)
        yearly = 0.0
        for k in range(1, max_k + 1):
            if L + k > tree_depth:
                break
            desc = bf ** k
            months = math.ceil(k / freq)
            if months <= 12:
                yearly += desc * rpo

        monthly = yearly / 12.0
        total_monthly += monthly * users
        levels.append({
            'level': L,
            'users': users,
            'monthly': monthly,
            'yearly': yearly,
            'max_k': max_k,
        })

    avg = total_monthly / total_users if total_users > 0 else 0
    return {
        'total_users': total_users,
        'total_monthly': total_monthly,
        'avg_monthly': avg,
        'levels': levels,
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
    rpath = os.path.join(OUTPUT_DIR, 'normal_tree_branch_report.txt')
    rf = open(rpath, 'w', encoding='utf-8')
    old = sys.stdout
    sys.stdout = Tee(old, rf)

    # 参数
    avg_cost = 80.0
    markup = 1.30
    reward_pct = 0.16
    freq = 3.0
    profit = avg_cost * (markup - 1)
    rpo = profit * reward_pct

    branches = [1, 2, 3]
    ml_range = list(range(6, 11))  # 6~10

    # 树深度：取足够深让 maxLayers 充分生效
    # 1叉树深度=用户数，需要特别处理
    # 2叉树13层=8191用户，3叉树13层=239万用户
    # 统一用足够深的树（让 tree_depth > max(ml_range) 保证所有层都能收满）
    tree_depths = {1: 30, 2: 20, 3: 13}  # 各叉数的树深度

    print('=' * 110)
    print('  普通用户树 — 叉数(1/2/3) × maxLayers(6~10) 逐层人均奖励')
    print('=' * 110)
    print(f'  参数: 成本={avg_cost}元, 加价率={markup}, 利润={profit}元, 奖励比例={reward_pct*100:.0f}%')
    print(f'  每笔奖励={rpo:.2f}元, 频率={freq}次/月, 最坏情况(100%解锁+提现)')
    print()

    # 各叉数的树信息
    for bf in branches:
        td = tree_depths[bf]
        total = sum(bf ** L for L in range(1, td + 1))
        print(f'  {bf}叉树: 深度={td}层, 总用户={total:,}')
    print()

    # ── 汇总表：叉数 × maxLayers → 人均月奖 ──
    print('█' * 110)
    print('  汇总：叉数 × maxLayers → 全树人均月奖')
    print('█' * 110)

    header = f'  {"":>12}'
    for ml in ml_range:
        header += f'  {"ML="+str(ml):>12}'
    print(header)
    print('  ' + '-' * (12 + 14 * len(ml_range)))

    for bf in branches:
        td = tree_depths[bf]
        line = f'  {bf}叉树      '
        for ml in ml_range:
            r = calc_tree(td, bf, ml, avg_cost, markup, reward_pct, freq)
            line += f'  ¥{r["avg_monthly"]:>10.2f}'
        print(line)

    # ── 每种叉数 × 每种maxLayers 的逐层详细 ──
    for bf in branches:
        td = tree_depths[bf]
        total_users = sum(bf ** L for L in range(1, td + 1))

        print(f'\n{"█" * 110}')
        print(f'  {bf}叉树 逐层详细（树深={td}, 总用户={total_users:,}）')
        print(f'{"█" * 110}')

        # 表头
        header = f'  {"Level":>6} {"用户数":>12} {"占比":>7}'
        for ml in ml_range:
            header += f'  {"ML="+str(ml):>10}'
        print(header)
        print('  ' + '-' * (27 + 12 * len(ml_range)))

        # 预计算所有 maxLayers 结果
        results = {}
        for ml in ml_range:
            results[ml] = calc_tree(td, bf, ml, avg_cost, markup, reward_pct, freq)

        # 只显示有意义的层（有奖励的层 + 几层0的）
        # 对于1叉树层数太多，只显示前 max(ml_range)+5 层
        show_depth = min(td, max(ml_range) + 5)

        for L in range(1, show_depth + 1):
            users = bf ** L
            pct = users / total_users * 100
            line = f'  {L:>6} {users:>12,} {pct:>6.1f}%'
            for ml in ml_range:
                r = results[ml]
                if L - 1 < len(r['levels']):
                    m = r['levels'][L - 1]['monthly']
                    if m >= 1:
                        line += f'  ¥{m:>8,.0f}'
                    else:
                        line += f'  ¥{m:>8.2f}'
                else:
                    line += f'  {"—":>10}'
            print(line)

        # 如果还有更深的层
        if show_depth < td:
            remaining_users = sum(bf ** L for L in range(show_depth + 1, td + 1))
            remaining_pct = remaining_users / total_users * 100
            print(f'  {"...":>6} {remaining_users:>12,} {remaining_pct:>6.1f}%', end='')
            for ml in ml_range:
                print(f'  {"¥0":>10}', end='')
            print()

        # 汇总行
        print('  ' + '-' * (27 + 12 * len(ml_range)))
        line = f'  {"人均":>6} {total_users:>12,} {"100%":>7}'
        for ml in ml_range:
            r = results[ml]
            line += f'  ¥{r["avg_monthly"]:>8.2f}'
        print(line)

        # 统计
        print()
        for ml in ml_range:
            r = results[ml]
            zero_users = sum(ld['users'] for ld in r['levels'] if ld['max_k'] == 0)
            zero_pct = zero_users / total_users * 100
            top3_reward = sum(ld['monthly'] * ld['users'] for ld in r['levels'][:3])
            top3_pct = top3_reward / r['total_monthly'] * 100 if r['total_monthly'] > 0 else 0
            print(f'    ML={ml}: 奖励=0占{zero_pct:.1f}%, 月总流出¥{r["total_monthly"]:,.0f}, '
                  f'顶部3层占奖励{top3_pct:.1f}%')

    # ── 核心对比：同一maxLayers下，不同叉数的差异 ──
    print(f'\n{"=" * 110}')
    print(f'  核心对比：同一maxLayers下，1叉/2叉/3叉的人均月奖与总流出')
    print(f'{"=" * 110}')

    print(f'  {"maxLayers":>10}', end='')
    for bf in branches:
        print(f'  {f"{bf}叉人均":>10} {f"{bf}叉总流出":>12}', end='')
    print()
    print('  ' + '-' * (10 + 24 * len(branches)))

    for ml in ml_range:
        line = f'  {ml:>10}'
        for bf in branches:
            td = tree_depths[bf]
            r = calc_tree(td, bf, ml, avg_cost, markup, reward_pct, freq)
            line += f'  ¥{r["avg_monthly"]:>8.2f} ¥{r["total_monthly"]/10000:>9.0f}万'
        print(line)

    # ── 1叉树特殊分析（链式结构）──
    print(f'\n{"=" * 110}')
    print(f'  1叉树特殊说明（链式结构）')
    print(f'{"=" * 110}')
    print(f'''
  1叉树 = 链表，每层只有1个用户。
  用户在位置P的后代 = 位置P+1, P+2, ..., P+maxLayers
  每个后代只贡献1笔奖励（第k次消费发给第k个祖辈）

  1叉树的特点：
  - 奖励分布最均匀（除了底部maxLayers个用户，其余人奖励相同）
  - 人均奖励最低（每层只有1个后代，不像3叉树有3^k个）
  - 但底部用户占比也最低（maxLayers/总用户，而非66.7%）
  - 总奖励流出最少（对平台最有利）
''')

    print()
    sys.stdout = old
    rf.close()
    print(f'报告已保存: {rpath}')


if __name__ == '__main__':
    main()
