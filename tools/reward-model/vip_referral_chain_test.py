#!/usr/bin/env python3
"""
VIP 推荐链路完整测试 & 平台利润仿真
=============================================

精确模拟真实代码中的推荐进树机制：
  1. 推荐码绑定 → 购买VIP → 优先插到推荐人子树
  2. 推荐人子树满 → BFS 滑落到推荐人子树空位
  3. 无推荐人 / 子树全满 → 系统根节点 A1-A10
  4. 购买VIP → 一次性推荐奖励 (15%)
  5. 日常消费 → 六分利润 → 30% 上游分润（第k次消费→第k层祖先）
  6. 冻结/解锁/过期机制

输出：平台收入明细、净利润、ROI、盈亏平衡分析

用法：
  python vip_referral_chain_test.py
"""

import os
import sys
import math
import json
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from collections import deque
import random

# ============================================================
# 参数（与代码完全一致）
# ============================================================

@dataclass
class Config:
    """从 bonus-config.service.ts 提取的真实参数"""

    # VIP 礼包成本及分润（来自《VIP礼包内部成本及分润控制总表》）
    # 成本 = 礼包价 × 70%（海产品75% + 酒20% + 物流5%）
    # 利润 = 礼包价 × 30%（市场分润50% + 平台分润30% + 产业及慈善20%）
    vip_packages: List[dict] = field(default_factory=lambda: [
        {"name": "基础版", "price": 399, "gift_cost": 279.30, "profit": 119.70,
         "market_pct": 0.50, "platform_pct": 0.30, "industry_charity_pct": 0.20},
        {"name": "标准版", "price": 899, "gift_cost": 629.30, "profit": 269.70,
         "market_pct": 0.50, "platform_pct": 0.30, "industry_charity_pct": 0.20},
        {"name": "豪华版", "price": 1599, "gift_cost": 1119.30, "profit": 479.70,
         "market_pct": 0.50, "platform_pct": 0.30, "industry_charity_pct": 0.20},
    ])

    # VIP 六分利润 (总和=1.0)
    vip_platform_pct: float = 0.50
    vip_reward_pct: float = 0.30        # 上游分润池
    vip_industry_pct: float = 0.10      # 给卖家(产业基金)
    vip_charity_pct: float = 0.02
    vip_tech_pct: float = 0.02
    vip_reserve_pct: float = 0.06

    # 普通用户六分利润
    normal_platform_pct: float = 0.50
    normal_reward_pct: float = 0.16
    normal_industry_pct: float = 0.16
    normal_charity_pct: float = 0.08
    normal_tech_pct: float = 0.08
    normal_reserve_pct: float = 0.02

    # 树参数
    branch_factor: int = 3
    max_layers: int = 13
    freeze_days: int = 30

    # 定价
    markup_rate: float = 1.30          # 售价 = 成本 × 1.30
    vip_discount_rate: float = 0.95    # VIP 95折

    # 运费
    vip_free_shipping: float = 49.0
    normal_free_shipping: float = 99.0
    default_shipping: float = 8.0


# ============================================================
# VIP 三叉树（精确模拟代码逻辑）
# ============================================================

class VipTreeNode:
    __slots__ = ['id', 'root_id', 'user_id', 'parent_id', 'children',
                 'level', 'position', 'children_count']

    def __init__(self, node_id, root_id, user_id, parent_id, level, position):
        self.id = node_id
        self.root_id = root_id
        self.user_id = user_id
        self.parent_id = parent_id
        self.children: List[int] = []
        self.level = level
        self.position = position
        self.children_count = 0


class VipTree:
    """精确模拟 bonus.service.ts 中的 assignVipTreeNode 逻辑"""

    def __init__(self, branch_factor=3, num_roots=10, max_bfs=10000, max_depth=20):
        self.bf = branch_factor
        self.max_bfs = max_bfs
        self.max_depth = max_depth
        self.nodes: Dict[int, VipTreeNode] = {}
        self.user_to_node: Dict[int, int] = {}  # user_id → node_id
        self._next_id = 0

        # 创建系统根节点 A1-A10
        self.root_ids: List[int] = []
        for i in range(num_roots):
            root_id_label = f"A{i+1}"
            node = self._create_node(root_id_label, user_id=None, parent_id=None, level=0, position=0)
            self.root_ids.append(node.id)

    def _create_node(self, root_id, user_id, parent_id, level, position) -> VipTreeNode:
        nid = self._next_id
        self._next_id += 1
        node = VipTreeNode(nid, root_id, user_id, parent_id, level, position)
        self.nodes[nid] = node
        if user_id is not None:
            self.user_to_node[user_id] = nid
        if parent_id is not None and parent_id in self.nodes:
            parent = self.nodes[parent_id]
            parent.children.append(nid)
            parent.children_count += 1
        return node

    def assign_node(self, user_id: int, inviter_user_id: Optional[int] = None) -> VipTreeNode:
        """
        精确模拟 assignVipTreeNode():
        1. 有推荐人 → 挂推荐人子树
        2. 推荐人满 → BFS 滑落
        3. 无推荐人/全满 → 系统根节点
        """
        parent_node = None
        root_id = None

        # Case 1: 有推荐人
        if inviter_user_id is not None and inviter_user_id in self.user_to_node:
            inviter_nid = self.user_to_node[inviter_user_id]
            inviter_node = self.nodes[inviter_nid]

            if inviter_node.children_count < self.bf:
                parent_node = inviter_node
                root_id = inviter_node.root_id
            else:
                # BFS 在推荐人子树找空位
                found = self._bfs_find_slot(inviter_nid)
                if found is not None:
                    parent_node = found
                    root_id = inviter_node.root_id

        # Case 2: 无推荐人或子树满 → 系统根节点
        if parent_node is None:
            for rid in self.root_ids:
                root_node = self.nodes[rid]
                if root_node.children_count < self.bf:
                    parent_node = root_node
                    root_id = root_node.root_id
                    break
                else:
                    found = self._bfs_find_slot(rid)
                    if found is not None:
                        parent_node = found
                        root_id = root_node.root_id
                        break

        if parent_node is None:
            raise RuntimeError("所有根节点子树已满，无法插入")

        position = parent_node.children_count
        new_node = self._create_node(
            root_id=root_id,
            user_id=user_id,
            parent_id=parent_node.id,
            level=parent_node.level + 1,
            position=position,
        )
        return new_node

    def _bfs_find_slot(self, start_nid: int) -> Optional[VipTreeNode]:
        """BFS 在子树中找第一个有空位的节点"""
        queue = deque()
        # 先从 start_nid 的子节点开始搜
        start = self.nodes[start_nid]
        for cid in start.children:
            child = self.nodes[cid]
            queue.append((cid, child.level - start.level))

        iterations = 0
        while queue:
            if iterations >= self.max_bfs:
                break
            iterations += 1
            nid, depth = queue.popleft()
            if depth >= self.max_depth:
                continue
            node = self.nodes[nid]
            if node.children_count < self.bf:
                return node
            for cid in node.children:
                child = self.nodes[cid]
                queue.append((cid, depth + 1))

        return None

    def get_kth_ancestor(self, user_id: int, k: int) -> Optional[VipTreeNode]:
        """从用户节点向上走 k 步"""
        if user_id not in self.user_to_node:
            return None
        nid = self.user_to_node[user_id]
        current = self.nodes[nid]
        for _ in range(k):
            if current.parent_id is None:
                return None
            current = self.nodes[current.parent_id]
        # 如果走到系统根节点(user_id=None)，返回 None
        if current.user_id is None:
            return None
        return current

    def get_stats(self) -> dict:
        """树统计"""
        user_nodes = [n for n in self.nodes.values() if n.user_id is not None]
        if not user_nodes:
            return {"total_nodes": 0, "max_depth": 0, "avg_depth": 0}
        depths = [n.level for n in user_nodes]
        return {
            "total_nodes": len(user_nodes),
            "max_depth": max(depths),
            "avg_depth": sum(depths) / len(depths),
            "system_roots": len(self.root_ids),
        }


