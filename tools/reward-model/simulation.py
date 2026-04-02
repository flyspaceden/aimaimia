#!/usr/bin/env python3
"""
农脉分润奖励系统 — 时序仿真引擎（第二层模型）

按天推进的仿真引擎，模拟真实树结构、用户行为、奖励分配、冻结/解锁/过期、提现。

用法：
  python simulation.py              # 默认参数运行（365天）
  python simulation.py --worst      # 最坏情况模式（100%解锁+100%提现+无过期）
  python simulation.py --days 180   # 指定仿真天数

输出：
  output/simulation_result.txt      仿真报告
  output/charts/chart_a_*.png       累积资金流
  output/charts/chart_b_*.png       树深度
  output/charts/chart_c_*.png       月度净利润
  output/charts/chart_d_*.png       奖励状态堆叠面积图
"""

import os
import sys
import math
import time
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# ── 中文字体设置 ──
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'Heiti TC', 'PingFang SC', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, 'output')
CHART_DIR = os.path.join(OUTPUT_DIR, 'charts')


# ============================================================
# 参数（与 analytical.py 保持一致）
# ============================================================

@dataclass
class SimParams:
    """仿真参数"""

    # ── 普通系统六分比例 ──
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
    avg_cost_normal: float = 80.0
    avg_cost_vip: float = 120.0

    # ── 奖励有效期 ──
    normal_reward_expiry_days: int = 30
    vip_reward_expiry_days: int = 30

    # ── 市场行为 ──
    N_normal: int = 9000
    N_vip: int = 1000
    freq_normal: float = 3.0
    freq_vip: float = 6.0
    vip_conversion_rate_annual: float = 0.10
    vip_referral_rate: float = 0.70
    withdrawal_rate: float = 0.80
    churn_rate: float = 0.05
    completion_rate: float = 0.95

    # ── 抽奖 ──
    lottery_active_rate: float = 0.30
    lottery_win_rate: float = 0.60
    lottery_avg_prize_cost: float = 5.0

    # ── 换货 ──
    replacement_rate: float = 0.03
    avg_shipping_cost: float = 8.0

    # ── 运营 ──
    operating_cost_pct: float = 0.05

    # ── 仿真专用 ──
    sim_days: int = 365
    seed: int = 42

    # ── 最坏情况标志 ──
    worst_case: bool = False


# ============================================================
# 数组化树结构
# ============================================================

class ArrayTree:
    """
    基于数组的多叉树。
    node_id 0 = 根节点（平台节点, user_id = -1）。
    parent[i] = 节点i的父节点索引（root的parent = -1）。
    user_of[i] = 该节点对应的用户ID（根节点为-1）。
    children_count[i] = 当前子节点数量。
    level[i] = 节点在树中的层级（根=0）。
    """

    def __init__(self, branch_factor: int, num_roots: int = 1):
        self.branch_factor = branch_factor
        self.num_roots = num_roots
        # 预分配空间（动态扩展）
        self._capacity = 20000
        self.parent = np.full(self._capacity, -1, dtype=np.int32)
        self.user_of = np.full(self._capacity, -1, dtype=np.int32)
        self.children_count = np.zeros(self._capacity, dtype=np.int32)
        self.level = np.zeros(self._capacity, dtype=np.int32)
        self.size = 0

        # 轮询插入的指针
        self._insert_level = 0       # 当前插入层
        self._insert_idx = 0         # 当前层内的位置（在该层节点列表中的索引）
        self._insert_child_round = 0 # 当前层正在给每个节点的第几个子节点
        self._level_nodes = []       # 各层的节点ID列表

        # 初始化根节点
        if num_roots == 1:
            # 单根树（普通树）
            self._add_root(-1)
        else:
            # 多根树（VIP树）：创建一个虚拟超级根，然后挂10个子根
            super_root = self._add_root(-1)
            for i in range(num_roots):
                self._add_child(super_root, -(i + 2))  # user_id = -2, -3, ..., -11 for A1-A10
            # 插入指针从A1-A10层的子节点开始
            self._insert_level = 1
            self._insert_idx = 0
            self._insert_child_round = 0

    def _ensure_capacity(self, needed: int):
        """确保数组容量足够"""
        if needed <= self._capacity:
            return
        new_cap = max(self._capacity * 2, needed + 1000)
        self.parent = np.concatenate([self.parent, np.full(new_cap - self._capacity, -1, dtype=np.int32)])
        self.user_of = np.concatenate([self.user_of, np.full(new_cap - self._capacity, -1, dtype=np.int32)])
        self.children_count = np.concatenate([self.children_count, np.zeros(new_cap - self._capacity, dtype=np.int32)])
        self.level = np.concatenate([self.level, np.zeros(new_cap - self._capacity, dtype=np.int32)])
        self._capacity = new_cap

    def _add_root(self, user_id: int) -> int:
        """添加根节点"""
        node_id = self.size
        self._ensure_capacity(node_id + 1)
        self.parent[node_id] = -1
        self.user_of[node_id] = user_id
        self.level[node_id] = 0
        self.size += 1
        if len(self._level_nodes) == 0:
            self._level_nodes.append([])
        self._level_nodes[0].append(node_id)
        return node_id

    def _add_child(self, parent_id: int, user_id: int) -> int:
        """添加子节点"""
        node_id = self.size
        self._ensure_capacity(node_id + 1)
        self.parent[node_id] = parent_id
        self.user_of[node_id] = user_id
        self.level[node_id] = self.level[parent_id] + 1
        self.children_count[parent_id] += 1
        self.size += 1
        lvl = self.level[node_id]
        while len(self._level_nodes) <= lvl:
            self._level_nodes.append([])
        self._level_nodes[lvl].append(node_id)
        return node_id

    def insert_user(self, user_id: int) -> int:
        """
        轮询平衡插入：按层、按节点、按轮次分配子节点。
        保证树尽可能平衡。
        """
        # 找到当前层可以挂子节点的节点
        while True:
            if self._insert_level >= len(self._level_nodes):
                # 所有层都满了（不应发生）
                break
            level_nodes = self._level_nodes[self._insert_level]
            if len(level_nodes) == 0:
                self._insert_level += 1
                self._insert_idx = 0
                self._insert_child_round = 0
                continue

            # 当前正在给 level_nodes[_insert_idx] 添加第 _insert_child_round 个子节点
            if self._insert_child_round >= self.branch_factor:
                # 当前层所有节点都满了，进入下一层
                self._insert_level += 1
                self._insert_idx = 0
                self._insert_child_round = 0
                continue

            parent_id = level_nodes[self._insert_idx]
            if self.children_count[parent_id] <= self._insert_child_round:
                # 这个父节点还能添加这一轮的子节点
                node_id = self._add_child(parent_id, user_id)
                self._insert_idx += 1
                if self._insert_idx >= len(level_nodes):
                    self._insert_idx = 0
                    self._insert_child_round += 1
                return node_id
            else:
                # 这个节点已经有了足够的子节点，跳到下一个
                self._insert_idx += 1
                if self._insert_idx >= len(level_nodes):
                    self._insert_idx = 0
                    self._insert_child_round += 1
                continue

        # fallback: 如果逻辑有误，直接挂到最后一个有空位的节点
        for i in range(self.size - 1, -1, -1):
            if self.children_count[i] < self.branch_factor:
                return self._add_child(i, user_id)
        # 不应到这里
        return self._add_child(0, user_id)

    def find_kth_ancestor(self, node_id: int, k: int) -> int:
        """
        向上走k步，返回祖辈节点ID。
        如果走不到k步（到达根节点或超出），返回 -1。
        """
        current = node_id
        for _ in range(k):
            p = self.parent[current]
            if p < 0:
                return -1  # 到达/超过根节点
            current = p
        return current

    def get_depth(self) -> int:
        """返回当前树深度"""
        if self.size == 0:
            return 0
        return int(np.max(self.level[:self.size]))

    def get_level_counts(self, max_levels: int = 10) -> List[int]:
        """返回前几层的用户数"""
        counts = []
        for lvl in range(min(max_levels, len(self._level_nodes))):
            counts.append(len(self._level_nodes[lvl]))
        return counts


