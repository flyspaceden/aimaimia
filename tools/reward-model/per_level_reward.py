#!/usr/bin/env python3
"""
农脉分润奖励系统 — 逐层人均奖励分析

计算三叉树13层中，每一层用户的月均奖励收入。
最坏情况（100%解锁+100%提现），所有人同时在树里。
加价率扫描 1.05 ~ 1.40。

用法：
  python per_level_reward.py
"""

import os
import math
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'Heiti TC', 'PingFang SC', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def analyze_per_level(
    tree_depth: int = 13,
    bf: int = 3,
    max_layers: int = 15,
    avg_cost: float = 80.0,
    markup: float = 1.30,
    reward_pct: float = 0.16,
    freq: float = 3.0,
    label: str = '普通用户',
    vip_discount: float = 1.0,  # 普通=1.0, VIP=0.95
):
    """
    逐层计算每个用户的月均奖励。
    最坏情况：100%解锁，所有后代每次消费都产生奖励。
    """

    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost
    reward_per_order = profit * reward_pct  # 每笔订单产生的奖励金额

    levels = list(range(0, tree_depth + 1))  # 0=根, 1~tree_depth=用户层

    results = []
    total_users = 0

    for L in levels:
        if L == 0:
            # 根节点：平台系统节点，不算用户
            results.append({
                'level': 0,
                'users': 1,
                'is_root': True,
                'descendants': 0,
                'monthly_reward': 0,
                'yearly_reward': 0,
                'monthly_orders_generating_reward': 0,
            })
            continue

        # 这一层的用户数
        users_at_level = bf ** L

        # 该用户的后代在 level L+1, L+2, ..., tree_depth
        # 每个后代的第k次消费（k = 后代与该用户的距离）发奖励给该用户
        # k的范围：1 到 min(maxLayers, tree_depth - L)
        max_k = min(max_layers, tree_depth - L)

        monthly_reward = 0.0
        total_contributing_orders = 0

        for k in range(1, max_k + 1):
            # level L+k 上，属于该用户子树的后代数 = bf^k
            descendants_at_k = bf ** k

            # 最坏情况：每个后代每月消费 freq 次
            # 但只有第 k 次消费才给这个祖辈发奖励
            # 在稳态月均模型中：每个后代每月贡献 1 笔"第k次消费"的奖励？
            # 不对。第k次消费是一次性的（用户一辈子只有一个第k次）。
            #
            # 正确理解：
            # - 后代的第k次有效消费，只发生一次
            # - 但在稳态中，我们计算"月均"，相当于所有后代在一个月内各消费freq次
            # - 新后代不断加入（但题设所有人同时在树里）
            #
            # 所以在"所有人同时在树里+最坏情况"下：
            # - 每个后代一辈子只给该祖辈发1笔奖励（他的第k次消费）
            # - 不是月均概念，而是一次性总收入
            #
            # 但如果要算"月均"，需要假设每月有多少后代完成第k次消费
            # 如果 freq=3次/月，第k次消费发生在第 ceil(k/freq) 个月
            # 第1次：第1个月
            # 第3次：第1个月
            # 第4次：第2个月
            # 第9次：第3个月
            # 第15次：第5个月
            #
            # 在稳态中（所有人已经在树里足够久），每月流入 = 0（因为所有人都已经贡献过了）
            # 这不对——我们应该换个思路。
            pass

        # 重新思考：
        # 在"所有人同时在树里 + 最坏情况"下，
        # 每个用户一辈子能从第k层后代收到的奖励 = bf^k × reward_per_order（一次性）
        # 总收入 = Σ(k=1 to max_k) bf^k × reward_per_order
        #
        # 如果要算月均：每个后代第k次消费发生在第 ceil(k/freq) 个月
        # 所以第k层的奖励集中在第 ceil(k/freq) 个月到达
        #
        # 更实用的方式：算 12个月总收入 / 12 = 月均
        # 12个月内后代能完成的最大消费次数 = freq × 12
        # 能触发的最大k = min(freq×12, max_k)

        max_k_in_year = min(int(freq * 12), max_k)
        yearly_reward = 0.0
        reward_by_k = []

        for k in range(1, max_k + 1):
            descendants_at_k = bf ** k
            # 检查这些后代在树内是否真的存在（不超过树的实际大小）
            actual_level = L + k
            if actual_level > tree_depth:
                break

            # 12个月内，每个后代是否能完成第k次消费？
            months_needed = math.ceil(k / freq)
            if months_needed <= 12:
                # 在12个月内能完成，贡献1笔
                reward_from_k = descendants_at_k * reward_per_order
            else:
                reward_from_k = 0  # 12个月内来不及消费到第k次

            yearly_reward += reward_from_k
            reward_by_k.append({
                'k': k,
                'descendants': descendants_at_k,
                'months_needed': months_needed,
                'reward': reward_from_k,
            })

        monthly_avg = yearly_reward / 12.0
        total_users += users_at_level

        results.append({
            'level': L,
            'users': users_at_level,
            'is_root': False,
            'max_k': max_k,
            'max_k_in_year': max_k_in_year,
            'monthly_reward': monthly_avg,
            'yearly_reward': yearly_reward,
            'reward_by_k': reward_by_k,
        })

    return results, total_users, reward_per_order