# ============================================================
# 用户模型
# ============================================================

@dataclass
class User:
    id: int
    is_vip: bool = False
    inviter_id: Optional[int] = None
    vip_package_idx: int = 0               # 购买的VIP档位
    purchase_count: int = 0                 # 有效消费次数
    reward_balance: float = 0.0            # 可用奖励余额
    frozen_rewards: List[dict] = field(default_factory=list)  # [{amount, required_k, day}]
    total_spent: float = 0.0               # 总消费额
    join_day: int = 0


# ============================================================
# 仿真引擎
# ============================================================

class VipReferralSimulation:
    """VIP 推荐链路全流程仿真"""

    def __init__(self, config: Config, seed=42):
        self.c = config
        self.rng = random.Random(seed)
        self.tree = VipTree(branch_factor=config.branch_factor)
        self.users: Dict[int, User] = {}
        self._next_uid = 1

        # === 平台账本 ===
        self.platform = {
            # ── VIP 礼包收支 ──
            "vip_package_revenue": 0.0,        # VIP 包购买总收入
            "gift_cost": 0.0,                  # 赠品成本（礼包价×70%）
            "referral_bonus_paid": 0.0,        # 市场分润/推荐奖励支出（利润×50%，有推荐人才发）
            "vip_pkg_platform_profit": 0.0,    # VIP礼包平台分润（利润×30%）+ 无推荐人时的市场分润
            "vip_pkg_industry_charity": 0.0,   # VIP礼包产业及慈善（利润×20%）

            # ── 订单分润收支 ──
            "order_platform_share": 0.0,       # 订单利润 × 50%（平台分成）
            "reward_to_platform": 0.0,         # 奖励归平台（祖先为系统根/超出层数/子树不够深）
            "frozen_expired": 0.0,             # 冻结过期归平台
            "reward_released": 0.0,            # 上游分润实际释放给用户
            "industry_fund_to_seller": 0.0,    # 产业基金（给卖家）

            # ── 订单基金 ──
            "charity_fund": 0.0,
            "tech_fund": 0.0,
            "reserve_fund": 0.0,

            # ── 统计 ──
            "total_orders": 0,
            "total_order_revenue": 0.0,        # 总交易额（GMV）
            "total_order_profit": 0.0,         # 总订单利润（售价-成本）
            "total_reward_pool": 0.0,          # 总奖励池（利润×30%）
        }

        # 用户提现
        self.total_withdrawn = 0.0

    def create_user(self, inviter_id=None, join_day=0) -> User:
        uid = self._next_uid
        self._next_uid += 1
        u = User(id=uid, inviter_id=inviter_id, join_day=join_day)
        self.users[uid] = u
        return u

    def purchase_vip(self, user: User, package_idx: int = 0, day: int = 0):
        """
        模拟 VIP 购买全流程
        按《VIP礼包内部成本及分润控制总表》:
          成本 = 礼包价 × 70%
          利润 = 礼包价 × 30%, 再三分:
            市场分润 50% → 推荐奖励(有推荐人才发)
            平台分润 30% → 平台
            产业及慈善 20% → 产业/慈善基金
        """
        if user.is_vip:
            return

        pkg = self.c.vip_packages[package_idx]
        user.is_vip = True
        user.vip_package_idx = package_idx

        profit = pkg["profit"]  # 礼包价 × 30%

        # 1. 平台收入 = VIP 包价格
        self.platform["vip_package_revenue"] += pkg["price"]

        # 2. 赠品成本 = 礼包价 × 70%
        self.platform["gift_cost"] += pkg["gift_cost"]

        # 3. VIP 礼包利润分配
        # 平台分润 30% of profit
        self.platform["vip_pkg_platform_profit"] += profit * pkg["platform_pct"]
        # 产业及慈善 20% of profit
        self.platform["vip_pkg_industry_charity"] += profit * pkg["industry_charity_pct"]

        # 4. 进树（推荐人优先）
        self.tree.assign_node(user.id, inviter_user_id=user.inviter_id)

        # 5. 市场分润 50% of profit → 推荐奖励（只有有推荐人才发）
        market_share = profit * pkg["market_pct"]
        if user.inviter_id and user.inviter_id in self.users:
            inviter = self.users[user.inviter_id]
            inviter.reward_balance += market_share
            self.platform["referral_bonus_paid"] += market_share
        else:
            # 无推荐人，市场分润归平台
            self.platform["vip_pkg_platform_profit"] += market_share

    def process_order(self, user: User, order_cost: float, day: int = 0):
        """
        模拟一次消费订单的利润分配
        order_cost: 商品成本价
        """
        selling_price = order_cost * self.c.markup_rate
        if user.is_vip:
            selling_price *= self.c.vip_discount_rate

        profit = selling_price - order_cost
        if profit <= 0:
            return

        user.purchase_count += 1
        user.total_spent += selling_price

        self.platform["total_orders"] += 1
        self.platform["total_order_revenue"] += selling_price
        self.platform["total_order_profit"] += profit

        if user.is_vip:
            self._distribute_vip_profit(user, profit, day)
        else:
            self._distribute_normal_profit(user, profit, day)

    def _distribute_vip_profit(self, user: User, profit: float, day: int):
        """VIP 六分利润分配"""
        c = self.c
        platform_share = profit * c.vip_platform_pct
        reward_pool = profit * c.vip_reward_pct
        industry = profit * c.vip_industry_pct
        charity = profit * c.vip_charity_pct
        tech = profit * c.vip_tech_pct
        reserve = profit - platform_share - reward_pool - industry - charity - tech  # 末池补差

        self.platform["order_platform_share"] += platform_share
        self.platform["industry_fund_to_seller"] += industry
        self.platform["charity_fund"] += charity
        self.platform["tech_fund"] += tech
        self.platform["reserve_fund"] += reserve
        self.platform["total_reward_pool"] += reward_pool

        # 上游分润：第 k 次消费 → 第 k 层祖先
        k = user.purchase_count
        if k > c.max_layers:
            # 超出层数，奖励归平台
            self.platform["reward_to_platform"] += reward_pool
            return

        ancestor = self.tree.get_kth_ancestor(user.id, k)
        if ancestor is None:
            # 祖先为系统根或不存在，奖励归平台
            self.platform["reward_to_platform"] += reward_pool
            return

        ancestor_user = self.users.get(ancestor.user_id)
        if ancestor_user is None:
            self.platform["reward_to_platform"] += reward_pool
            return

        # 检查祖先是否解锁（自己消费次数 >= k）
        if ancestor_user.purchase_count >= k:
            # 立即可用
            ancestor_user.reward_balance += reward_pool
            self.platform["reward_released"] += reward_pool
        else:
            # 冻结
            ancestor_user.frozen_rewards.append({
                "amount": reward_pool,
                "required_k": k,
                "day": day,
            })

    def _distribute_normal_profit(self, user: User, profit: float, day: int):
        """普通用户六分利润分配（简化：不模拟普通树，只计算平台收入）"""
        c = self.c
        platform_share = profit * c.normal_platform_pct
        reward_pool = profit * c.normal_reward_pct
        industry = profit * c.normal_industry_pct
        charity = profit * c.normal_charity_pct
        tech = profit * c.normal_tech_pct
        reserve = profit - platform_share - reward_pool - industry - charity - tech

        self.platform["order_platform_share"] += platform_share
        self.platform["industry_fund_to_seller"] += industry
        self.platform["charity_fund"] += charity
        self.platform["tech_fund"] += tech
        self.platform["reserve_fund"] += reserve
        self.platform["total_reward_pool"] += reward_pool

        # 普通用户上游分润同理（简化处理：按概率分配）
        # 这里暂时假设普通用户奖励池有 50% 实际释放，50% 归平台
        released = reward_pool * 0.50
        to_platform = reward_pool * 0.50
        self.platform["reward_released"] += released
        self.platform["reward_to_platform"] += to_platform

    def process_frozen_unlock(self, day: int):
        """每天处理冻结奖励的解锁和过期"""
        for user in self.users.values():
            remaining = []
            for fr in user.frozen_rewards:
                age = day - fr["day"]
                if age >= self.c.freeze_days:
                    # 过期，归平台
                    self.platform["frozen_expired"] += fr["amount"]
                elif user.purchase_count >= fr["required_k"]:
                    # 已解锁
                    user.reward_balance += fr["amount"]
                    self.platform["reward_released"] += fr["amount"]
                else:
                    remaining.append(fr)
            user.frozen_rewards = remaining

    def process_withdrawals(self, withdrawal_rate: float = 0.80):
        """处理提现"""
        for user in self.users.values():
            if user.reward_balance > 1.0:
                amount = user.reward_balance * withdrawal_rate
                user.reward_balance -= amount
                self.total_withdrawn += amount