# ============================================================
# 会计系统（高效数组追踪）
# ============================================================

class Ledger:
    """追踪所有日级资金流"""

    def __init__(self, num_days: int):
        self.num_days = num_days
        # 日级增量（每天的流水）
        self.daily = {
            'revenue': np.zeros(num_days),
            'cogs': np.zeros(num_days),
            'gross_profit': np.zeros(num_days),
            'platform_income': np.zeros(num_days),
            'seller_payout': np.zeros(num_days),
            'reward_generated': np.zeros(num_days),
            'reward_frozen': np.zeros(num_days),
            'reward_unlocked': np.zeros(num_days),    # 冻结→可用
            'reward_direct_avail': np.zeros(num_days), # 直接可用（祖辈已解锁）
            'reward_to_platform': np.zeros(num_days),  # 归平台（根/超层/VIP排除等）
            'frozen_expired': np.zeros(num_days),      # 冻结过期→平台
            'avail_expired': np.zeros(num_days),       # 可用过期→平台
            'withdrawn': np.zeros(num_days),
            'vip_purchase_income': np.zeros(num_days),
            'referral_cost': np.zeros(num_days),
            'lottery_cost': np.zeros(num_days),
            'replacement_cost': np.zeros(num_days),
            'operating_cost': np.zeros(num_days),
            'funds_income': np.zeros(num_days),        # 慈善+科技+备用金
            'order_count': np.zeros(num_days),
            'user_count': np.zeros(num_days),
        }

    def record(self, day: int, key: str, amount: float):
        """记录日级流水"""
        self.daily[key][day] += amount

    def cumulative(self, key: str) -> np.ndarray:
        """返回累积值"""
        return np.cumsum(self.daily[key])

    def month_sum(self, key: str, month: int) -> float:
        """返回第month个月（0-indexed）的合计"""
        start = month * 30
        end = min((month + 1) * 30, self.num_days)
        if start >= self.num_days:
            return 0.0
        return float(np.sum(self.daily[key][start:end]))


# ============================================================
# 仿真引擎
# ============================================================

