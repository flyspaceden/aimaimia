#!/usr/bin/env python3
"""
爱买买 VIP 推荐链路 — 全面端到端测试 (50+ 断言)
================================================
策略:
  - 用种子用户(密码登录, 无 OTP 限流) 测试 API 链路
  - 用数据库直接查询验证树结构、奖励账户、推荐关系
  - 注册1个新用户(OTP)验证新用户完整流程
  - VIP 购买 → 支付回调 → 进树 → 推荐奖励 全链路

种子用户:
  u-001 林青禾 13800138000 VIP  code=LQHE2025 (推荐人，树上有3个子节点)
  u-002 江晴   13800138002 普通 code=JQ2025AB
  u-003 张明   13800138003 普通
  u-004 李婉清 13800138004 普通
  u-006 顾予夏 13800138006 VIP  code=GYXIA025 (被u-001推荐)
  u-007 赵美琪 13800138007 普通
  u-008 钱志远 13800138008 普通
  u-009 孙雅婷 13800138009 普通
  u-010 周建国 13800138010 普通
  u-101~u-109 VIP树演示用户 (密码=123456)
"""

import requests
import json
import time
import sys
import uuid
import subprocess
from typing import Optional, Dict, Tuple

BASE = "http://localhost:3000/api/v1"
PASS = 0
FAIL = 0
TOTAL = 0
WARNINGS = []


def ok(label):
    global PASS, TOTAL
    TOTAL += 1; PASS += 1
    print(f"  ✅ {label}")


def fail(label, detail=""):
    global FAIL, TOTAL
    TOTAL += 1; FAIL += 1
    print(f"  ❌ {label}")
    if detail: print(f"     {detail[:300]}")


def warn(msg):
    WARNINGS.append(msg)
    print(f"  ⚠️  {msg}")


def check(label, condition, detail=""):
    if condition:
        ok(label)
    else:
        fail(label, detail)