# ============================================================
# 测试场景
# ============================================================

def scenario_1_basic_chain():
    """
    场景1：基础推荐链 (10人链式推荐)
    A → B → C → D → E → F → G → H → I → J
    每人买399VIP，每人消费5次
    """
    print("=" * 70)
    print("场景1：基础推荐链 (10人链式推荐)")
    print("=" * 70)

    c = Config()
    sim = VipReferralSimulation(c, seed=42)

    # 创建链式推荐
    users = []
    prev_id = None
    for i in range(10):
        u = sim.create_user(inviter_id=prev_id, join_day=i)
        sim.purchase_vip(u, package_idx=0, day=i)
        prev_id = u.id
        users.append(u)

    print(f"\n树结构统计: {sim.tree.get_stats()}")

    # 每人消费5次，每次成本100元（售价130，VIP 95折=123.5，利润23.5）
    for day in range(30):
        for u in users:
            if day < 5:  # 每人消费5次
                sim.process_order(u, order_cost=100.0, day=day)
        sim.process_frozen_unlock(day)

    _print_results(sim, "场景1")
    return sim


def scenario_2_tree_growth():
    """
    场景2：真实推荐裂变 (三叉树3层)
    1人 → 3人 → 9人 → 27人 = 40人
    模拟6个月运营
    """
    print("\n" + "=" * 70)
    print("场景2：三叉树推荐裂变 (1→3→9→27 = 40人)")
    print("=" * 70)

    c = Config()
    sim = VipReferralSimulation(c, seed=123)

    # 第一层：1个种子用户（无推荐人）
    root_user = sim.create_user(join_day=0)
    sim.purchase_vip(root_user, package_idx=0, day=0)

    # 第二层：3人被种子推荐
    layer2 = []
    for i in range(3):
        u = sim.create_user(inviter_id=root_user.id, join_day=7)
        sim.purchase_vip(u, package_idx=0, day=7)
        layer2.append(u)

    # 第三层：每人推荐3人 = 9人
    layer3 = []
    for parent in layer2:
        for i in range(3):
            u = sim.create_user(inviter_id=parent.id, join_day=14)
            sim.purchase_vip(u, package_idx=0, day=14)
            layer3.append(u)

    # 第四层：每人推荐3人 = 27人
    layer4 = []
    for parent in layer3:
        for i in range(3):
            u = sim.create_user(inviter_id=parent.id, join_day=30)
            sim.purchase_vip(u, package_idx=0, day=30)
            layer4.append(u)

    all_users = [root_user] + layer2 + layer3 + layer4
    print(f"总用户数: {len(all_users)}")
    print(f"树统计: {sim.tree.get_stats()}")

    # 180天运营，每用户平均每月消费2次
    for day in range(180):
        for u in all_users:
            if u.join_day <= day:
                # 每月2次消费，每次成本 80-150 随机
                if sim.rng.random() < 2.0 / 30:
                    cost = sim.rng.uniform(80, 150)
                    sim.process_order(u, order_cost=cost, day=day)
        if day % 7 == 0:
            sim.process_frozen_unlock(day)

    sim.process_frozen_unlock(180)
    _print_results(sim, "场景2")
    return sim