class Simulation:
    """时序仿真引擎"""

    def __init__(self, params: SimParams):
        self.p = params
        self.rng = np.random.RandomState(params.seed)

        # ── 树 ──
        self.normal_tree = ArrayTree(branch_factor=params.branch_factor, num_roots=1)
        self.vip_tree = ArrayTree(branch_factor=params.branch_factor, num_roots=10)

        # ── 用户数据（数组化）──
        # 预分配
        total_expected = params.N_normal + params.N_vip + 1000
        self._user_capacity = total_expected
        self.num_users = 0

        # 基础属性
        self.join_day = np.zeros(total_expected, dtype=np.int32)
        self.is_vip = np.zeros(total_expected, dtype=np.bool_)
        self.is_active = np.ones(total_expected, dtype=np.bool_)
        self.purchase_lambda_normal = np.zeros(total_expected, dtype=np.float64)  # 日购买概率参数
        self.purchase_lambda_vip = np.zeros(total_expected, dtype=np.float64)
        self.vip_convert_day = np.full(total_expected, 99999, dtype=np.int32)     # 转VIP的日期

        # 树位置
        self.normal_tree_node = np.full(total_expected, -1, dtype=np.int32)
        self.vip_tree_node = np.full(total_expected, -1, dtype=np.int32)
        self.in_normal_tree = np.zeros(total_expected, dtype=np.bool_)
        self.in_vip_tree = np.zeros(total_expected, dtype=np.bool_)

        # 购买计数
        self.normal_purchase_count = np.zeros(total_expected, dtype=np.int32)
        self.vip_purchase_count = np.zeros(total_expected, dtype=np.int32)

        # 余额
        self.normal_available = np.zeros(total_expected, dtype=np.float64)
        self.vip_available = np.zeros(total_expected, dtype=np.float64)

        # 冻结奖励（使用列表，每个用户一个列表）
        # 每条记录：(amount, required_k, created_day, is_vip_reward)
        self.frozen_rewards = [[] for _ in range(total_expected)]

        # 可用奖励的"可用日"跟踪（用于可用过期）
        # 每条记录：(amount, available_day, is_vip_reward)
        self.available_entries = [[] for _ in range(total_expected)]

        # ── 会计 ──
        self.ledger = Ledger(params.sim_days)

        # ── 统计 ──
        self.total_frozen_balance = 0.0
        self.total_available_balance = 0.0

    def _ensure_user_capacity(self, needed: int):
        """扩展用户数组容量"""
        if needed <= self._user_capacity:
            return
        new_cap = max(self._user_capacity * 2, needed + 1000)
        ext = new_cap - self._user_capacity

        self.join_day = np.concatenate([self.join_day, np.zeros(ext, dtype=np.int32)])
        self.is_vip = np.concatenate([self.is_vip, np.zeros(ext, dtype=np.bool_)])
        self.is_active = np.concatenate([self.is_active, np.ones(ext, dtype=np.bool_)])
        self.purchase_lambda_normal = np.concatenate([self.purchase_lambda_normal, np.zeros(ext, dtype=np.float64)])
        self.purchase_lambda_vip = np.concatenate([self.purchase_lambda_vip, np.zeros(ext, dtype=np.float64)])
        self.vip_convert_day = np.concatenate([self.vip_convert_day, np.full(ext, 99999, dtype=np.int32)])

        self.normal_tree_node = np.concatenate([self.normal_tree_node, np.full(ext, -1, dtype=np.int32)])
        self.vip_tree_node = np.concatenate([self.vip_tree_node, np.full(ext, -1, dtype=np.int32)])
        self.in_normal_tree = np.concatenate([self.in_normal_tree, np.zeros(ext, dtype=np.bool_)])
        self.in_vip_tree = np.concatenate([self.in_vip_tree, np.zeros(ext, dtype=np.bool_)])

        self.normal_purchase_count = np.concatenate([self.normal_purchase_count, np.zeros(ext, dtype=np.int32)])
        self.vip_purchase_count = np.concatenate([self.vip_purchase_count, np.zeros(ext, dtype=np.int32)])

        self.normal_available = np.concatenate([self.normal_available, np.zeros(ext, dtype=np.float64)])
        self.vip_available = np.concatenate([self.vip_available, np.zeros(ext, dtype=np.float64)])

        self.frozen_rewards.extend([[] for _ in range(ext)])
        self.available_entries.extend([[] for _ in range(ext)])

        self._user_capacity = new_cap

    # ────────────────────────────────────────
    # 用户生成
    # ────────────────────────────────────────

    def _generate_users(self, day: int):
        """
        每天生成新用户。线性增长模型：
        每天新增 = (N_normal + N_vip) / sim_days
        """
        total_target = self.p.N_normal + self.p.N_vip
        daily_new = total_target / self.p.sim_days

        # 泊松抽样使每天数量有波动
        n_new = self.rng.poisson(daily_new)
        if n_new <= 0:
            return

        start_idx = self.num_users
        self._ensure_user_capacity(start_idx + n_new)

        for i in range(n_new):
            uid = start_idx + i
            self.join_day[uid] = day

            # 购买频率：从正态分布采样（截断在 0.5 以上）
            lam_n = max(0.5, self.rng.normal(self.p.freq_normal, self.p.freq_normal * 0.3))
            self.purchase_lambda_normal[uid] = lam_n / 30.0  # 转为日概率

            # 是否会转VIP（伯努利）
            will_convert = self.rng.random() < self.p.vip_conversion_rate_annual
            if will_convert:
                # 转化时间：加入后 30~300 天之间均匀分布
                convert_delay = self.rng.randint(30, min(301, self.p.sim_days))
                self.vip_convert_day[uid] = day + convert_delay

        self.num_users = start_idx + n_new

    def _check_vip_conversion(self, day: int):
        """检查今天有哪些用户转VIP"""
        if self.num_users == 0:
            return

        converting = (self.vip_convert_day[:self.num_users] == day) & \
                     (~self.is_vip[:self.num_users]) & \
                     self.is_active[:self.num_users]

        convert_ids = np.where(converting)[0]
        for uid in convert_ids:
            self.is_vip[uid] = True
            # VIP购买频率
            lam_v = max(1.0, self.rng.normal(self.p.freq_vip, self.p.freq_vip * 0.3))
            self.purchase_lambda_vip[uid] = lam_v / 30.0

            # 加入VIP树
            node_id = self.vip_tree.insert_user(uid)
            self.vip_tree_node[uid] = node_id
            self.in_vip_tree[uid] = True

            # VIP购买收入
            has_referral = self.rng.random() < self.p.vip_referral_rate
            income = self.p.vip_profit
            ref_cost = self.p.vip_referral if has_referral else 0.0

            self.ledger.record(day, 'vip_purchase_income', income)
            self.ledger.record(day, 'referral_cost', ref_cost)
            self.ledger.record(day, 'revenue', self.p.vip_price)

    # ────────────────────────────────────────
    # 订单生成与处理
    # ────────────────────────────────────────

    def _process_orders(self, day: int):
        """每天生成并处理订单"""
        if self.num_users == 0:
            return

        n = self.num_users
        active_mask = self.is_active[:n] & (self.join_day[:n] <= day)

        # 普通订单：所有活跃用户（包含VIP用户也做普通消费）
        # 但VIP用户不在普通系统分润，只在VIP系统分润
        # 根据设计：普通用户走普通分润，VIP用户走VIP分润
        # 所以分开处理

        # ── 普通用户订单 ──
        normal_mask = active_mask & (~self.is_vip[:n])
        normal_ids = np.where(normal_mask)[0]

        if len(normal_ids) > 0:
            # 泊松概率购买
            probs = self.purchase_lambda_normal[normal_ids]
            rolls = self.rng.random(len(normal_ids))
            buying = normal_ids[rolls < probs]

            # 订单完成率过滤
            if len(buying) > 0 and self.p.completion_rate < 1.0:
                comp_rolls = self.rng.random(len(buying))
                buying = buying[comp_rolls < self.p.completion_rate]

            for uid in buying:
                self._process_normal_order(uid, day)

        # ── VIP用户订单 ──
        vip_mask = active_mask & self.is_vip[:n]
        vip_ids = np.where(vip_mask)[0]

        if len(vip_ids) > 0:
            probs = self.purchase_lambda_vip[vip_ids]
            rolls = self.rng.random(len(vip_ids))
            buying = vip_ids[rolls < probs]

            if len(buying) > 0 and self.p.completion_rate < 1.0:
                comp_rolls = self.rng.random(len(buying))
                buying = buying[comp_rolls < self.p.completion_rate]

            for uid in buying:
                self._process_vip_order(uid, day)

    def _process_normal_order(self, uid: int, day: int):
        """处理普通用户订单"""
        p = self.p

        # 客单成本：从对数正态分布采样
        cost = max(5.0, self.rng.lognormal(
            math.log(p.avg_cost_normal) - 0.045,  # 修正使均值=avg_cost_normal
            0.3
        ))
        price = cost * p.markup
        profit = price - cost

        if profit <= 0:
            return

        # 记账
        self.ledger.record(day, 'revenue', price)
        self.ledger.record(day, 'cogs', cost)
        self.ledger.record(day, 'gross_profit', profit)
        self.ledger.record(day, 'order_count', 1)

        # 六分利润
        platform = profit * p.normal_platform_pct
        seller = profit * p.normal_industry_pct
        reward = profit * p.normal_reward_pct
        funds = profit * (p.normal_charity_pct + p.normal_tech_pct + p.normal_reserve_pct)

        self.ledger.record(day, 'platform_income', platform)
        self.ledger.record(day, 'funds_income', funds)
        self.ledger.record(day, 'seller_payout', seller)
        self.ledger.record(day, 'reward_generated', reward)

        # 首单入树
        if not self.in_normal_tree[uid]:
            node_id = self.normal_tree.insert_user(uid)
            self.normal_tree_node[uid] = node_id
            self.in_normal_tree[uid] = True

        self.normal_purchase_count[uid] += 1
        k = int(self.normal_purchase_count[uid])

        # 超层归平台
        if k > p.max_layers:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_normal(uid, day)
            return

        # 找祖辈
        node_id = self.normal_tree_node[uid]
        ancestor_node = self.normal_tree.find_kth_ancestor(node_id, k)

        # 无效祖辈 → 归平台
        if ancestor_node < 0:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_normal(uid, day)
            return

        ancestor_uid = self.normal_tree.user_of[ancestor_node]

        # 系统节点（根）或 VIP用户（排除）
        if ancestor_uid < 0 or self.is_vip[ancestor_uid]:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_normal(uid, day)
            return

        # 判断解锁
        if p.worst_case or self.normal_purchase_count[ancestor_uid] >= k:
            # 直接可用
            self.normal_available[ancestor_uid] += reward
            self.total_available_balance += reward
            self.available_entries[ancestor_uid].append((reward, day, False))
            self.ledger.record(day, 'reward_direct_avail', reward)
        else:
            # 冻结
            self.frozen_rewards[ancestor_uid].append(
                (reward, k, day, False)  # (amount, required_k, created_day, is_vip)
            )
            self.total_frozen_balance += reward
            self.ledger.record(day, 'reward_frozen', reward)

        # 检查自己的冻结奖励是否可解锁
        self._try_unlock_normal(uid, day)

    def _process_vip_order(self, uid: int, day: int):
        """处理VIP用户订单"""
        p = self.p

        cost = max(10.0, self.rng.lognormal(
            math.log(p.avg_cost_vip) - 0.045,
            0.3
        ))
        vip_sale = cost * p.markup * p.vip_discount_rate
        profit = vip_sale - cost

        if profit <= 0:
            return

        self.ledger.record(day, 'revenue', vip_sale)
        self.ledger.record(day, 'cogs', cost)
        self.ledger.record(day, 'gross_profit', profit)
        self.ledger.record(day, 'order_count', 1)

        # 六分利润（与普通系统同构）
        platform = profit * p.vip_platform_pct
        reward = profit * p.vip_reward_pct
        seller = profit * p.vip_industry_pct
        funds = profit * (p.vip_charity_pct + p.vip_tech_pct + p.vip_reserve_pct)

        self.ledger.record(day, 'platform_income', platform)
        self.ledger.record(day, 'funds_income', funds)
        self.ledger.record(day, 'seller_payout', seller)
        self.ledger.record(day, 'reward_generated', reward)

        self.vip_purchase_count[uid] += 1
        k = int(self.vip_purchase_count[uid])

        # 超层→归平台（VIP出局）
        if k > p.vip_max_layers:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_vip(uid, day)
            return

        # 找VIP树祖辈
        node_id = self.vip_tree_node[uid]
        if node_id < 0:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_vip(uid, day)
            return

        ancestor_node = self.vip_tree.find_kth_ancestor(node_id, k)

        if ancestor_node < 0:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_vip(uid, day)
            return

        ancestor_uid = self.vip_tree.user_of[ancestor_node]

        # 系统节点（根/A1-A10）
        if ancestor_uid < 0:
            self.ledger.record(day, 'reward_to_platform', reward)
            self._try_unlock_vip(uid, day)
            return

        # 判断解锁
        if p.worst_case or self.vip_purchase_count[ancestor_uid] >= k:
            self.vip_available[ancestor_uid] += reward
            self.total_available_balance += reward
            self.available_entries[ancestor_uid].append((reward, day, True))
            self.ledger.record(day, 'reward_direct_avail', reward)
        else:
            self.frozen_rewards[ancestor_uid].append(
                (reward, k, day, True)  # (amount, required_k, created_day, is_vip)
            )
            self.total_frozen_balance += reward
            self.ledger.record(day, 'reward_frozen', reward)

        self._try_unlock_vip(uid, day)

    # ────────────────────────────────────────
    # 解锁检查
    # ────────────────────────────────────────

    def _try_unlock_normal(self, uid: int, day: int):
        """检查uid的普通冻结奖励是否可解锁"""
        if not self.frozen_rewards[uid]:
            return

        pc = self.normal_purchase_count[uid]
        still_frozen = []
        for (amount, required_k, created_day, is_vip) in self.frozen_rewards[uid]:
            if is_vip:
                still_frozen.append((amount, required_k, created_day, is_vip))
                continue
            if self.p.worst_case or pc >= required_k:
                self.normal_available[uid] += amount
                self.total_frozen_balance -= amount
                self.total_available_balance += amount
                self.available_entries[uid].append((amount, day, False))
                self.ledger.record(day, 'reward_unlocked', amount)
            else:
                still_frozen.append((amount, required_k, created_day, is_vip))
        self.frozen_rewards[uid] = still_frozen

    def _try_unlock_vip(self, uid: int, day: int):
        """检查uid的VIP冻结奖励是否可解锁"""
        if not self.frozen_rewards[uid]:
            return

        pc = self.vip_purchase_count[uid]
        still_frozen = []
        for (amount, required_k, created_day, is_vip) in self.frozen_rewards[uid]:
            if not is_vip:
                still_frozen.append((amount, required_k, created_day, is_vip))
                continue
            if self.p.worst_case or pc >= required_k:
                self.vip_available[uid] += amount
                self.total_frozen_balance -= amount
                self.total_available_balance += amount
                self.available_entries[uid].append((amount, day, True))
                self.ledger.record(day, 'reward_unlocked', amount)
            else:
                still_frozen.append((amount, required_k, created_day, is_vip))
        self.frozen_rewards[uid] = still_frozen

    # ────────────────────────────────────────
    # 过期处理
    # ────────────────────────────────────────

    def _expire_frozen(self, day: int):
        """冻结过期：超过freeze_days未解锁→归平台"""
        if self.p.worst_case:
            return  # 最坏情况下不过期

        for uid in range(self.num_users):
            if not self.frozen_rewards[uid]:
                continue

            still_frozen = []
            for (amount, required_k, created_day, is_vip) in self.frozen_rewards[uid]:
                freeze_days = self.p.freeze_days  # 普通和VIP使用相同冻结天数
                if day - created_day >= freeze_days:
                    self.total_frozen_balance -= amount
                    self.ledger.record(day, 'frozen_expired', amount)
                else:
                    still_frozen.append((amount, required_k, created_day, is_vip))
            self.frozen_rewards[uid] = still_frozen

    def _expire_available(self, day: int):
        """可用过期：AVAILABLE状态超过reward_expiry_days未提现→归平台"""
        if self.p.worst_case:
            return  # 最坏情况下不过期

        for uid in range(self.num_users):
            if not self.available_entries[uid]:
                continue

            still_avail = []
            expired_normal = 0.0
            expired_vip = 0.0

            for (amount, avail_day, is_vip) in self.available_entries[uid]:
                expiry_days = self.p.vip_reward_expiry_days if is_vip else self.p.normal_reward_expiry_days
                if day - avail_day >= expiry_days:
                    if is_vip:
                        expired_vip += amount
                    else:
                        expired_normal += amount
                else:
                    still_avail.append((amount, avail_day, is_vip))

            if expired_normal > 0:
                # 确保不超过实际余额
                actual = min(expired_normal, self.normal_available[uid])
                self.normal_available[uid] -= actual
                self.total_available_balance -= actual
                self.ledger.record(day, 'avail_expired', actual)

            if expired_vip > 0:
                actual = min(expired_vip, self.vip_available[uid])
                self.vip_available[uid] -= actual
                self.total_available_balance -= actual
                self.ledger.record(day, 'avail_expired', actual)

            self.available_entries[uid] = still_avail

    # ────────────────────────────────────────
    # 提现
    # ────────────────────────────────────────

    def _process_withdrawals(self, day: int):
        """每30天一次提现"""
        if self.num_users == 0:
            return

        rate = self.p.withdrawal_rate
        if self.p.worst_case:
            rate = 1.0

        total_withdrawn = 0.0

        for uid in range(self.num_users):
            if not self.is_active[uid]:
                continue

            # 普通奖励提现
            w_n = self.normal_available[uid] * rate
            if w_n > 0.01:
                self.normal_available[uid] -= w_n
                self.total_available_balance -= w_n
                total_withdrawn += w_n
                # 清理已提现的available entries（按比例缩减）
                if rate >= 0.999:
                    self.available_entries[uid] = [e for e in self.available_entries[uid] if e[2]]  # 只保留VIP的
                else:
                    # 按比例缩减普通奖励entries的金额
                    new_entries = []
                    for (amt, ad, iv) in self.available_entries[uid]:
                        if not iv:
                            new_entries.append((amt * (1 - rate), ad, iv))
                        else:
                            new_entries.append((amt, ad, iv))
                    self.available_entries[uid] = new_entries

            # VIP奖励提现
            w_v = self.vip_available[uid] * rate
            if w_v > 0.01:
                self.vip_available[uid] -= w_v
                self.total_available_balance -= w_v
                total_withdrawn += w_v
                if rate >= 0.999:
                    self.available_entries[uid] = [e for e in self.available_entries[uid] if not e[2]]  # 只保留普通的
                else:
                    new_entries = []
                    for (amt, ad, iv) in self.available_entries[uid]:
                        if iv:
                            new_entries.append((amt * (1 - rate), ad, iv))
                        else:
                            new_entries.append((amt, ad, iv))
                    self.available_entries[uid] = new_entries

        self.ledger.record(day, 'withdrawn', total_withdrawn)

    # ────────────────────────────────────────
    # 用户流失
    # ────────────────────────────────────────

    def _process_churn(self, day: int):
        """每月处理用户流失"""
        if self.p.churn_rate <= 0 or self.p.worst_case:
            return

        n = self.num_users
        active_mask = self.is_active[:n] & (self.join_day[:n] < day - 30)  # 至少活跃30天
        active_ids = np.where(active_mask)[0]

        if len(active_ids) == 0:
            return

        churn_rolls = self.rng.random(len(active_ids))
        churning = active_ids[churn_rolls < self.p.churn_rate]

        for uid in churning:
            self.is_active[uid] = False

    # ────────────────────────────────────────
    # 抽奖 / 换货 / 运营成本
    # ────────────────────────────────────────

    def _daily_costs(self, day: int):
        """每日固定成本"""
        n_active = int(np.sum(self.is_active[:self.num_users]))

        # 抽奖成本
        lottery = (n_active * self.p.lottery_active_rate
                   * self.p.lottery_win_rate
                   * self.p.lottery_avg_prize_cost)
        self.ledger.record(day, 'lottery_cost', lottery)

        # 换货成本（按日均订单比例）
        daily_orders = self.ledger.daily['order_count'][day]
        replace_cost = daily_orders * self.p.replacement_rate * self.p.avg_shipping_cost
        self.ledger.record(day, 'replacement_cost', replace_cost)

        # 运营成本（日营收的百分比）
        daily_rev = self.ledger.daily['revenue'][day]
        op_cost = daily_rev * self.p.operating_cost_pct
        self.ledger.record(day, 'operating_cost', op_cost)

    # ────────────────────────────────────────
    # 主循环
    # ────────────────────────────────────────

    def run(self) -> dict:
        """运行完整仿真"""
        t0 = time.time()
        print(f"开始仿真: {self.p.sim_days}天, 目标用户={self.p.N_normal}+{self.p.N_vip}")
        if self.p.worst_case:
            print("  [最坏情况模式] 100%解锁 + 100%提现 + 无过期")

        for day in range(self.p.sim_days):
            # 1. 生成新用户
            self._generate_users(day)

            # 2. VIP转化
            self._check_vip_conversion(day)

            # 3. 订单处理
            self._process_orders(day)

            # 4. 冻结过期检查（每天）
            if day % 5 == 0:  # 每5天检查一次以提升性能
                self._expire_frozen(day)

            # 5. 可用过期检查（每天）
            if day % 5 == 0:
                self._expire_available(day)

            # 6. 提现（每30天）
            if (day + 1) % 30 == 0:
                self._process_withdrawals(day)

            # 7. 用户流失（每30天）
            if (day + 1) % 30 == 0:
                self._process_churn(day)

            # 8. 日常成本
            self._daily_costs(day)

            # 9. 记录用户数
            self.ledger.record(day, 'user_count', self.num_users)

            # 进度
            if (day + 1) % 90 == 0:
                elapsed = time.time() - t0
                pct = (day + 1) / self.p.sim_days * 100
                print(f"  Day {day+1}/{self.p.sim_days} ({pct:.0f}%) - "
                      f"用户: {self.num_users}, "
                      f"普通树深: {self.normal_tree.get_depth()}, "
                      f"VIP树深: {self.vip_tree.get_depth()}, "
                      f"耗时: {elapsed:.1f}s")

        elapsed = time.time() - t0
        print(f"仿真完成! 耗时: {elapsed:.1f}s")

        return self._compile_results()

    def _compile_results(self) -> dict:
        """汇编结果"""
        L = self.ledger
        p = self.p
        n_months = min(12, p.sim_days // 30)

        # 月度P&L
        monthly_pnl = []
        for m in range(n_months):
            rev = L.month_sum('revenue', m)
            cogs = L.month_sum('cogs', m)
            gp = L.month_sum('gross_profit', m)
            plat = L.month_sum('platform_income', m) + L.month_sum('funds_income', m)
            seller = L.month_sum('seller_payout', m)
            reward_gen = L.month_sum('reward_generated', m)
            withdrawn = L.month_sum('withdrawn', m)
            frozen_exp = L.month_sum('frozen_expired', m)
            avail_exp = L.month_sum('avail_expired', m)
            vip_inc = L.month_sum('vip_purchase_income', m)
            ref_cost = L.month_sum('referral_cost', m)
            lot_cost = L.month_sum('lottery_cost', m)
            rep_cost = L.month_sum('replacement_cost', m)
            op_cost = L.month_sum('operating_cost', m)
            reward_to_plat = L.month_sum('reward_to_platform', m)

            net = (plat + vip_inc + frozen_exp + avail_exp + reward_to_plat
                   - seller - withdrawn - ref_cost - lot_cost - rep_cost - op_cost)

            monthly_pnl.append({
                'month': m + 1,
                'revenue': rev,
                'cogs': cogs,
                'gross_profit': gp,
                'platform_income': plat,
                'seller_payout': seller,
                'reward_generated': reward_gen,
                'reward_withdrawn': withdrawn,
                'frozen_expired': frozen_exp,
                'avail_expired': avail_exp,
                'reward_to_platform': reward_to_plat,
                'vip_income': vip_inc,
                'referral_cost': ref_cost,
                'lottery_cost': lot_cost,
                'replacement_cost': rep_cost,
                'operating_cost': op_cost,
                'net_profit': net,
                'net_margin': net / rev if rev > 0 else 0,
            })

        # 树结构摘要
        tree_summary = {
            'normal_depth': self.normal_tree.get_depth(),
            'normal_size': self.normal_tree.size,
            'normal_level_counts': self.normal_tree.get_level_counts(10),
            'vip_depth': self.vip_tree.get_depth(),
            'vip_size': self.vip_tree.size,
            'vip_level_counts': self.vip_tree.get_level_counts(10),
        }

        # 奖励流向摘要
        total_gen = float(np.sum(L.daily['reward_generated']))
        total_frozen = float(np.sum(L.daily['reward_frozen']))
        total_unlocked = float(np.sum(L.daily['reward_unlocked']))
        total_direct = float(np.sum(L.daily['reward_direct_avail']))
        total_withdrawn = float(np.sum(L.daily['withdrawn']))
        total_frozen_exp = float(np.sum(L.daily['frozen_expired']))
        total_avail_exp = float(np.sum(L.daily['avail_expired']))
        total_to_plat = float(np.sum(L.daily['reward_to_platform']))

        reward_summary = {
            'total_generated': total_gen,
            'total_frozen': total_frozen,
            'total_unlocked': total_unlocked,
            'total_direct_avail': total_direct,
            'total_withdrawn': total_withdrawn,
            'total_frozen_expired': total_frozen_exp,
            'total_avail_expired': total_avail_exp,
            'total_to_platform': total_to_plat,
            'outflow_rate': total_withdrawn / total_gen if total_gen > 0 else 0,
        }

        # Top用户分析（Level 1-3）
        top_user_analysis = self._analyze_top_users()

        return {
            'monthly_pnl': monthly_pnl,
            'tree_summary': tree_summary,
            'reward_summary': reward_summary,
            'top_user_analysis': top_user_analysis,
            'ledger': L,
            'num_users': self.num_users,
            'num_vip': int(np.sum(self.is_vip[:self.num_users])),
            'num_active': int(np.sum(self.is_active[:self.num_users])),
        }

    def _analyze_top_users(self) -> dict:
        """分析Level 1-3用户的奖励情况"""
        result = {'levels': {}}

        for level in [1, 2, 3]:
            if level >= len(self.normal_tree._level_nodes):
                continue
            nodes = self.normal_tree._level_nodes[level]
            total_reward = 0.0
            user_rewards = []

            for node_id in nodes:
                uid = self.normal_tree.user_of[node_id]
                if uid < 0:
                    continue
                reward = self.normal_available[uid] + self.vip_available[uid]
                # 加上已提现的（从ledger无法追踪到个人，用粗略估算）
                # 这里只报告当前持有
                total_reward += reward
                user_rewards.append(reward)

            n_users = len(user_rewards)
            result['levels'][level] = {
                'num_users': n_users,
                'total_holding': total_reward,
                'avg_holding': total_reward / n_users if n_users > 0 else 0,
                'max_holding': max(user_rewards) if user_rewards else 0,
            }

        return result


# ============================================================
# 报告生成
# ============================================================

def format_report(results: dict, params: SimParams) -> str:
    """生成完整文本报告"""
    lines = []
    mode = "最坏情况" if params.worst_case else "默认参数"

    lines.append("=" * 72)
    lines.append(f"  农脉分润奖励系统 — 时序仿真报告 [{mode}]")
    lines.append(f"  仿真天数: {params.sim_days}天 | 种子: {params.seed}")
    lines.append("=" * 72)
    lines.append("")

    # ── 参数摘要 ──
    lines.append("【参数摘要】")
    lines.append(f"  加价率: {params.markup:.2f}  |  普通奖励: {params.normal_reward_pct*100:.0f}%  |  VIP奖励: {params.vip_reward_pct*100:.0f}%")
    lines.append(f"  普通用户目标: {params.N_normal}  |  VIP目标: {params.N_vip}  |  叉数: {params.branch_factor}")
    lines.append(f"  普通频率: {params.freq_normal}次/月  |  VIP频率: {params.freq_vip}次/月")
    lines.append(f"  最大层数: {params.max_layers}  |  冻结天数: {params.freeze_days}  |  可用过期天数: {params.normal_reward_expiry_days}")
    lines.append(f"  提现率: {params.withdrawal_rate*100:.0f}%  |  流失率: {params.churn_rate*100:.0f}%/月")
    lines.append(f"  实际总用户: {results['num_users']}  |  VIP: {results['num_vip']}  |  活跃: {results['num_active']}")
    lines.append("")

    # ── 月度P&L ──
    lines.append("=" * 72)
    lines.append("  月度损益表 (P&L)")
    lines.append("=" * 72)
    lines.append("")

    header = (f"{'月':>3} {'营收':>12} {'毛利':>12} {'平台收入':>12} "
              f"{'卖家':>10} {'奖励提现':>10} {'过期回流':>10} "
              f"{'净利润':>12} {'净利率':>8}")
    lines.append(header)
    lines.append("-" * 100)

    for m in results['monthly_pnl']:
        expired_total = m['frozen_expired'] + m['avail_expired'] + m['reward_to_platform']
        lines.append(
            f"{m['month']:>3} "
            f"¥{m['revenue']:>11,.0f} "
            f"¥{m['gross_profit']:>11,.0f} "
            f"¥{m['platform_income']:>11,.0f} "
            f"¥{m['seller_payout']:>9,.0f} "
            f"¥{m['reward_withdrawn']:>9,.0f} "
            f"¥{expired_total:>9,.0f} "
            f"¥{m['net_profit']:>11,.0f} "
            f"{m['net_margin']*100:>7.1f}%"
        )

    # 年度合计
    totals = {}
    for key in ['revenue', 'gross_profit', 'platform_income', 'seller_payout',
                 'reward_withdrawn', 'frozen_expired', 'avail_expired',
                 'reward_to_platform', 'net_profit',
                 'vip_income', 'referral_cost', 'lottery_cost',
                 'replacement_cost', 'operating_cost', 'reward_generated']:
        totals[key] = sum(m[key] for m in results['monthly_pnl'])

    lines.append("-" * 100)
    exp_total = totals['frozen_expired'] + totals['avail_expired'] + totals['reward_to_platform']
    ann_margin = totals['net_profit'] / totals['revenue'] if totals['revenue'] > 0 else 0
    lines.append(
        f"{'合计':>3} "
        f"¥{totals['revenue']:>11,.0f} "
        f"¥{totals['gross_profit']:>11,.0f} "
        f"¥{totals['platform_income']:>11,.0f} "
        f"¥{totals['seller_payout']:>9,.0f} "
        f"¥{totals['reward_withdrawn']:>9,.0f} "
        f"¥{exp_total:>9,.0f} "
        f"¥{totals['net_profit']:>11,.0f} "
        f"{ann_margin*100:>7.1f}%"
    )
    lines.append("")

    # 详细成本明细
    lines.append("  年度成本明细:")
    lines.append(f"    卖家产业基金:  ¥{totals['seller_payout']:>14,.2f}")
    lines.append(f"    奖励提现流出:  ¥{totals['reward_withdrawn']:>14,.2f}")
    lines.append(f"    VIP推荐奖励:   ¥{totals['referral_cost']:>14,.2f}")
    lines.append(f"    抽奖成本:      ¥{totals['lottery_cost']:>14,.2f}")
    lines.append(f"    换货成本:      ¥{totals['replacement_cost']:>14,.2f}")
    lines.append(f"    运营成本:      ¥{totals['operating_cost']:>14,.2f}")
    lines.append("")

    lines.append("  年度收入明细:")
    lines.append(f"    平台分润收入:  ¥{totals['platform_income']:>14,.2f}")
    lines.append(f"    VIP礼包收入:   ¥{totals['vip_income']:>14,.2f}")
    lines.append(f"    过期回流:      ¥{exp_total:>14,.2f}")
    lines.append("")

    # ── 树结构摘要 ──
    lines.append("=" * 72)
    lines.append("  树结构摘要")
    lines.append("=" * 72)

    ts = results['tree_summary']
    lines.append(f"  普通树: 深度={ts['normal_depth']}, 节点数={ts['normal_size']}")
    lines.append(f"  VIP树:  深度={ts['vip_depth']}, 节点数={ts['vip_size']}")
    lines.append("")
    lines.append("  普通树各层用户数 (前10层):")
    for i, cnt in enumerate(ts['normal_level_counts']):
        label = "(根)" if i == 0 else ""
        lines.append(f"    Level {i}: {cnt:>8} 个节点 {label}")
    lines.append("")
    lines.append("  VIP树各层用户数 (前10层):")
    for i, cnt in enumerate(ts['vip_level_counts']):
        label = "(超级根)" if i == 0 else "(A1-A10)" if i == 1 else ""
        lines.append(f"    Level {i}: {cnt:>8} 个节点 {label}")
    lines.append("")

    # ── 奖励流向摘要 ──
    lines.append("=" * 72)
    lines.append("  奖励流向摘要")
    lines.append("=" * 72)

    rs = results['reward_summary']
    tg = rs['total_generated']
    lines.append(f"  奖励池总生成:           ¥{tg:>14,.2f}")
    lines.append(f"  ├ 直接归平台(根/超层):   ¥{rs['total_to_platform']:>14,.2f}  ({rs['total_to_platform']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append(f"  ├ 直接可用(祖辈已解锁):  ¥{rs['total_direct_avail']:>14,.2f}  ({rs['total_direct_avail']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append(f"  ├ 冻结:                  ¥{rs['total_frozen']:>14,.2f}  ({rs['total_frozen']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append(f"  │  ├ 解锁→可用:          ¥{rs['total_unlocked']:>14,.2f}  ({rs['total_unlocked']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append(f"  │  └ 冻结过期→平台:      ¥{rs['total_frozen_expired']:>14,.2f}  ({rs['total_frozen_expired']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append(f"  ├ 可用过期→平台:         ¥{rs['total_avail_expired']:>14,.2f}  ({rs['total_avail_expired']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append(f"  └ 已提现(真实流出):      ¥{rs['total_withdrawn']:>14,.2f}  ({rs['total_withdrawn']/tg*100:.1f}%)" if tg > 0 else "")
    lines.append("")
    lines.append(f"  奖励实际流出率:          {rs['outflow_rate']*100:.1f}%")
    lines.append("")

    # ── Top用户分析 ──
    lines.append("=" * 72)
    lines.append("  Top用户分析 (普通树 Level 1-3)")
    lines.append("=" * 72)

    tua = results['top_user_analysis']
    for level in [1, 2, 3]:
        if level in tua['levels']:
            info = tua['levels'][level]
            lines.append(f"  Level {level}: {info['num_users']}人, "
                         f"总持有: ¥{info['total_holding']:,.2f}, "
                         f"人均: ¥{info['avg_holding']:,.2f}, "
                         f"最高: ¥{info['max_holding']:,.2f}")
        else:
            lines.append(f"  Level {level}: 无数据")

    lines.append("")
    lines.append("=" * 72)

    return '\n'.join(lines)


# ============================================================
# 图表生成
# ============================================================

def generate_charts(results: dict, params: SimParams):
    """生成4张图表"""
    os.makedirs(CHART_DIR, exist_ok=True)
    L = results['ledger']
    days = params.sim_days
    mode_tag = "worst" if params.worst_case else "default"

    months_x = np.arange(1, len(results['monthly_pnl']) + 1)

    # ── Chart A: 累积资金流 ──
    fig, ax = plt.subplots(figsize=(12, 7))
    x = np.arange(days)

    cum_rev = L.cumulative('revenue')
    cum_plat = L.cumulative('platform_income') + L.cumulative('funds_income')
    cum_withdrawn = L.cumulative('withdrawn')
    cum_expired = (L.cumulative('frozen_expired') +
                   L.cumulative('avail_expired') +
                   L.cumulative('reward_to_platform'))

    ax.plot(x, cum_rev / 10000, label='累计总营收', linewidth=2)
    ax.plot(x, cum_plat / 10000, label='累计平台分润收入', linewidth=2)
    ax.plot(x, cum_withdrawn / 10000, label='累计奖励提现', linewidth=2, color='red')
    ax.plot(x, cum_expired / 10000, label='累计过期回流平台', linewidth=2, color='green', linestyle='--')

    ax.set_xlabel('天数')
    ax.set_ylabel('金额 (万元)')
    ax.set_title(f'累积资金流 [{mode_tag}]', fontsize=14, fontweight='bold')
    ax.legend(fontsize=11)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(CHART_DIR, f'chart_a_cumulative_{mode_tag}.png'), dpi=150)
    plt.close(fig)

    # ── Chart B: 树深度 ──
    # 需要重新计算每月的树深度（从ledger无法直接获取，用估算）
    fig, ax1 = plt.subplots(figsize=(12, 7))

    user_counts = []
    normal_depths = []
    vip_depths = []
    for m in range(len(results['monthly_pnl'])):
        day_end = min((m + 1) * 30 - 1, days - 1)
        uc = L.daily['user_count'][day_end]
        user_counts.append(uc)
        # 估算树深度（基于用户数和叉数）
        bf = params.branch_factor
        if uc > 1:
            nd = math.ceil(math.log(max(uc * 0.9 * (bf - 1) + 1, 2)) / math.log(bf))
        else:
            nd = 0
        normal_depths.append(nd)
        # VIP树
        n_vip_est = uc * params.vip_conversion_rate_annual
        if n_vip_est > 10:
            vd = math.ceil(math.log(max(n_vip_est / 10 * (bf - 1) + 1, 2)) / math.log(bf)) + 1
        else:
            vd = 1
        vip_depths.append(vd)

    ax1.bar(months_x, np.array(user_counts) / 1000, alpha=0.3, color='skyblue', label='用户数(千)')
    ax1.set_xlabel('月份')
    ax1.set_ylabel('用户数 (千)')

    ax2 = ax1.twinx()
    ax2.plot(months_x, normal_depths, 'o-', color='green', label='普通树深度', linewidth=2)
    ax2.plot(months_x, vip_depths, 's--', color='purple', label='VIP树深度', linewidth=2)
    ax2.set_ylabel('树深度')
    # 用实际最终深度
    ax2.axhline(y=results['tree_summary']['normal_depth'], color='green', alpha=0.3, linestyle=':')
    ax2.axhline(y=results['tree_summary']['vip_depth'], color='purple', alpha=0.3, linestyle=':')

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left', fontsize=11)

    ax1.set_title(f'树深度与用户增长 [{mode_tag}]', fontsize=14, fontweight='bold')
    fig.tight_layout()
    fig.savefig(os.path.join(CHART_DIR, f'chart_b_tree_depth_{mode_tag}.png'), dpi=150)
    plt.close(fig)

    # ── Chart C: 月度净利润柱状图 ──
    fig, ax1 = plt.subplots(figsize=(12, 7))

    net_profits = [m['net_profit'] for m in results['monthly_pnl']]
    net_margins = [m['net_margin'] * 100 for m in results['monthly_pnl']]

    colors = ['green' if x >= 0 else 'red' for x in net_profits]
    ax1.bar(months_x, np.array(net_profits) / 10000, color=colors, alpha=0.7, label='月度净利润(万)')
    ax1.set_xlabel('月份')
    ax1.set_ylabel('净利润 (万元)')
    ax1.axhline(y=0, color='black', linewidth=0.5)

    ax2 = ax1.twinx()
    ax2.plot(months_x, net_margins, 'o-', color='blue', linewidth=2, label='净利率%')
    ax2.set_ylabel('净利率 (%)')

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left', fontsize=11)

    ax1.set_title(f'月度净利润 [{mode_tag}]', fontsize=14, fontweight='bold')
    fig.tight_layout()
    fig.savefig(os.path.join(CHART_DIR, f'chart_c_monthly_profit_{mode_tag}.png'), dpi=150)
    plt.close(fig)

    # ── Chart D: 奖励状态堆叠面积图 ──
    fig, ax = plt.subplots(figsize=(12, 7))

    cum_direct = L.cumulative('reward_direct_avail')
    cum_unlocked = L.cumulative('reward_unlocked')
    cum_frozen_bal = L.cumulative('reward_frozen') - L.cumulative('reward_unlocked') - L.cumulative('frozen_expired')
    cum_withdrawn_tot = L.cumulative('withdrawn')
    cum_expired_tot = L.cumulative('frozen_expired') + L.cumulative('avail_expired')

    # 确保不为负
    cum_frozen_bal = np.maximum(cum_frozen_bal, 0)

    ax.stackplot(x,
                 cum_withdrawn_tot / 10000,
                 cum_expired_tot / 10000,
                 (cum_direct + cum_unlocked - cum_withdrawn_tot - L.cumulative('avail_expired')) / 10000,
                 cum_frozen_bal / 10000,
                 labels=['已提现', '已过期回流', '可用余额', '冻结中'],
                 colors=['#e74c3c', '#27ae60', '#3498db', '#f39c12'],
                 alpha=0.7)

    ax.set_xlabel('天数')
    ax.set_ylabel('累计金额 (万元)')
    ax.set_title(f'奖励状态分布 [{mode_tag}]', fontsize=14, fontweight='bold')
    ax.legend(loc='upper left', fontsize=11)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(CHART_DIR, f'chart_d_reward_states_{mode_tag}.png'), dpi=150)
    plt.close(fig)

    print(f"  图表已保存到: {CHART_DIR}/")


# ============================================================
# 主入口
# ============================================================

def main():
    args = sys.argv[1:]

    worst_mode = '--worst' in args
    days = 365

    for i, arg in enumerate(args):
        if arg == '--days' and i + 1 < len(args):
            days = int(args[i + 1])

    params = SimParams(
        sim_days=days,
        worst_case=worst_mode,
    )

    if worst_mode:
        # 最坏情况覆盖
        params.withdrawal_rate = 1.0
        params.churn_rate = 0.0
        params.completion_rate = 1.0
        params.normal_reward_expiry_days = 9999
        params.vip_reward_expiry_days = 9999

    # 运行仿真
    sim = Simulation(params)
    results = sim.run()

    # 生成报告
    report = format_report(results, params)
    print("\n" + report)

    # 保存报告
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    report_path = os.path.join(OUTPUT_DIR, 'simulation_result.txt')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"\n报告已保存: {report_path}")

    # 生成图表
    print("\n生成图表...")
    generate_charts(results, params)

    print("\n仿真完成!")


if __name__ == '__main__':
    main()
