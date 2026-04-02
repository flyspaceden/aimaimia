#!/usr/bin/env python3
"""
农脉分润奖励系统 — 全场景利润测算

普通树: 2叉, maxLayers=8
VIP树: 3叉, 50%填充, maxLayers=13
普通:VIP = 50:50
无抽奖
加价率: 1.20, 1.25, 1.30
用户规模: 10万~1000万
最坏情况 + 默认参数 都算
"""

import os
import math

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')


def calc_tree_reward_outflow(total_users, bf, max_layers, tree_depth,
                              avg_cost, markup, reward_pct, freq,
                              vip_discount=1.0, fill_rate=1.0):
    """计算整棵树的月度奖励总流出（最坏情况）"""
    bf_eff = bf * fill_rate
    sale = avg_cost * markup * vip_discount
    profit = sale - avg_cost
    if profit <= 0:
        return 0, 0, 0

    rpo = profit * reward_pct
    total_monthly = 0
    actual_users = 0

    for L in range(1, tree_depth + 1):
        users = int(round(bf_eff ** L))
        if isinstance(total_users, int) or isinstance(total_users, float):
            if actual_users + users > total_users:
                users = max(0, int(total_users) - actual_users)
        actual_users += users
        if users <= 0:
            break

        max_k = min(max_layers, tree_depth - L)
        yearly = 0.0
        for k in range(1, max_k + 1):
            if L + k > tree_depth:
                break
            desc = bf_eff ** k
            months = math.ceil(k / freq)
            if months <= 12:
                yearly += desc * rpo
        total_monthly += (yearly / 12.0) * users

    avg = total_monthly / actual_users if actual_users > 0 else 0
    return total_monthly, avg, actual_users