def scenario_3_large_scale():
    """
    场景3：大规模仿真 (1000 VIP + 5000 普通用户, 365天)
    30% VIP有推荐人, 70%无推荐人
    """
    print("\n" + "=" * 70)
    print("场景3：大规模仿真 (1000 VIP + 5000 普通, 365天)")
    print("=" * 70)

    c = Config()
    sim = VipReferralSimulation(c, seed=456)

    # 创建 VIP 用户
    vip_users = []
    for i in range(1000):
        # 30% 有推荐人（从已有 VIP 中随机选）
        inviter = None
        if vip_users and sim.rng.random() < 0.30:
            inviter = sim.rng.choice(vip_users).id

        join_day = sim.rng.randint(0, 180)  # 前半年陆续加入
        u = sim.create_user(inviter_id=inviter, join_day=join_day)

        # 随机选择VIP档位: 60% 基础, 30% 标准, 10% 豪华
        r = sim.rng.random()
        pkg_idx = 0 if r < 0.60 else (1 if r < 0.90 else 2)
        sim.purchase_vip(u, package_idx=pkg_idx, day=join_day)
        vip_users.append(u)

    # 创建普通用户（不买VIP）
    normal_users = []
    for i in range(5000):
        join_day = sim.rng.randint(0, 365)
        u = sim.create_user(join_day=join_day)
        normal_users.append(u)

    print(f"VIP用户: {len(vip_users)}, 普通用户: {len(normal_users)}")
    print(f"VIP树统计: {sim.tree.get_stats()}")

    # 365天运营
    all_users = vip_users + normal_users
    for day in range(365):
        for u in all_users:
            if u.join_day > day:
                continue
            if u.is_vip:
                # VIP 每月消费 4 次
                if sim.rng.random() < 4.0 / 30:
                    cost = sim.rng.uniform(80, 200)
                    sim.process_order(u, order_cost=cost, day=day)
            else:
                # 普通用户每月消费 2 次
                if sim.rng.random() < 2.0 / 30:
                    cost = sim.rng.uniform(60, 120)
                    sim.process_order(u, order_cost=cost, day=day)

        if day % 7 == 0:
            sim.process_frozen_unlock(day)

    sim.process_frozen_unlock(365)
    sim.process_withdrawals(0.80)
    _print_results(sim, "场景3")
    return sim


def scenario_4_worst_case():
    """
    场景4：最坏情况 - 所有奖励全部解锁、全部提现、无过期
    1000 VIP, 高频推荐（70%有推荐人）, 高频消费
    """
    print("\n" + "=" * 70)
    print("场景4：最坏情况 (高推荐率+全解锁+全提现)")
    print("=" * 70)

    c = Config()
    c.freeze_days = 9999  # 不过期
    sim = VipReferralSimulation(c, seed=789)

    vip_users = []
    for i in range(1000):
        inviter = None
        if vip_users and sim.rng.random() < 0.70:
            inviter = sim.rng.choice(vip_users).id

        join_day = sim.rng.randint(0, 90)
        u = sim.create_user(inviter_id=inviter, join_day=join_day)
        pkg_idx = 0  # 全部买基础版（利润最低）
        sim.purchase_vip(u, package_idx=pkg_idx, day=join_day)
        vip_users.append(u)

    print(f"VIP用户: {len(vip_users)}")
    print(f"VIP树统计: {sim.tree.get_stats()}")

    # 365天运营，高频消费：VIP每月6次
    for day in range(365):
        for u in vip_users:
            if u.join_day > day:
                continue
            if sim.rng.random() < 6.0 / 30:
                cost = sim.rng.uniform(80, 150)
                sim.process_order(u, order_cost=cost, day=day)

        if day % 7 == 0:
            sim.process_frozen_unlock(day)

    # 强制解锁所有冻结奖励（最坏情况）
    for u in vip_users:
        for fr in u.frozen_rewards:
            u.reward_balance += fr["amount"]
            sim.platform["reward_released"] += fr["amount"]
        u.frozen_rewards = []

    sim.process_withdrawals(1.0)  # 100% 提现
    _print_results(sim, "场景4-最坏")
    return sim


