#!/usr/bin/env python3
"""
普通用户树 — 多root × 叉数 对奖励公平性的影响

测试：不同root数量(1/10/50/100) × 叉数(2/3) 下，
同样10万用户，每层用户的奖励分布如何变化。
"""

import os
import math

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def analyze(total_users, n_roots, bf, max_layers, avg_cost, markup, reward_pct, freq):
    """
    多root树分析。
    total_users 平均分到 n_roots 棵子树中。
    """
    users_per_tree = total_users // n_roots
    if users_per_tree < 1:
        return None

    # 单棵子树的深度
    if bf == 1:
        tree_depth = users_per_tree
    else:
        tree_depth = int(math.ceil(math.log(users_per_tree * (bf - 1) + 1) / math.log(bf))) if users_per_tree > 0 else 0

    profit = avg_cost * (markup - 1)
    rpo = profit * reward_pct

    # 逐层计算（单棵子树内）
    level_data = []
    actual_users_sum = 0

    for L in range(1, tree_depth + 1):
        users_this_level = bf ** L
        # 最后一层可能不满
        remaining = users_per_tree - actual_users_sum
        if users_this_level > remaining:
            users_this_level = max(0, remaining)
        actual_users_sum += users_this_level
        if users_this_level <= 0:
            break

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
        level_data.append({
            'level': L,
            'users_per_tree': users_this_level,
            'users_total': users_this_level * n_roots,  # 所有树的该层用户
            'monthly': monthly,
        })

    grand_total = sum(ld['users_total'] for ld in level_data)
    total_monthly = sum(ld['monthly'] * ld['users_total'] for ld in level_data)
    avg_monthly = total_monthly / grand_total if grand_total > 0 else 0

    # 公平性指标
    zero_users = sum(ld['users_total'] for ld in level_data if ld['monthly'] == 0)
    zero_pct = zero_users / grand_total * 100 if grand_total > 0 else 0

    # 基尼系数（简化版：按层计算）
    rewards = []
    for ld in level_data:
        rewards.extend([ld['monthly']] * ld['users_total'])
    rewards.sort()
    n = len(rewards)
    if n > 0 and sum(rewards) > 0:
        cum = 0
        gini_sum = 0
        total_r = sum(rewards)
        for i, r in enumerate(rewards):
            cum += r
            gini_sum += (2 * (i + 1) - n - 1) * r
        gini = gini_sum / (n * total_r)
    else:
        gini = 0

    # Top vs Bottom
    top_users = sum(ld['users_total'] for ld in level_data[:3])
    top_reward = sum(ld['monthly'] * ld['users_total'] for ld in level_data[:3])
    top_pct = top_reward / total_monthly * 100 if total_monthly > 0 else 0

    # 中位数用户的奖励
    mid_idx = grand_total // 2
    cum_users = 0
    median_reward = 0
    for ld in level_data:
        cum_users += ld['users_total']
        if cum_users >= mid_idx:
            median_reward = ld['monthly']
            break

    return {
        'n_roots': n_roots,
        'bf': bf,
        'tree_depth': tree_depth,
        'users_per_tree': users_per_tree,
        'total_users': grand_total,
        'avg_monthly': avg_monthly,
        'total_monthly': total_monthly,
        'zero_pct': zero_pct,
        'gini': gini,
        'top3_pct': top_pct,
        'median_reward': median_reward,
        'max_reward': level_data[0]['monthly'] if level_data else 0,
        'levels': level_data,
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
    rpath = os.path.join(OUTPUT_DIR, 'balance_analysis_report.txt')
    rf = open(rpath, 'w', encoding='utf-8')
    old = sys.stdout
    sys.stdout = Tee(old, rf)

    # 参数
    total_users = 100_000
    avg_cost = 80.0
    markup = 1.30
    reward_pct = 0.16
    freq = 3.0
    max_layers = 10

    root_options = [1, 10, 50, 100, 500]
    bf_options = [2, 3]

    print('=' * 110)
    print('  普通用户树 — 多root × 叉数 对奖励公平性的影响')
    print('=' * 110)
    print(f'  总用户: {total_users:,} | 成本: {avg_cost}元 | 加价率: {markup} | 奖励: {reward_pct*100:.0f}%')
    print(f'  频率: {freq}次/月 | maxLayers: {max_layers} | 最坏情况')
    print()

    # ── 汇总对比 ──
    print('█' * 110)
    print('  汇总：不同root数 × 叉数 → 公平性指标')
    print('█' * 110)
    print(f'  {"root数":>8} {"叉数":>4} {"树深":>4} {"每树用户":>10} {"人均月奖":>10} '
          f'{"最高月奖":>12} {"中位数月奖":>10} {"奖励=0%":>8} {"Top3层占%":>10} {"基尼系数":>8}')
    print('  ' + '-' * 100)

    all_results = []
    for bf in bf_options:
        for nr in root_options:
            r = analyze(total_users, nr, bf, max_layers, avg_cost, markup, reward_pct, freq)
            if not r:
                continue
            all_results.append(r)
            print(f'  {nr:>8} {bf:>4} {r["tree_depth"]:>4} {r["users_per_tree"]:>10,} '
                  f'¥{r["avg_monthly"]:>8.2f} ¥{r["max_reward"]:>10,.0f} '
                  f'¥{r["median_reward"]:>8.2f} {r["zero_pct"]:>7.1f}% '
                  f'{r["top3_pct"]:>9.1f}% {r["gini"]:>7.3f}')

    # ── 逐层详细 ──
    # 选几个代表性组合详细展示
    showcase = [
        (1, 3, '1root×3叉（当前默认）'),
        (1, 2, '1root×2叉'),
        (10, 2, '10root×2叉'),
        (50, 2, '50root×2叉'),
        (100, 2, '100root×2叉'),
        (10, 3, '10root×3叉'),
        (100, 3, '100root×3叉'),
    ]

    for nr, bf, label in showcase:
        r = analyze(total_users, nr, bf, max_layers, avg_cost, markup, reward_pct, freq)
        if not r:
            continue

        print(f'\n{"=" * 90}')
        print(f'  {label}  (树深={r["tree_depth"]}, 每树={r["users_per_tree"]:,}人)')
        print(f'{"=" * 90}')
        print(f'  人均: ¥{r["avg_monthly"]:.2f} | 最高: ¥{r["max_reward"]:,.0f} | '
              f'中位数: ¥{r["median_reward"]:.2f} | 奖励=0: {r["zero_pct"]:.1f}% | 基尼: {r["gini"]:.3f}')
        print()
        print(f'  {"Level":>6} {"每树用户":>10} {"总用户":>10} {"占比":>7} {"月均奖励/人":>14}')
        print(f'  {"-"*55}')
        for ld in r['levels']:
            pct = ld['users_total'] / r['total_users'] * 100
            print(f'  {ld["level"]:>6} {ld["users_per_tree"]:>10,} {ld["users_total"]:>10,} '
                  f'{pct:>6.1f}% ¥{ld["monthly"]:>12,.2f}')

    # ── 结论 ──
    print(f'\n{"=" * 110}')
    print(f'  结论')
    print(f'{"=" * 110}')

    # 找最公平的配置
    best_gini = min(all_results, key=lambda x: x['gini'])
    best_zero = min(all_results, key=lambda x: x['zero_pct'])
    best_median = max(all_results, key=lambda x: x['median_reward'])

    print(f'''
  1. 基尼系数最低（最公平）: {best_gini['n_roots']}root × {best_gini['bf']}叉
     基尼={best_gini['gini']:.3f}, 奖励=0占{best_gini['zero_pct']:.1f}%, 人均¥{best_gini['avg_monthly']:.2f}

  2. 奖励=0最少: {best_zero['n_roots']}root × {best_zero['bf']}叉
     奖励=0占{best_zero['zero_pct']:.1f}%, 基尼={best_zero['gini']:.3f}

  3. 中位数奖励最高: {best_median['n_roots']}root × {best_median['bf']}叉
     中位数¥{best_median['median_reward']:.2f}, 人均¥{best_median['avg_monthly']:.2f}

  核心规律:
  - root数越多 → 树越浅 → 顶部用户奖励下降 → 更公平
  - 叉数越小 → 底层占比越少 → 更多人有奖励
  - 但人均奖励基本不变（总奖励池由订单利润决定，与树结构无关）
  - 公平性提高 = 顶部用户少拿 + 底部用户多拿 = 重新分配，不是凭空增加
''')

    sys.stdout = old
    rf.close()
    print(f'报告已保存: {rpath}')


if __name__ == '__main__':
    main()