def run_scenario(n_total, markup, worst=True):
    """运行单个场景，返回月度P&L"""

    # 参数
    n_normal = n_total // 2
    n_vip = n_total - n_normal

    avg_cost_n = 80.0
    avg_cost_v = 120.0
    freq_n = 3.0
    freq_v = 6.0
    vip_discount = 0.95
    reward_pct_n = 0.16
    reward_pct_v = 0.30
    platform_pct_n = 0.50
    industry_pct_n = 0.16
    funds_pct_n = 0.18  # 慈善8+科技8+备用2
    platform_pct_v = 0.50
    industry_pct_v = 0.10
    funds_pct_v = 0.10  # 慈善2+科技2+备用6
    max_layers_n = 8
    max_layers_v = 13
    bf_n = 2
    bf_v = 3
    vip_fill = 0.50
    vip_purchase_profit = 100.0
    vip_referral = 50.0
    vip_referral_rate = 0.70
    operating_pct = 0.05
    completion_rate = 0.95  # 订单完成率始终95%，最坏情况只影响奖励解锁/提现
    replacement_rate = 0.03
    avg_shipping = 8.0

    # 普通树深度（2叉树）
    td_n = int(math.ceil(math.log(max(n_normal, 2)) / math.log(bf_n)))
    # VIP树深度（3叉×50%填充，10个root）
    bf_v_eff = bf_v * vip_fill  # 1.5
    vip_per_root = n_vip / 10
    td_v = int(math.ceil(math.log(max(vip_per_root * (bf_v_eff - 1) + 1, 2)) / math.log(bf_v_eff))) if vip_per_root > 1 else 1

    # ── 普通系统 ──
    eff_orders_n = n_normal * freq_n * completion_rate
    sale_n = avg_cost_n * markup
    profit_n = eff_orders_n * (sale_n - avg_cost_n)

    platform_n = profit_n * platform_pct_n
    seller_n = profit_n * industry_pct_n
    funds_n = profit_n * funds_pct_n
    reward_pool_n = profit_n * reward_pct_n

    # 普通树奖励流出
    if worst:
        # 最坏情况：奖励池100%流出（不考虑树结构截断，假设所有奖励都被领走）
        reward_out_n = reward_pool_n
    else:
        # 默认：用树结构实际计算流出 + 解锁率/活跃率/提现率
        reward_out_n_tree, _, _ = calc_tree_reward_outflow(
            n_normal, bf_n, max_layers_n, td_n,
            avg_cost_n, markup, reward_pct_n, freq_n)
        tree_outflow_rate = min(reward_out_n_tree / reward_pool_n, 1.0) if reward_pool_n > 0 else 0
        unlock = min(freq_n * 1.0, max_layers_n) / max_layers_n
        # 取树结构流出率和解锁率中较小的（两层限制）
        effective_rate = min(tree_outflow_rate, unlock)
        reward_out_n = reward_pool_n * effective_rate * 0.95 * 0.80  # ×活跃率×提现率
    reward_return_n = reward_pool_n - reward_out_n

    # ── VIP系统 ──
    eff_orders_v = n_vip * freq_v * completion_rate
    sale_v = avg_cost_v * markup * vip_discount
    profit_v = eff_orders_v * (sale_v - avg_cost_v)

    platform_v = profit_v * platform_pct_v
    seller_v = profit_v * industry_pct_v
    funds_v = profit_v * funds_pct_v
    reward_pool_v = profit_v * reward_pct_v

    if worst:
        # 最坏情况：奖励池100%流出
        reward_out_v = reward_pool_v
    else:
        reward_out_v_tree, _, _ = calc_tree_reward_outflow(
            n_vip, bf_v, max_layers_v, td_v,
            avg_cost_v, markup, reward_pct_v, freq_v,
            vip_discount, vip_fill)
        tree_outflow_rate_v = min(reward_out_v_tree / reward_pool_v, 1.0) if reward_pool_v > 0 else 0
        unlock_v = min(freq_v * 1.0, max_layers_v) / max_layers_v
        effective_rate_v = min(tree_outflow_rate_v, unlock_v)
        reward_out_v = reward_pool_v * effective_rate_v * 0.95 * 0.80
    reward_return_v = reward_pool_v - reward_out_v

    # VIP购买收入（假设每月新增VIP = 总VIP的2%作为替代流入）
    monthly_new_vip = n_vip * 0.02
    vip_income = monthly_new_vip * vip_purchase_profit
    referral_cost = monthly_new_vip * vip_referral * vip_referral_rate

    # 换货成本
    total_orders = eff_orders_n + eff_orders_v
    replace_cost = total_orders * replacement_rate * avg_shipping

    # 运营成本
    total_rev = n_normal * freq_n * sale_n + n_vip * freq_v * sale_v + monthly_new_vip * 399
    op_cost = total_rev * operating_pct

    # 净利润
    total_platform = platform_n + funds_n + platform_v + funds_v
    total_seller = seller_n + seller_v
    total_reward_out = reward_out_n + reward_out_v
    total_reward_return = reward_return_n + reward_return_v

    net = (total_platform + total_reward_return + vip_income
           - total_seller - total_reward_out - referral_cost
           - replace_cost - op_cost)

    return {
        'n_total': n_total,
        'n_normal': n_normal,
        'n_vip': n_vip,
        'markup': markup,
        'worst': worst,
        'tree_depth_n': td_n,
        'tree_depth_v': td_v,
        'total_rev': total_rev,
        'profit_n': profit_n,
        'profit_v': profit_v,
        'platform_controlled': total_platform,
        'seller_payout': total_seller,
        'reward_pool': reward_pool_n + reward_pool_v,
        'reward_outflow': total_reward_out,
        'reward_return': total_reward_return,
        'vip_income': vip_income,
        'referral_cost': referral_cost,
        'replace_cost': replace_cost,
        'op_cost': op_cost,
        'net_profit': net,
        'net_margin': net / total_rev * 100 if total_rev > 0 else 0,
        'avg_reward_n': reward_out_n / n_normal if n_normal > 0 else 0,
        'avg_reward_v': reward_out_v / n_vip if n_vip > 0 else 0,
    }