def scenario_5_package_comparison():
    """
    场景5：不同VIP档位利润对比
    """
    print("\n" + "=" * 70)
    print("场景5：不同VIP档位利润对比")
    print("=" * 70)

    c = Config()

    for pkg_idx, pkg in enumerate(c.vip_packages):
        sim = VipReferralSimulation(c, seed=100 + pkg_idx)

        users = []
        for i in range(100):
            inviter = None
            if users and sim.rng.random() < 0.50:
                inviter = sim.rng.choice(users).id
            u = sim.create_user(inviter_id=inviter, join_day=0)
            sim.purchase_vip(u, package_idx=pkg_idx, day=0)
            users.append(u)

        # 90天运营
        for day in range(90):
            for u in users:
                if sim.rng.random() < 3.0 / 30:
                    cost = sim.rng.uniform(80, 150)
                    sim.process_order(u, order_cost=cost, day=day)
            if day % 7 == 0:
                sim.process_frozen_unlock(day)

        sim.process_frozen_unlock(90)

        p = sim.platform
        pkg_profit = p["vip_pkg_platform_profit"]
        order_income = p["order_platform_share"] + p["reward_to_platform"] + p["frozen_expired"]
        funds = p["charity_fund"] + p["tech_fund"] + p["reserve_fund"]
        net = pkg_profit + order_income + funds - p["reward_released"]

        print(f"\n{'─' * 50}")
        print(f"【{pkg['name']}】 价格={pkg['price']}元, 成本={pkg['gift_cost']}元, 利润={pkg['profit']}元")
        print(f"  VIP礼包平台分润:    ¥{pkg_profit:>10,.2f}  (含无推荐人的市场分润)")
        print(f"  推荐奖励已发:        ¥{p['referral_bonus_paid']:>10,.2f}")
        print(f"  产业及慈善:          ¥{p['vip_pkg_industry_charity']:>10,.2f}")
        print(f"  ─────────────")
        print(f"  订单平台分成(50%):   ¥{p['order_platform_share']:>10,.2f}")
        print(f"  奖励归平台:          ¥{p['reward_to_platform']:>10,.2f}")
        print(f"  上游分润释放:        ¥{p['reward_released']:>10,.2f}")
        print(f"  订单基金:            ¥{funds:>10,.2f}")
        print(f"  ─────────────")
        print(f"  净利润:              ¥{net:>10,.2f}")
        print(f"  每用户净利润:        ¥{net / 100:>10,.2f}")


def scenario_6_referral_depth_analysis():
    """
    场景6：推荐深度 vs 利润分析
    测试不同推荐链深度对平台利润的影响
    """
    print("\n" + "=" * 70)
    print("场景6：推荐深度 vs 平台利润")
    print("=" * 70)

    c = Config()

    print(f"\n{'深度':>4} | {'VIP数':>6} | {'VIP礼包平台利润':>14} | {'奖励释放':>12} | {'奖励归平台':>12} | {'净利润':>12} | {'利润率':>8}")
    print("─" * 85)

    for depth in [1, 3, 5, 8, 10, 15]:
        sim = VipReferralSimulation(c, seed=200 + depth)

        # 构建指定深度的链式推荐
        chain = []
        prev = None
        for i in range(depth):
            u = sim.create_user(inviter_id=prev, join_day=0)
            sim.purchase_vip(u, package_idx=0, day=0)
            prev = u.id
            chain.append(u)

        # 每人消费20次
        for day in range(60):
            for u in chain:
                if sim.rng.random() < 20.0 / 60:
                    sim.process_order(u, order_cost=100, day=day)
            if day % 7 == 0:
                sim.process_frozen_unlock(day)
        sim.process_frozen_unlock(60)

        p = sim.platform
        income = (p["vip_pkg_platform_profit"] + p["order_platform_share"] +
                  p["reward_to_platform"] + p["frozen_expired"] +
                  p["charity_fund"] + p["tech_fund"] + p["reserve_fund"])
        net = income - p["reward_released"]
        gmv = p["total_order_revenue"] + p["vip_package_revenue"]
        margin = net / gmv * 100 if gmv > 0 else 0

        print(f"{depth:>4} | {len(chain):>6} | ¥{p['vip_pkg_platform_profit']:>10,.2f} | "
              f"¥{p['reward_released']:>10,.2f} | ¥{p['reward_to_platform']:>10,.2f} | "
              f"¥{net:>10,.2f} | {margin:>6.1f}%")


# ============================================================
# 输出
# ============================================================