def print_results(results, total_users, reward_per_order, markup, label, reward_pct,
                  avg_cost, freq, bf, max_layers, tree_depth, vip_discount=1.0):
    """打印逐层分析"""

    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost

    print(f'\n{"=" * 90}')
    print(f'  {label} 逐层人均奖励分析（最坏情况：100%解锁+提现）')
    print(f'{"=" * 90}')
    print(f'  参数: 成本={avg_cost}元, 加价率={markup}, 售价={sale:.1f}元, 利润={profit:.1f}元')
    print(f'  奖励比例={reward_pct*100:.0f}%, 每笔奖励={reward_per_order:.2f}元')
    print(f'  叉数={bf}, 树深={tree_depth}层, maxLayers={max_layers}, 频率={freq}次/月')
    print(f'  总用户数: {total_users:,}')
    print()

    print(f'  {"Level":>6} {"用户数":>10} {"占比":>7} {"可收层数":>8} '
          f'{"年总奖励/人":>14} {"月均奖励/人":>14} {"月均等价消费":>14}')
    print(f'  {"-"*80}')

    total_yearly_reward = 0
    total_monthly_reward = 0

    for r in results:
        if r['is_root']:
            print(f'  {"根":>6} {"1":>10} {"—":>7} {"—":>8} {"平台":>14} {"—":>14} {"—":>14}')
            continue

        pct = r['users'] / total_users * 100
        equiv_orders = r['monthly_reward'] / sale if sale > 0 else 0  # 等价于多少单消费

        print(f'  {r["level"]:>6} {r["users"]:>10,} {pct:>6.1f}% {r["max_k"]:>8} '
              f'¥{r["yearly_reward"]:>12,.2f} ¥{r["monthly_reward"]:>12,.2f} '
              f'{equiv_orders:>12.1f}单')

        total_yearly_reward += r['yearly_reward'] * r['users']
        total_monthly_reward += r['monthly_reward'] * r['users']

    print(f'  {"-"*80}')
    avg_yearly = total_yearly_reward / total_users if total_users > 0 else 0
    avg_monthly = total_monthly_reward / total_users if total_users > 0 else 0
    print(f'  {"全树":>6} {total_users:>10,} {"100%":>7} {"":>8} '
          f'¥{avg_yearly:>12,.2f} ¥{avg_monthly:>12,.2f} {"(人均)":>14}')
    print()

    # 分位统计
    # 底部用户（最后1层）占多少比例
    bottom = results[-1]
    if not bottom['is_root']:
        bottom_pct = bottom['users'] / total_users * 100
        print(f'  底部分析:')
        print(f'    最底层(Level {bottom["level"]}): {bottom["users"]:,}人 ({bottom_pct:.1f}%), '
              f'月均奖励 ¥{bottom["monthly_reward"]:.2f}')

    # 顶部用户
    top3_users = sum(r['users'] for r in results[1:4] if not r['is_root'])
    top3_reward = sum(r['yearly_reward'] * r['users'] for r in results[1:4] if not r['is_root'])
    top3_pct = top3_users / total_users * 100 if total_users > 0 else 0
    top3_reward_pct = top3_reward / total_yearly_reward * 100 if total_yearly_reward > 0 else 0
    print(f'    顶部3层(Level 1-3): {top3_users:,}人 ({top3_pct:.1f}%), '
          f'占全树奖励 {top3_reward_pct:.1f}%')

    # 奖励为0的用户（max_k=0，即树底没有后代的人）
    zero_users = sum(r['users'] for r in results if not r['is_root'] and r.get('max_k', 0) == 0)
    zero_pct = zero_users / total_users * 100 if total_users > 0 else 0
    print(f'    奖励=0的用户: {zero_users:,}人 ({zero_pct:.1f}%)')

    print(f'\n  全树年度奖励总流出: ¥{total_yearly_reward:,.0f}')
    print(f'  全树月度奖励总流出: ¥{total_monthly_reward:,.0f}')

    return {
        'total_yearly': total_yearly_reward,
        'total_monthly': total_monthly_reward,
        'avg_monthly': avg_monthly,
        'results': results,
    }