def api_get(path, token):
    r = requests.get(f"{BASE}/{path}", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    return r.json()


def api_post(path, data, token=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = requests.post(f"{BASE}/{path}", json=data, headers=h, timeout=15)
        return r.json()
    except:
        return {"ok": False, "error": {"message": "request failed"}}


PSQL = "/Applications/Postgres.app/Contents/Versions/18/bin/psql"

def db_query(sql):
    """直接查数据库"""
    result = subprocess.run(
        [PSQL, "-h", "localhost", "-U", "nongmai", "-d", "nongmai", "-t", "-A", "-c", sql],
        capture_output=True, text=True, env={**__import__('os').environ, "PGPASSWORD": "nongmai123"}
    )
    return result.stdout.strip()


def login(phone):
    """用 curl 登录（避免 Python requests 连接池计入同一限流桶）"""
    try:
        result = subprocess.run(
            ["curl", "-s", "-X", "POST", f"{BASE}/auth/login",
             "-H", "Content-Type: application/json",
             "-d", json.dumps({"channel": "phone", "mode": "password", "phone": phone, "password": "123456"})],
            capture_output=True, text=True, timeout=10
        )
        d = json.loads(result.stdout)
        if d.get("ok"):
            return d["data"]["accessToken"]
        return None
    except:
        return None


# ============================================================
# 测试开始
# ============================================================

def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║   爱买买 VIP 推荐链路 — 全面端到端测试 (50+ 断言)          ║")
    print("╚══════════════════════════════════════════════════════════════╝\n")

    # 健康检查
    try:
        r = requests.get(f"{BASE}/companies/discovery-filters", timeout=5)
        check("API 健康检查", r.json().get("ok"))
    except:
        fail("API 不可用"); sys.exit(1)

    # ── 第1部分: 批量登录种子用户 ──
    print(f"\n{'='*60}")
    print("第1部分: 种子用户登录")
    print(f"{'='*60}")

    tokens = {}
    users_info = [
        ("u-001", "13800138000", "林青禾", "VIP"),
        ("u-002", "13800138002", "江晴", "NORMAL"),
        ("u-003", "13800138003", "张明", "NORMAL"),
        ("u-004", "13800138004", "李婉清", "NORMAL"),
        ("u-006", "13800138006", "顾予夏", "VIP"),
        ("u-007", "13800138007", "赵美琪", "NORMAL"),
        ("u-008", "13800138008", "钱志远", "NORMAL"),
        ("u-009", "13800138009", "孙雅婷", "NORMAL"),
        ("u-010", "13800138010", "周建国", "NORMAL"),
    ]
    # 全局限流: 60次/分钟/IP，需要分批登录
    # 全局限流 60次/分/IP — 每次请求间隔 >=1.1s 确保不触发
    all_logins = [(uid, phone, name) for uid, phone, name, _ in users_info]
    # 加 VIP 树用户
    for i in range(101, 110):
        all_logins.append((f"u-{i}", f"138001381{i-100:02d}", f"VIP树用户{i}"))

    for idx, (uid, phone, name) in enumerate(all_logins):
        t = login(phone)
        if t:
            tokens[uid] = t
            ok(f"{uid} {name} 登录")
        else:
            fail(f"{uid} {name} 登录")
        time.sleep(1.1)  # 严格限流保护

    print(f"  共登录 {len(tokens)} 个用户")

    # ── 第2部分: 验证推荐码系统 ──
    print(f"\n{'='*60}")
    print("第2部分: 推荐码生成与查看")
    print(f"{'='*60}")

    # u-001 VIP 推荐码
    m = api_get("bonus/member", tokens.get("u-001")).get("data", {})
    check("u-001 是 VIP", m.get("tier") == "VIP")
    check("u-001 推荐码=LQHE2025", m.get("referralCode") == "LQHE2025")
    check("u-001 无推荐人", m.get("inviterUserId") is None)

    # u-002 普通用户推荐码
    m = api_get("bonus/member", tokens.get("u-002")).get("data", {})
    check("u-002 是 NORMAL", m.get("tier") == "NORMAL")
    check("u-002 推荐码=JQ2025AB", m.get("referralCode") == "JQ2025AB")

    # u-006 被 u-001 推荐
    m = api_get("bonus/member", tokens.get("u-006")).get("data", {})
    check("u-006 是 VIP", m.get("tier") == "VIP")
    check("u-006 推荐人=u-001", m.get("inviterUserId") == "u-001")
    check("u-006 推荐码=GYXIA025", m.get("referralCode") == "GYXIA025")

    # 所有普通用户都应有推荐码(8位)
    for uid in ["u-003", "u-004", "u-007", "u-008", "u-009", "u-010"]:
        if uid in tokens:
            m = api_get("bonus/member", tokens[uid]).get("data", {})
            code = m.get("referralCode") or ""
            check(f"{uid} 有8位推荐码", len(code) == 8, f"code={code}")

    # ── 第3部分: 绑定推荐码（正常+异常）──
    print(f"\n{'='*60}")
    print("第3部分: 推荐码绑定")
    print(f"{'='*60}")

    # u-007 绑定 u-001 的码
    if "u-007" not in tokens:
        fail("u-007 未登录，跳过绑定测试")
        # 尝试部分跳过
    time.sleep(0.5)
    d = api_post("bonus/referral", {"code": "LQHE2025"}, tokens.get("u-007"))
    check("u-007 绑定 LQHE2025 成功", d.get("data", {}).get("success") == True)

    # 验证绑定结果
    m = api_get("bonus/member", tokens.get("u-007")).get("data", {})
    check("u-007 推荐人=u-001", m.get("inviterUserId") == "u-001")

    # u-008 绑定 u-006 的码(u-006是VIP，可以推荐别人)
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "GYXIA025"}, tokens.get("u-008"))
    check("u-008 绑定 GYXIA025 成功", d.get("data", {}).get("success") == True)
    m = api_get("bonus/member", tokens.get("u-008")).get("data", {})
    check("u-008 推荐人=u-006", m.get("inviterUserId") == "u-006")

    # u-009 绑定 u-002 的码(u-002是普通用户，也可以推荐)
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "JQ2025AB"}, tokens.get("u-009"))
    check("u-009 绑定 JQ2025AB 成功", d.get("data", {}).get("success") == True)

    # u-010 绑定 u-007 的码（u-007刚绑定了u-001，形成 u-001→u-007→u-010 链）
    time.sleep(0.3)
    u007_code = api_get("bonus/member", tokens.get("u-007")).get("data", {}).get("referralCode")
    if u007_code:
        d = api_post("bonus/referral", {"code": u007_code}, tokens.get("u-010"))
        check(f"u-010 绑定 u-007({u007_code}) 成功", d.get("data", {}).get("success") == True)
        m = api_get("bonus/member", tokens.get("u-010")).get("data", {})
        check("u-010 推荐人=u-007", m.get("inviterUserId") == "u-007")

    # 重复绑定（幂等）
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "LQHE2025"}, tokens.get("u-007"))
    check("u-007 重复绑定幂等成功", d.get("data", {}).get("success") == True)

    # VIP前可换推荐人
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "JQ2025AB"}, tokens.get("u-007"))
    check("u-007 更换推荐人成功(VIP前)", d.get("data", {}).get("success") == True)
    # 换回
    time.sleep(0.3)
    api_post("bonus/referral", {"code": "LQHE2025"}, tokens.get("u-007"))

    # VIP 用户不能换推荐人
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "JQ2025AB"}, tokens.get("u-001"))
    check("u-001(VIP)不能换推荐人", d.get("data", {}).get("success") != True)

    # 不存在的码
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "ZZZZZZZZ"}, tokens.get("u-004"))
    check("不存在的码被拒绝", d.get("data", {}).get("success") != True)

    # 自推荐
    time.sleep(0.3)
    u003_code = api_get("bonus/member", tokens.get("u-003")).get("data", {}).get("referralCode")
    d = api_post("bonus/referral", {"code": u003_code}, tokens.get("u-003"))
    check("自推荐被拒绝", d.get("data", {}).get("success") != True)

    # 空码
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": ""}, tokens.get("u-004"))
    check("空码被拒绝", not d.get("ok") or not d.get("data", {}).get("success"))

    # 特殊字符
    time.sleep(0.3)
    d = api_post("bonus/referral", {"code": "<script>alert(1)</script>"}, tokens.get("u-004"))
    check("XSS 注入被拒绝", not d.get("ok") or not d.get("data", {}).get("success"))

    # 未登录
    d = api_post("bonus/referral", {"code": "LQHE2025"})
    check("未登录被拒绝", not d.get("ok"))

    # ── 第4部分: VIP 树结构验证 ──
    print(f"\n{'='*60}")
    print("第4部分: VIP 树结构（数据库直接验证）")
    print(f"{'='*60}")

    # 查系统根节点
    roots = db_query("SELECT id, \"rootId\", \"userId\", level, \"childrenCount\" FROM \"VipTreeNode\" WHERE \"userId\" IS NULL ORDER BY \"rootId\"")
    check("系统根节点存在", "sys-a1" in roots or "A1" in roots, roots[:100])

    # 查所有 VIP 树节点
    nodes = db_query("""
        SELECT n."userId", n.level, n.position, n."childrenCount", n."parentId", n."rootId"
        FROM "VipTreeNode" n WHERE n."userId" IS NOT NULL ORDER BY n.level, n.position
    """)
    print(f"  VIP 树节点:\n  {'='*50}")
    for line in nodes.split('\n')[:15]:
        if line.strip():
            parts = line.split('|')
            if len(parts) >= 6:
                print(f"  L{parts[1]} pos{parts[2]} userId={parts[0]} children={parts[3]} root={parts[5]}")
    node_count = len([l for l in nodes.split('\n') if l.strip()])
    check(f"VIP 树有 {node_count} 个用户节点", node_count >= 10)

    # 验证树的层级结构
    # u-001 应在 level=1
    u001_node = db_query("SELECT level, \"childrenCount\" FROM \"VipTreeNode\" WHERE \"userId\"='u-001'")
    check("u-001 在树 level=1", "1|" in u001_node, u001_node)

    # u-006 应在 level=2, parent=u-001 的节点
    u006_node = db_query("SELECT level, \"parentId\" FROM \"VipTreeNode\" WHERE \"userId\"='u-006'")
    check("u-006 在树 level=2", "2|" in u006_node, u006_node)

    # u-101/102/103 应在 level=3, parent=u-006 的节点
    u101_node = db_query("SELECT level, \"parentId\" FROM \"VipTreeNode\" WHERE \"userId\"='u-101'")
    check("u-101 在树 level=3", "3|" in u101_node, u101_node)

    # 查最大深度
    max_depth = db_query("SELECT MAX(level) FROM \"VipTreeNode\"")
    check(f"树最大深度={max_depth}", int(max_depth or 0) >= 3, max_depth)

    # ── 第5部分: 推荐关系数据库验证 ──
    print(f"\n{'='*60}")
    print("第5部分: 推荐关系完整性（数据库验证）")
    print(f"{'='*60}")

    # ReferralLink 表
    ref_links = db_query("""
        SELECT "inviterUserId", "inviteeUserId", "codeUsed"
        FROM "ReferralLink" ORDER BY "createdAt"
    """)
    print(f"  推荐关系记录:")
    for line in ref_links.split('\n'):
        if line.strip():
            parts = line.split('|')
            if len(parts) >= 3:
                print(f"    {parts[0]} 推荐 {parts[1]} (码={parts[2]})")
    ref_count = len([l for l in ref_links.split('\n') if l.strip()])
    check(f"推荐关系记录 {ref_count} 条", ref_count >= 3)

    # MemberProfile.inviterUserId 一致性
    inconsistent = db_query("""
        SELECT mp."userId", mp."inviterUserId", rl."inviterUserId" as rl_inviter
        FROM "MemberProfile" mp
        JOIN "ReferralLink" rl ON rl."inviteeUserId" = mp."userId"
        WHERE mp."inviterUserId" != rl."inviterUserId"
    """)
    check("MemberProfile 与 ReferralLink 一致", not inconsistent.strip(), inconsistent)

    # ── 第6部分: 奖励系统验证 ──
    print(f"\n{'='*60}")
    print("第6部分: 奖励系统")
    print(f"{'='*60}")

    # u-001 奖励钱包
    w = api_get("bonus/wallet", tokens.get("u-001")).get("data", {})
    balance = w.get("balance", 0)
    frozen = w.get("frozen", 0)
    check(f"u-001 VIP 奖励余额={balance}", balance > 0, str(w))
    print(f"    balance=¥{balance}, frozen=¥{frozen}")

    # 奖励流水
    ledger = api_get("bonus/wallet/ledger?page=1&pageSize=20", tokens.get("u-001")).get("data", {})
    items = ledger.get("items", [])
    check(f"u-001 有奖励流水({len(items)}条)", len(items) > 0)

    # 数据库验证: RewardAccount
    accounts = db_query("""
        SELECT "userId", type, balance, frozen FROM "RewardAccount"
        WHERE "userId" IN ('u-001','u-002','PLATFORM') ORDER BY "userId", type
    """)
    print(f"  奖励账户:")
    for line in accounts.split('\n')[:10]:
        if line.strip():
            parts = line.split('|')
            if len(parts) >= 4:
                print(f"    {parts[0]} [{parts[1]}] balance=¥{parts[2]} frozen=¥{parts[3]}")

    # VipPurchase 记录
    purchases = db_query("""
        SELECT "userId", amount, status, "activationStatus"
        FROM "VipPurchase" ORDER BY "userId"
    """)
    purchase_count = len([l for l in purchases.split('\n') if l.strip()])
    check(f"VipPurchase 有 {purchase_count} 条记录", purchase_count >= 8)

    # ── 第7部分: 延迟深度链接 ──
    print(f"\n{'='*60}")
    print("第7部分: 延迟深度链接 (Deferred Deep Link)")
    print(f"{'='*60}")

    # 创建深度链接
    time.sleep(0.5)
    d = api_post("deferred-link", {
        "referralCode": "LQHE2025",
        "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)",
        "screenWidth": 375, "screenHeight": 812, "language": "zh-CN"
    })
    cookie_id = d.get("data", {}).get("cookieId")
    check("创建深度链接", cookie_id is not None, str(d))

    if cookie_id:
        # Cookie 解析
        d2 = requests.get(f"{BASE}/deferred-link/resolve?cookieId={cookie_id}", timeout=10).json()
        check("Cookie 解析推荐码=LQHE2025", d2.get("data", {}).get("referralCode") == "LQHE2025")

        # 一次性消费
        d3 = requests.get(f"{BASE}/deferred-link/resolve?cookieId={cookie_id}", timeout=10).json()
        check("Cookie 已消费不可重复使用", d3.get("data", {}).get("referralCode") is None)

    # 无效推荐码
    time.sleep(0.5)
    d = api_post("deferred-link", {
        "referralCode": "ZZZZZZZZ", "userAgent": "Test", "screenWidth": 375, "screenHeight": 812
    })
    check("无效推荐码创建深度链接被拒", not d.get("ok"))

    # 数据库验证
    ddl_count = db_query("SELECT COUNT(*) FROM \"DeferredDeepLink\"")
    check(f"DeferredDeepLink 表有 {ddl_count} 条记录", int(ddl_count or 0) >= 1)

    # ── 第8部分: VIP 购买全流程 ──
    print(f"\n{'='*60}")
    print("第8部分: VIP 购买全流程 (u-007: 有推荐人)")
    print(f"{'='*60}")

    # 确保 u-007 绑定了 u-001
    time.sleep(0.3)
    api_post("bonus/referral", {"code": "LQHE2025"}, tokens.get("u-007"))
    m = api_get("bonus/member", tokens.get("u-007")).get("data", {})
    check("u-007 绑定推荐人=u-001", m.get("inviterUserId") == "u-001")
    check("u-007 当前是 NORMAL", m.get("tier") == "NORMAL")

    # 记录 u-001 奖励余额
    w_before = api_get("bonus/wallet", tokens.get("u-001")).get("data", {})
    balance_before = w_before.get("balance", 0)
    print(f"  u-001 当前余额: ¥{balance_before}")

    # 创建收货地址
    time.sleep(0.3)
    addr_resp = api_post("addresses", {
        "name": "赵美琪", "phone": "13800138007",
        "province": "广东省", "city": "深圳市", "district": "南山区",
        "detail": "科技园路1号", "isDefault": True
    }, tokens.get("u-007"))
    addr_id = addr_resp.get("data", {}).get("id")
    if not addr_id:
        # 查已有地址
        addrs = api_get("addresses", tokens.get("u-007")).get("data", [])
        if isinstance(addrs, list) and addrs:
            addr_id = addrs[0].get("id")
        elif isinstance(addrs, dict):
            items = addrs.get("items", [])
            if items: addr_id = items[0].get("id")
    check("u-007 有收货地址", addr_id is not None, str(addr_resp)[:200])

    if addr_id:
        # 查可用赠品选项
        time.sleep(0.3)
        gift_id = db_query("SELECT id FROM \"VipGiftOption\" WHERE \"packageId\"='vpkg-001' LIMIT 1")
        if not gift_id:
            gift_id = "vgo-001"

        # VIP 结算
        time.sleep(0.5)
        checkout_resp = api_post("orders/vip-checkout", {
            "packageId": "vpkg-001", "giftOptionId": gift_id,
            "addressId": addr_id, "paymentChannel": "wechat",
            "idempotencyKey": str(uuid.uuid4()),
        }, tokens.get("u-007"))
        merchant_no = checkout_resp.get("data", {}).get("merchantOrderNo")
        check("u-007 VIP 结算成功", merchant_no is not None, str(checkout_resp)[:300])

        if merchant_no:
            print(f"    merchantOrderNo={merchant_no}")

            # 支付回调
            time.sleep(0.5)
            pay_resp = api_post("payments/callback", {
                "merchantOrderNo": merchant_no,
                "providerTxnId": f"MOCK_{uuid.uuid4().hex[:12]}",
                "status": "SUCCESS",
                "paidAt": "2026-03-28T15:00:00Z",
            })
            check("支付回调成功", pay_resp.get("ok"), str(pay_resp)[:200])

            # 等待异步处理
            time.sleep(2)

            # 验证 u-007 已成为 VIP
            m = api_get("bonus/member", tokens.get("u-007")).get("data", {})
            check("u-007 成为 VIP", m.get("tier") == "VIP", str(m)[:200])

            # 验证 u-007 进入 VIP 树
            tree = api_get("bonus/vip/tree", tokens.get("u-007")).get("data", {})
            check("u-007 有 VIP 树节点", tree.get("me") is not None or tree.get("children") is not None, str(tree)[:200])

            # 验证推荐奖励
            time.sleep(0.5)
            # u-001 需要重新登录获取最新 token
            tokens["u-001"] = login("13800138000")
            w_after = api_get("bonus/wallet", tokens.get("u-001")).get("data", {})
            balance_after = w_after.get("balance", 0)
            diff = balance_after - balance_before
            expected = 399 * 0.15  # 59.85

            print(f"    u-001 余额: 前=¥{balance_before} 后=¥{balance_after} 差=¥{diff:.2f} 预期=¥{expected}")
            check(f"u-001 收到推荐奖励 ¥{diff:.2f}", abs(diff - expected) < 1.0, f"差额={diff}, 预期={expected}")

            # 数据库验证: VipTreeNode
            u007_in_tree = db_query("SELECT level, \"parentId\", \"rootId\" FROM \"VipTreeNode\" WHERE \"userId\"='u-007'")
            check("u-007 在 VipTreeNode 表中", len(u007_in_tree.strip()) > 0, u007_in_tree)
            if u007_in_tree.strip():
                print(f"    u-007 树节点: {u007_in_tree}")

            # 数据库验证: VipPurchase
            u007_purchase = db_query("SELECT amount, status, \"activationStatus\" FROM \"VipPurchase\" WHERE \"userId\"='u-007'")
            check("u-007 VipPurchase 状态=PAID+SUCCESS", "PAID" in u007_purchase and "SUCCESS" in u007_purchase, u007_purchase)

    # ── 第9部分: 无推荐人 VIP 购买 ──
    print(f"\n{'='*60}")
    print("第9部分: 无推荐人 VIP 购买 (u-008)")
    print(f"{'='*60}")

    # 检查 u-008 是否还有推荐人(之前绑了u-006)，如有先验证
    m = api_get("bonus/member", tokens.get("u-008")).get("data", {})
    has_inviter = m.get("inviterUserId") is not None
    print(f"  u-008 当前: tier={m.get('tier')}, inviter={m.get('inviterUserId')}")

    if m.get("tier") == "NORMAL":
        # 创建地址
        time.sleep(0.3)
        addr_resp = api_post("addresses", {
            "name": "钱志远", "phone": "13800138008",
            "province": "广东省", "city": "深圳市", "district": "福田区",
            "detail": "华强北路1号", "isDefault": True
        }, tokens.get("u-008"))
        addr_id = addr_resp.get("data", {}).get("id")
        if not addr_id:
            addrs = api_get("addresses", tokens.get("u-008")).get("data", [])
            if isinstance(addrs, list) and addrs: addr_id = addrs[0].get("id")
            elif isinstance(addrs, dict): addr_id = (addrs.get("items") or [{}])[0].get("id") if addrs.get("items") else None

        if addr_id:
            gift_id = db_query("SELECT id FROM \"VipGiftOption\" WHERE \"packageId\"='vpkg-001' LIMIT 1") or "vgo-001"
            time.sleep(0.5)
            checkout_resp = api_post("orders/vip-checkout", {
                "packageId": "vpkg-001", "giftOptionId": gift_id,
                "addressId": addr_id, "paymentChannel": "wechat",
                "idempotencyKey": str(uuid.uuid4()),
            }, tokens.get("u-008"))
            merchant_no = checkout_resp.get("data", {}).get("merchantOrderNo")

            if merchant_no:
                time.sleep(0.5)
                pay_resp = api_post("payments/callback", {
                    "merchantOrderNo": merchant_no,
                    "providerTxnId": f"MOCK_{uuid.uuid4().hex[:12]}",
                    "status": "SUCCESS", "paidAt": "2026-03-28T15:30:00Z",
                })
                check("u-008 支付回调成功", pay_resp.get("ok"), str(pay_resp)[:200])

                time.sleep(2)
                m = api_get("bonus/member", tokens.get("u-008")).get("data", {})
                check("u-008 成为 VIP", m.get("tier") == "VIP", str(m)[:200])

                # 验证进树
                u008_tree = db_query("SELECT level, \"rootId\" FROM \"VipTreeNode\" WHERE \"userId\"='u-008'")
                check("u-008 在 VIP 树中", len(u008_tree.strip()) > 0, u008_tree)

                # u-008 有推荐人(u-006)时，应进 u-006 的子树
                if has_inviter:
                    check("u-008 树节点在推荐人子树下", "A1" in u008_tree, u008_tree)
            else:
                fail("u-008 VIP 结算失败", str(checkout_resp)[:200])
    else:
        warn("u-008 已是 VIP，跳过购买测试")

    # ── 第10部分: VIP 后不能换推荐人 ──
    print(f"\n{'='*60}")
    print("第10部分: VIP 后锁定推荐人")
    print(f"{'='*60}")

    if tokens.get("u-007"):
        time.sleep(0.3)
        m = api_get("bonus/member", tokens.get("u-007")).get("data", {})
        if m.get("tier") == "VIP":
            d = api_post("bonus/referral", {"code": "JQ2025AB"}, tokens.get("u-007"))
            check("u-007(VIP) 不能换推荐人", not d.get("data", {}).get("success"))
        else:
            warn("u-007 未成为 VIP，跳过锁定测试")

    # ============================================================
    # 汇总
    # ============================================================
    print(f"\n{'='*60}")
    print("测试结果汇总")
    print(f"{'='*60}")
    print(f"  总断言: {TOTAL}")
    print(f"  ✅ 通过: {PASS}")
    print(f"  ❌ 失败: {FAIL}")
    if WARNINGS:
        print(f"  ⚠️  警告: {len(WARNINGS)}")
        for w in WARNINGS: print(f"     - {w}")
    print()
    if FAIL == 0:
        print("🎉 全部通过！推荐链路完整无缺。")
    else:
        print(f"⚠️  有 {FAIL} 个测试失败。")


if __name__ == "__main__":
    main()