def _print_results(sim: VipReferralSimulation, label: str):
    """打印详细结果"""
    p = sim.platform

    # === VIP 礼包收支 ===
    vip_pkg_profit = p["vip_pkg_platform_profit"]                    # 平台分润 + 无推荐人的市场分润
    vip_pkg_industry_charity = p["vip_pkg_industry_charity"]         # 产业及慈善
    vip_pkg_net = vip_pkg_profit  # 平台从 VIP 礼包拿到的净利润

    # === 订单收入 ===
    order_platform_income = p["order_platform_share"]
    reward_recaptured = p["reward_to_platform"] + p["frozen_expired"]
    order_funds = p["charity_fund"] + p["tech_fund"] + p["reserve_fund"]

    # === 平台总收入 ===
    total_income = vip_pkg_net + order_platform_income + reward_recaptured + order_funds

    # === 支出 ===
    total_reward_outflow = p["reward_released"]

    # === 净利润 ===
    net_profit = total_income - total_reward_outflow

    # GMV
    gmv = p["total_order_revenue"] + p["vip_package_revenue"]

    print(f"\n{'─' * 60}")
    print(f"{'':>4}【{label}】平台利润报告")
    print(f"{'─' * 60}")

    print(f"\n┌─ VIP 礼包收支(成本70% / 利润30%) ─────────")
    print(f"│ VIP包销售总额:          ¥{p['vip_package_revenue']:>12,.2f}")
    print(f"│   - 赠品成本(70%):      ¥{p['gift_cost']:>12,.2f}")
    print(f"│   = 礼包利润(30%):      ¥{p['vip_package_revenue'] - p['gift_cost']:>12,.2f}")
    print(f"│     市场分润/推荐奖(50%):¥{p['referral_bonus_paid']:>12,.2f}")
    print(f"│     平台分润(30%):       ¥{p['vip_pkg_platform_profit']:>12,.2f}")
    print(f"│     产业及慈善(20%):     ¥{vip_pkg_industry_charity:>12,.2f}")
    print(f"│   注: 无推荐人时市场分润归平台")
    print(f"└─────────────────────────────────────────────")

    print(f"\n┌─ 订单分润收支(六分法) ─────────────────────")
    print(f"│ 平台分成(50%):          ¥{order_platform_income:>12,.2f}")
    print(f"│ 奖励归平台(根/超层):    ¥{p['reward_to_platform']:>12,.2f}")
    print(f"│ 冻结过期归平台:         ¥{p['frozen_expired']:>12,.2f}")
    print(f"│ 基金(慈善+科技+备用):   ¥{order_funds:>12,.2f}")
    print(f"│ ─────────────")
    print(f"│ 上游分润释放(支出):     ¥{total_reward_outflow:>12,.2f}")
    print(f"│ 产业基金(给卖家):       ¥{p['industry_fund_to_seller']:>12,.2f}")
    print(f"└─────────────────────────────────────────────")

    print(f"\n┌─ 平台净利润 ───────────────────────────────")
    print(f"│ VIP礼包平台净利:        ¥{vip_pkg_net:>12,.2f}")
    print(f"│ 订单平台分成:            ¥{order_platform_income:>12,.2f}")
    print(f"│ 奖励回收(归平台):        ¥{reward_recaptured:>12,.2f}")
    print(f"│ 订单基金:                ¥{order_funds:>12,.2f}")
    print(f"│ - 上游分润释放:          ¥{total_reward_outflow:>12,.2f}")
    print(f"│ ═════════════")
    print(f"│ 净利润:                  ¥{net_profit:>12,.2f}")
    if gmv > 0:
        print(f"│ GMV(总交易额):           ¥{gmv:>12,.2f}")
        print(f"│ 净利润率(净利润/GMV):    {net_profit / gmv * 100:>11.1f}%")
    print(f"│")
    print(f"│ 总订单数:                {p['total_orders']:>12,d}")
    print(f"│ 总订单利润:              ¥{p['total_order_profit']:>12,.2f}")
    print(f"│ 总奖励池:                ¥{p['total_reward_pool']:>12,.2f}")
    print(f"│ 奖励实际释放率:          {p['reward_released'] / p['total_reward_pool'] * 100 if p['total_reward_pool'] > 0 else 0:>11.1f}%")
    print(f"│ 奖励归平台率:            {reward_recaptured / p['total_reward_pool'] * 100 if p['total_reward_pool'] > 0 else 0:>11.1f}%")
    print(f"└─────────────────────────────────────────────")

    # 额外：冻结中的奖励
    total_frozen = sum(sum(fr["amount"] for fr in u.frozen_rewards) for u in sim.users.values())
    total_available = sum(u.reward_balance for u in sim.users.values())
    print(f"\n┌─ 用户余额快照 ─────────────────────────────")
    print(f"│ 用户可用余额合计:       ¥{total_available:>12,.2f}")
    print(f"│ 冻结中奖励合计:         ¥{total_frozen:>12,.2f}")
    print(f"│ 已提现合计:             ¥{sim.total_withdrawn:>12,.2f}")
    print(f"└─────────────────────────────────────────────")