def run_markup_sweep():
    """加价率扫描 1.05 ~ 1.40"""

    tree_depth = 13
    bf = 3
    max_layers = 15
    freq_normal = 3.0
    freq_vip = 6.0
    avg_cost_normal = 80.0
    avg_cost_vip = 120.0
    normal_reward_pct = 0.16
    vip_reward_pct = 0.30

    markups = [1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40]

    # 需要的用户数：三叉树13层
    n_users = (bf ** (tree_depth + 1) - 1) // (bf - 1) - 1  # 减去根节点
    print(f'三叉树13层需要 {n_users:,} 用户\n')

    all_summaries = []

    for markup in markups:
        print('\n' + '#' * 90)
        print(f'  加价率 = {markup}')
        print('#' * 90)

        # 普通用户
        r_n, total_n, rpo_n = analyze_per_level(
            tree_depth=tree_depth, bf=bf, max_layers=max_layers,
            avg_cost=avg_cost_normal, markup=markup, reward_pct=normal_reward_pct,
            freq=freq_normal, label='普通用户', vip_discount=1.0,
        )
        s_n = print_results(r_n, total_n, rpo_n, markup, '普通用户', normal_reward_pct,
                            avg_cost_normal, freq_normal, bf, max_layers, tree_depth)

        # VIP用户
        r_v, total_v, rpo_v = analyze_per_level(
            tree_depth=tree_depth, bf=bf, max_layers=max_layers,
            avg_cost=avg_cost_vip, markup=markup, reward_pct=vip_reward_pct,
            freq=freq_vip, label='VIP用户', vip_discount=0.95,
        )
        s_v = print_results(r_v, total_v, rpo_v, markup, 'VIP用户', vip_reward_pct,
                            avg_cost_vip, freq_vip, bf, max_layers, tree_depth)

        all_summaries.append({
            'markup': markup,
            'normal': s_n,
            'vip': s_v,
        })

    # 汇总对比表
    print('\n' + '=' * 90)
    print('  加价率对比汇总（最坏情况，13层三叉树）')
    print('=' * 90)

    print(f'\n  {"":>8} {"──── 普通用户 ────":>40} {"──── VIP用户 ────":>40}')
    print(f'  {"加价率":>8} {"每笔奖励":>10} {"人均月奖":>10} {"Level1月奖":>12} '
          f'{"每笔奖励":>10} {"人均月奖":>10} {"Level1月奖":>12}')
    print(f'  {"-"*82}')

    for s in all_summaries:
        rpo_n = s['normal']['results'][1]['yearly_reward'] / 12 if len(s['normal']['results']) > 1 else 0
        rpo_v = s['vip']['results'][1]['yearly_reward'] / 12 if len(s['vip']['results']) > 1 else 0
        n_per_order = s['markup'] * 80 - 80
        v_per_order = s['markup'] * 120 * 0.95 - 120

        print(f'  {s["markup"]:>8.2f} '
              f'¥{n_per_order * 0.16:>8.2f} ¥{s["normal"]["avg_monthly"]:>8.2f} '
              f'¥{s["normal"]["results"][1]["monthly_reward"]:>10,.2f} '
              f'¥{v_per_order * 0.30:>8.2f} ¥{s["vip"]["avg_monthly"]:>8.2f} '
              f'¥{s["vip"]["results"][1]["monthly_reward"]:>10,.2f}')

    # 生成图表
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 图1: 不同加价率下各层月均奖励（普通用户）
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(18, 8))

    for s in all_summaries:
        levels = [r['level'] for r in s['normal']['results'] if not r['is_root']]
        rewards = [r['monthly_reward'] for r in s['normal']['results'] if not r['is_root']]
        ax1.plot(levels, rewards, 'o-', label=f'加价率{s["markup"]:.2f}', markersize=4)

    ax1.set_xlabel('树层级(Level)', fontsize=13)
    ax1.set_ylabel('月均奖励/人 (元)', fontsize=13)
    ax1.set_title('普通用户: 各层月均奖励（最坏情况, 13层三叉树）', fontsize=14, fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.set_yscale('log')
    ax1.grid(True, alpha=0.3)
    ax1.set_xticks(range(1, tree_depth + 1))

    for s in all_summaries:
        levels = [r['level'] for r in s['vip']['results'] if not r['is_root']]
        rewards = [r['monthly_reward'] for r in s['vip']['results'] if not r['is_root']]
        ax2.plot(levels, rewards, 'o-', label=f'加价率{s["markup"]:.2f}', markersize=4)

    ax2.set_xlabel('树层级(Level)', fontsize=13)
    ax2.set_ylabel('月均奖励/人 (元)', fontsize=13)
    ax2.set_title('VIP用户: 各层月均奖励（最坏情况, 13层三叉树）', fontsize=14, fontweight='bold')
    ax2.legend(fontsize=9)
    ax2.set_yscale('log')
    ax2.grid(True, alpha=0.3)
    ax2.set_xticks(range(1, tree_depth + 1))

    fig.tight_layout()
    fig.savefig(os.path.join(OUTPUT_DIR, 'per_level_reward_by_markup.png'), dpi=150)
    plt.close()

    # 图2: 加价率1.30下逐层详细分布
    fig, ax = plt.subplots(figsize=(14, 8))
    s130 = [s for s in all_summaries if s['markup'] == 1.30][0]

    levels = [r['level'] for r in s130['normal']['results'] if not r['is_root']]
    users = [r['users'] for r in s130['normal']['results'] if not r['is_root']]
    rewards = [r['monthly_reward'] for r in s130['normal']['results'] if not r['is_root']]

    ax_twin = ax.twinx()
    bars = ax.bar(levels, rewards, color='#2E7D32', alpha=0.7, label='月均奖励/人')
    line = ax_twin.plot(levels, users, 'ro-', label='用户数', markersize=6)

    ax.set_xlabel('树层级(Level)', fontsize=13)
    ax.set_ylabel('月均奖励/人 (元)', fontsize=13, color='#2E7D32')
    ax_twin.set_ylabel('用户数', fontsize=13, color='red')
    ax_twin.set_yscale('log')
    ax.set_title('普通用户 加价率1.30: 各层奖励 vs 用户数（最坏情况）', fontsize=14, fontweight='bold')
    ax.set_xticks(levels)

    # 在柱子上标注金额
    for l, r in zip(levels, rewards):
        if r > 0:
            ax.text(l, r + max(rewards) * 0.02, f'¥{r:,.0f}', ha='center', fontsize=8)

    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax_twin.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, loc='upper right', fontsize=10)
    ax.grid(True, alpha=0.3, axis='y')

    fig.tight_layout()
    fig.savefig(os.path.join(OUTPUT_DIR, 'per_level_detail_130.png'), dpi=150)
    plt.close()

    print(f'\n图表已保存到 {OUTPUT_DIR}/')


def main():
    import sys
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
    report_path = os.path.join(OUTPUT_DIR, 'per_level_report.txt')
    report_file = open(report_path, 'w', encoding='utf-8')
    old_stdout = sys.stdout
    sys.stdout = Tee(old_stdout, report_file)

    run_markup_sweep()

    sys.stdout = old_stdout
    report_file.close()
    print(f'\n报告已保存: {report_path}')


if __name__ == '__main__':
    main()