def fmt(v):
    """格式化金额为万元"""
    return f'¥{v/10000:>10,.0f}万'


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
    rpath = os.path.join(OUTPUT_DIR, 'full_profit_report.txt')
    rf = open(rpath, 'w', encoding='utf-8')
    old = sys.stdout
    sys.stdout = Tee(old, rf)

    scales = [100_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000, 10_000_000]
    markups = [1.20, 1.25, 1.30]

    print('=' * 120)
    print('  农脉分润奖励系统 — 全场景利润测算')
    print('=' * 120)
    print(f'  普通树: 2叉, maxLayers=8  |  VIP树: 3叉, 50%填充, maxLayers=13')
    print(f'  普通:VIP = 50:50  |  无抽奖  |  VIP购买利润=100元')
    print(f'  普通: 成本80元, 频率3次/月  |  VIP: 成本120元, 折扣0.95, 频率6次/月')
    print(f'  普通奖励16%, VIP奖励30%  |  运营成本5%')
    print()

    for markup in markups:
        print('\n' + '█' * 120)
        print(f'  加价率 = {markup}')
        print(f'  普通售价={80*markup:.0f}元(利润{80*(markup-1):.0f}元)  '
              f'VIP售价={120*markup*0.95:.0f}元(利润{120*markup*0.95-120:.0f}元)')
        print('█' * 120)

        # ── 汇总表 ──
        for worst in [True, False]:
            mode = '最坏情况(100%解锁+提现)' if worst else '默认参数(含过期/流失)'
            print(f'\n  [{mode}]')
            print(f'  {"总人数":>10} {"普通":>8} {"VIP":>8} {"树深N":>5} {"树深V":>5} '
                  f'{"月营收":>12} {"月毛利":>12} {"奖励流出":>12} {"奖励回流":>12} '
                  f'{"月净利润":>12} {"净利率":>7} '
                  f'{"普通人均奖":>10} {"VIP人均奖":>10}')
            print('  ' + '-' * 115)

            for n in scales:
                r = run_scenario(n, markup, worst)
                gross = r['profit_n'] + r['profit_v']
                print(f'  {n/10000:>8.0f}万 {r["n_normal"]/10000:>6.0f}万 {r["n_vip"]/10000:>6.0f}万 '
                      f'{r["tree_depth_n"]:>5} {r["tree_depth_v"]:>5} '
                      f'{fmt(r["total_rev"])} {fmt(gross)} {fmt(r["reward_outflow"])} {fmt(r["reward_return"])} '
                      f'{fmt(r["net_profit"])} {r["net_margin"]:>6.1f}% '
                      f'¥{r["avg_reward_n"]:>8.1f} ¥{r["avg_reward_v"]:>8.1f}')

        # ── 详细P&L（选100万用户）──
        print(f'\n  ── 详细月度P&L（100万用户, 加价率{markup}）──')
        for worst in [True, False]:
            mode = '最坏' if worst else '默认'
            r = run_scenario(1_000_000, markup, worst)
            gross = r['profit_n'] + r['profit_v']
            print(f'\n  [{mode}]')
            print(f'  月总营收:              {fmt(r["total_rev"])}')
            print(f'  ├ 普通毛利:            {fmt(r["profit_n"])}')
            print(f'  ├ VIP毛利:             {fmt(r["profit_v"])}')
            print(f'  平台可控收入(含基金):    {fmt(r["platform_controlled"])}')
            print(f'  奖励过期回流:           {fmt(r["reward_return"])}')
            print(f'  VIP购买收入:           {fmt(r["vip_income"])}')
            print(f'  ─────────────────────────────')
            print(f'  卖家产业基金:          -{fmt(r["seller_payout"])}')
            print(f'  奖励提现流出:          -{fmt(r["reward_outflow"])}')
            print(f'  VIP推荐奖励:           -{fmt(r["referral_cost"])}')
            print(f'  换货成本:              -{fmt(r["replace_cost"])}')
            print(f'  运营成本:              -{fmt(r["operating_cost"] if "operating_cost" in r else r["op_cost"])}')
            print(f'  ═════════════════════════════')
            print(f'  月度净利润:             {fmt(r["net_profit"])}')
            print(f'  净利率:                 {r["net_margin"]:.1f}%')
            print(f'  奖励池:                {fmt(r["reward_pool"])}')
            out_rate = r['reward_outflow'] / r['reward_pool'] * 100 if r['reward_pool'] > 0 else 0
            print(f'  奖励流出率:             {out_rate:.1f}%')
            print(f'  普通人均月奖:           ¥{r["avg_reward_n"]:.2f}')
            print(f'  VIP人均月奖:            ¥{r["avg_reward_v"]:.2f}')

    # ── 最终对比表 ──
    print('\n' + '=' * 120)
    print('  最终对比：所有加价率 × 所有规模 → 月净利润（万元）')
    print('=' * 120)

    for worst in [True, False]:
        mode = '最坏情况' if worst else '默认参数'
        print(f'\n  [{mode}]')
        header = f'  {"总人数":>10}'
        for markup in markups:
            header += f'  {"加价"+str(markup):>14}'
        print(header)
        print('  ' + '-' * (10 + 16 * len(markups)))
        for n in scales:
            line = f'  {n/10000:>8.0f}万'
            for markup in markups:
                r = run_scenario(n, markup, worst)
                line += f'  {fmt(r["net_profit"])}'
            print(line)

    # 盈亏状态
    print(f'\n  盈亏状态（✓=盈利 ✗=亏损）:')
    for worst in [True, False]:
        mode = '最坏' if worst else '默认'
        print(f'\n  [{mode}]', end='')
        header = f'{"":>10}'
        for markup in markups:
            header += f'  {"加价"+str(markup):>10}'
        print(header)
        for n in scales:
            line = f'  {n/10000:>8.0f}万'
            for markup in markups:
                r = run_scenario(n, markup, worst)
                s = '✓' if r['net_profit'] > 0 else '✗'
                line += f'  {s:>10} {r["net_margin"]:.1f}%'
            print(line)

    print()
    sys.stdout = old
    rf.close()
    print(f'报告已保存: {rpath}')


if __name__ == '__main__':
    main()