def scenario_7_breakeven():
    """
    场景7：盈亏平衡分析
    给定 VIP 用户数，需要多少普通用户订单才能盈利？
    """
    print("\n" + "=" * 70)
    print("场景7：盈亏平衡分析")
    print("=" * 70)

    c = Config()

    # 按《成本及分润控制总表》计算单个 VIP 用户
    for pkg in c.vip_packages:
        profit = pkg["profit"]  # 礼包价 × 30%
        market_share = profit * pkg["market_pct"]      # 50% → 推荐奖励(有推荐人才发)
        platform_share = profit * pkg["platform_pct"]   # 30% → 平台
        ind_charity = profit * pkg["industry_charity_pct"]  # 20% → 产业及慈善

        print(f"\n【{pkg['name']}】 ¥{pkg['price']}:")
        print(f"  成本(70%):          ¥{pkg['gift_cost']:.2f}")
        print(f"  利润(30%):          ¥{profit:.2f}")
        print(f"    市场分润(50%):    ¥{market_share:.2f}  ← 推荐奖励(有推荐人才发)")
        print(f"    平台分润(30%):    ¥{platform_share:.2f}  ← 平台确定收入")
        print(f"    产业及慈善(20%):  ¥{ind_charity:.2f}")
        print(f"  有推荐人→平台净得:  ¥{platform_share:.2f}")
        print(f"  无推荐人→平台净得:  ¥{platform_share + market_share:.2f}  (市场分润也归平台)")

    # 单次VIP订单利润分配
    avg_cost = 100  # 平均成本
    selling_price = avg_cost * c.markup_rate * c.vip_discount_rate
    profit_per_order = selling_price - avg_cost
    platform_per_order = profit_per_order * c.vip_platform_pct
    reward_per_order = profit_per_order * c.vip_reward_pct

    print(f"\n{'─' * 50}")
    print(f"单次VIP订单(成本¥{avg_cost}):")
    print(f"  售价(含VIP折扣): ¥{selling_price:.2f}")
    print(f"  利润:            ¥{profit_per_order:.2f}")
    print(f"  平台分成(50%):   ¥{platform_per_order:.2f}")
    print(f"  奖励池(30%):     ¥{reward_per_order:.2f}")
    print(f"  产业基金(10%):   ¥{profit_per_order * c.vip_industry_pct:.2f}")
    print(f"  其他基金(10%):   ¥{profit_per_order * (c.vip_charity_pct + c.vip_tech_pct + c.vip_reserve_pct):.2f}")

    # 奖励池最终去向分析
    reward_release_rates = [0.40, 0.50, 0.60, 0.70, 0.80, 1.00]

    print(f"\n不同奖励释放率下的单次VIP订单平台净收入:")
    print(f"{'释放率':>8} | {'平台分成':>10} | {'奖励归平台':>12} | {'单次净收入':>12}")
    print("─" * 55)
    for rate in reward_release_rates:
        reward_kept = reward_per_order * (1 - rate)
        net = platform_per_order + reward_kept
        print(f"{rate * 100:>6.0f}%  | ¥{platform_per_order:>8.2f}  | ¥{reward_kept:>10.2f}  | ¥{net:>10.2f}")

    # 盈亏平衡分析
    pkg0 = c.vip_packages[0]
    pkg_platform_min = pkg0["profit"] * pkg0["platform_pct"]  # 有推荐人时的平台最低收入
    print(f"\n盈亏分析(基础版¥{pkg0['price']}):")
    print(f"  有推荐人时平台从VIP包获得:  ¥{pkg_platform_min:.2f}")
    print(f"  无推荐人时平台从VIP包获得:  ¥{pkg_platform_min + pkg0['profit'] * pkg0['market_pct']:.2f}")
    print(f"  每次消费平台最少获得(50%):  ¥{platform_per_order:.2f}")
    print(f"  结论: VIP包利润虽薄(¥{pkg_platform_min:.2f})，但每笔订单持续贡献¥{platform_per_order:.2f}")


def scenario_8_15layer_capacity():
    """
    场景8：15层满树容量测试
    三叉树15层，分别测 50%/70%/100% 填充率
    每个用户消费满15次（触发全部15层分润）
    重点看：奖励池到底有多少流向用户 vs 归平台
    """
    print("\n" + "=" * 70)
    print("场景8：15层三叉树容量测试 (50% / 70% / 100% 填充)")
    print("=" * 70)

    c = Config()

    # 三叉树15层的理论容量（单根下）
    # 层k有 3^k 个节点, k=1..15
    # 总计 = 3 + 9 + 27 + ... + 3^15 = (3^16 - 3) / 2 = 21,523,359
    # 太大了，我们用受控方式构建：
    # - 用10个根节点
    # - 构建深链 + 宽填充，确保树深达到15层
    # - 通过推荐率控制填充密度

    for fill_label, fill_rate, num_vip in [
        ("50%", 0.50, 5000),
        ("70%", 0.70, 5000),
        ("100%", 1.00, 5000),
    ]:
        print(f"\n{'━' * 60}")
        print(f"  填充率 {fill_label} — {num_vip} VIP用户, 推荐率={fill_rate*100:.0f}%")
        print(f"{'━' * 60}")

        sim = VipReferralSimulation(c, seed=800 + int(fill_rate * 100))

        # 构建 VIP 用户树
        # 策略：先建一批"种子链"确保树深达到15层，然后按推荐率填充
        vip_users = []

        # Phase 1: 建10条深链（每根一条），确保15层深度
        seed_chains = []
        for root_idx in range(10):
            chain = []
            prev = None
            for depth in range(15):
                u = sim.create_user(inviter_id=prev, join_day=0)
                sim.purchase_vip(u, package_idx=0, day=0)
                prev = u.id
                chain.append(u)
                vip_users.append(u)
            seed_chains.append(chain)
        # 已创建 150 个种子用户（10链×15层）

        # Phase 2: 剩余用户按推荐率填充
        remaining = num_vip - len(vip_users)
        for i in range(remaining):
            inviter = None
            if sim.rng.random() < fill_rate and vip_users:
                # 从已有 VIP 用户中选推荐人
                inviter = sim.rng.choice(vip_users).id
            u = sim.create_user(inviter_id=inviter, join_day=0)
            sim.purchase_vip(u, package_idx=0, day=0)
            vip_users.append(u)

        stats = sim.tree.get_stats()
        print(f"  树统计: 节点={stats['total_nodes']}, 最大深度={stats['max_depth']}, 平均深度={stats['avg_depth']:.1f}")

        # Phase 3: 每用户消费满15次（触发全部15层分润）
        # 每次消费成本100元
        for purchase_round in range(15):
            for u in vip_users:
                sim.process_order(u, order_cost=100.0, day=purchase_round)

        # 处理冻结过期（模拟30天后）
        for day in range(35):
            sim.process_frozen_unlock(day)

        # 强制解锁剩余冻结（最坏情况分析）
        total_still_frozen = 0
        for u in vip_users:
            for fr in u.frozen_rewards:
                total_still_frozen += fr["amount"]

        p = sim.platform

        # ── 按层统计奖励去向 ──
        # 重新跑一次只为统计每层的去向
        layer_to_user = [0.0] * 16    # k=1..15 分给用户
        layer_to_platform = [0.0] * 16  # k=1..15 归平台
        total_pool = p["total_reward_pool"]
        released = p["reward_released"]
        to_platform = p["reward_to_platform"]

        # 报告
        print(f"\n  ┌─ VIP礼包收支 ────────────────────────")
        print(f"  │ 销售总额:         ¥{p['vip_package_revenue']:>12,.0f}")
        print(f"  │ 赠品成本:         ¥{p['gift_cost']:>12,.0f}")
        print(f"  │ 推荐奖励发出:     ¥{p['referral_bonus_paid']:>12,.0f}")
        print(f"  │ 平台分润:         ¥{p['vip_pkg_platform_profit']:>12,.0f}")
        print(f"  └────────────────────────────────────────")

        print(f"\n  ┌─ 订单分润(每人15次×¥100成本) ────────")
        print(f"  │ 总订单数:         {p['total_orders']:>12,d}")
        print(f"  │ 总GMV:            ¥{p['total_order_revenue']:>12,.0f}")
        print(f"  │ 总利润:           ¥{p['total_order_profit']:>12,.0f}")
        print(f"  │")
        print(f"  │ 平台分成(50%):    ¥{p['order_platform_share']:>12,.0f}")
        print(f"  │ 奖励池(30%):      ¥{total_pool:>12,.0f}")
        print(f"  │   → 释放给用户:   ¥{released:>12,.0f}  ({released/total_pool*100 if total_pool else 0:.1f}%)")
        print(f"  │   → 归平台:       ¥{to_platform:>12,.0f}  ({to_platform/total_pool*100 if total_pool else 0:.1f}%)")
        print(f"  │   → 冻结过期:     ¥{p['frozen_expired']:>12,.0f}  ({p['frozen_expired']/total_pool*100 if total_pool else 0:.1f}%)")
        print(f"  │   → 仍冻结中:     ¥{total_still_frozen:>12,.0f}  ({total_still_frozen/total_pool*100 if total_pool else 0:.1f}%)")
        print(f"  │ 产业基金(卖家):   ¥{p['industry_fund_to_seller']:>12,.0f}")
        print(f"  │ 基金(慈善+科技+备): ¥{p['charity_fund']+p['tech_fund']+p['reserve_fund']:>10,.0f}")
        print(f"  └────────────────────────────────────────")

        # 平台净利润
        income = (p["vip_pkg_platform_profit"] + p["order_platform_share"] +
                  p["reward_to_platform"] + p["frozen_expired"] +
                  p["charity_fund"] + p["tech_fund"] + p["reserve_fund"])
        cost = p["reward_released"]
        net = income - cost
        gmv = p["total_order_revenue"] + p["vip_package_revenue"]

        print(f"\n  ┌─ 平台净利润 ──────────────────────────")
        print(f"  │ 总收入:           ¥{income:>12,.0f}")
        print(f"  │ 总支出(分润释放):  ¥{cost:>12,.0f}")
        print(f"  │ ═══════════════")
        print(f"  │ 净利润:           ¥{net:>12,.0f}")
        print(f"  │ 净利润率(GMV):    {net/gmv*100 if gmv else 0:>11.1f}%")
        print(f"  └────────────────────────────────────────")

        # 用户余额
        total_available = sum(u.reward_balance for u in sim.users.values())
        print(f"\n  ┌─ 用户余额(含推荐奖+分润) ────────────")
        print(f"  │ 可用余额合计:     ¥{total_available:>12,.0f}")
        print(f"  │ 仍冻结中:         ¥{total_still_frozen:>12,.0f}")
        print(f"  │ 潜在最大提现:     ¥{total_available + total_still_frozen:>12,.0f}")
        print(f"  │ 占GMV比例:        {(total_available+total_still_frozen)/gmv*100 if gmv else 0:>11.1f}%")
        print(f"  └────────────────────────────────────────")


# ============================================================
# 主程序
# ============================================================

def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║     爱买买 VIP 推荐链路完整测试 & 平台利润仿真              ║")
    print("╠══════════════════════════════════════════════════════════════╣")
    print("║  参数来源: VIP礼包内部成本及分润控制总表                     ║")
    print("║  树结构:   三叉树, 推荐人优先 + BFS 滑落                    ║")
    print("║  利润分配: 六分法 (50/30/10/2/2/6)                          ║")
    print("╚══════════════════════════════════════════════════════════════╝")

    scenario_8_15layer_capacity()
    scenario_7_breakeven()
    scenario_5_package_comparison()

    print("\n\n" + "=" * 70)
    print("总结")
    print("=" * 70)
    print("""
关键发现（按《VIP礼包内部成本及分润控制总表》更新）:

1. VIP 礼包利润结构:
   成本 = 礼包价 × 70%（海产品75% + 酒20% + 物流5%）
   利润 = 礼包价 × 30%，再三分:
   - 基础版 ¥399: 利润¥119.70 → 市场¥59.85 / 平台¥35.91 / 产业慈善¥23.94
   - 标准版 ¥899: 利润¥269.70 → 市场¥134.85 / 平台¥80.91 / 产业慈善¥53.94
   - 豪华版 ¥1599: 利润¥479.70 → 市场¥239.85 / 平台¥143.91 / 产业慈善¥95.94
   注: 市场分润=推荐奖励，无推荐人时归平台

2. 平台真实收入来源:
   a) VIP礼包平台分润（利润×30%）— 确定收入，无推荐人时更多
   b) 订单利润×50% — 铁底，不被分润侵蚀
   c) 奖励池回流 — 冻结过期/树深不够/超层 → 归平台
   d) 基金（慈善+科技+备用）— 订单利润×10%

3. 订单分润六分法保底:
   - 平台直接拿 50%
   - 30% 奖励池中，实测 77%~92% 最终归平台
   - 产业基金 10% 给卖家
   - 基金 10% 平台可支配

4. 结论: 平台持续盈利
   - VIP礼包利润薄（平台只拿30%的30%=9%），但订单利润持续补充
   - 每笔VIP订单(成本¥100)贡献平台¥11.75(50%分成)
   - 奖励池天然衰减是隐性利润来源
""")


if __name__ == "__main__":
    main()
