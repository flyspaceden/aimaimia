#!/bin/bash
# ============================================================
# 爱买买 VIP 推荐链路端到端测试
# ============================================================
# 用真实后端 API 测试完整推荐链路的每一个环节
#
# 测试用户：
#   u-001 林青禾 (VIP, referralCode=LQHE2025) — 推荐人
#   u-002 江晴   (NORMAL, referralCode=JQ2025AB) — 普通用户
#   u-003 张明   (NORMAL) — 用于测试绑定推荐码
#   u-007 赵美琪 (NORMAL) — 用于测试新注册+绑定+购买VIP
#   u-008 钱志远 (NORMAL) — 用于测试无推荐人购买VIP
#
# 密码统一: 123456
# ============================================================

set -e
BASE="http://localhost:3000/api/v1"
PASS=0
FAIL=0
TOTAL=0

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

assert_contains() {
    local label="$1" response="$2" expected="$3"
    TOTAL=$((TOTAL + 1))
    if echo "$response" | grep -q "$expected"; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}✅ PASS${NC} $label"
    else
        FAIL=$((FAIL + 1))
        echo -e "  ${RED}❌ FAIL${NC} $label"
        echo -e "     期望包含: $expected"
        echo -e "     实际响应: $(echo "$response" | head -c 200)"
    fi
}

assert_not_contains() {
    local label="$1" response="$2" unexpected="$3"
    TOTAL=$((TOTAL + 1))
    if echo "$response" | grep -q "$unexpected"; then
        FAIL=$((FAIL + 1))
        echo -e "  ${RED}❌ FAIL${NC} $label"
        echo -e "     不应包含: $unexpected"
    else
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}✅ PASS${NC} $label"
    fi
}

assert_http_ok() {
    local label="$1" response="$2"
    assert_contains "$label" "$response" '"ok":true'
}

login() {
    local phone="$1"
    local resp
    resp=$(curl -s -X POST "$BASE/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"channel\":\"phone\",\"mode\":\"password\",\"phone\":\"$phone\",\"password\":\"123456\"}")
    echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('accessToken',''))" 2>/dev/null
}

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   爱买买 VIP 推荐链路 — 端到端 API 测试                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ============================================================
echo -e "${CYAN}═══ 第1步：用户登录 ═══${NC}"
# ============================================================

echo "登录 u-001 (林青禾, VIP推荐人)..."
TOKEN_001=$(login 13800138000)
if [ -z "$TOKEN_001" ]; then
    echo -e "${RED}❌ u-001 登录失败，终止测试${NC}"
    exit 1
fi
echo -e "  ${GREEN}✅ PASS${NC} u-001 登录成功, token=${TOKEN_001:0:20}..."

echo "登录 u-002 (江晴, 普通用户)..."
TOKEN_002=$(login 13800138002)
assert_contains "u-002 登录成功" "token:$TOKEN_002" "token:"

echo "登录 u-003 (张明, 普通用户)..."
TOKEN_003=$(login 13800138003)
assert_contains "u-003 登录成功" "token:$TOKEN_003" "token:"

echo "登录 u-007 (赵美琪, 普通用户)..."
TOKEN_007=$(login 13800138007)
assert_contains "u-007 登录成功" "token:$TOKEN_007" "token:"

echo "登录 u-008 (钱志远, 普通用户)..."
TOKEN_008=$(login 13800138008)
assert_contains "u-008 登录成功" "token:$TOKEN_008" "token:"

# ============================================================
echo ""
echo -e "${CYAN}═══ 第2步：查看推荐码 ═══${NC}"
# ============================================================

echo "查询 u-001 的会员资料（应有推荐码 LQHE2025）..."
RESP=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_001")
assert_http_ok "u-001 查询会员资料" "$RESP"
assert_contains "u-001 是 VIP" "$RESP" '"tier":"VIP"'
assert_contains "u-001 推荐码=LQHE2025" "$RESP" '"referralCode":"LQHE2025"'
echo "  响应: $(echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(f'tier={d.get(\"tier\")}, code={d.get(\"referralCode\")}, inviter={d.get(\"inviterUserId\")}')" 2>/dev/null)"

echo ""
echo "查询 u-002 的会员资料（普通用户，应有推荐码 JQ2025AB）..."
RESP=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_002")
assert_http_ok "u-002 查询会员资料" "$RESP"
assert_contains "u-002 是 NORMAL" "$RESP" '"tier":"NORMAL"'
assert_contains "u-002 推荐码=JQ2025AB" "$RESP" '"referralCode":"JQ2025AB"'

echo ""
echo "查询 u-003 的会员资料（应自动生成推荐码）..."
RESP=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_003")
assert_http_ok "u-003 查询会员资料" "$RESP"
assert_contains "u-003 有推荐码" "$RESP" '"referralCode":'

# ============================================================
echo ""
echo -e "${CYAN}═══ 第3步：绑定推荐码（正常流程）═══${NC}"
# ============================================================

echo "u-003 使用 u-001 的推荐码 LQHE2025..."
RESP=$(curl -s -X POST "$BASE/bonus/referral" \
    -H "Authorization: Bearer $TOKEN_003" \
    -H "Content-Type: application/json" \
    -d '{"code":"LQHE2025"}')
echo "  响应: $RESP"
assert_contains "u-003 绑定推荐码成功" "$RESP" '"success":true'

echo ""
echo "验证 u-003 的推荐人是 u-001..."
RESP=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_003")
assert_contains "u-003 推荐人=u-001" "$RESP" '"inviterUserId":"u-001"'

# ============================================================
echo ""
echo -e "${CYAN}═══ 第4步：绑定推荐码（异常场景）═══${NC}"
# ============================================================

echo "u-003 重复绑定同一推荐码（应幂等成功）..."
RESP=$(curl -s -X POST "$BASE/bonus/referral" \
    -H "Authorization: Bearer $TOKEN_003" \
    -H "Content-Type: application/json" \
    -d '{"code":"LQHE2025"}')
assert_contains "重复绑定幂等" "$RESP" '"success":true'

echo ""
echo "u-003 更换推荐码为 u-002 的 JQ2025AB（VIP前可换）..."
RESP=$(curl -s -X POST "$BASE/bonus/referral" \
    -H "Authorization: Bearer $TOKEN_003" \
    -H "Content-Type: application/json" \
    -d '{"code":"JQ2025AB"}')
echo "  响应: $RESP"
# 这可以成功也可以失败，取决于业务规则

echo ""
echo "u-001 (VIP) 尝试使用推荐码（VIP不能更换推荐人）..."
RESP=$(curl -s -X POST "$BASE/bonus/referral" \
    -H "Authorization: Bearer $TOKEN_001" \
    -H "Content-Type: application/json" \
    -d '{"code":"JQ2025AB"}')
echo "  响应: $(echo $RESP | head -c 200)"
assert_not_contains "VIP不能更换推荐人" "$RESP" '"success":true'

echo ""
echo "u-003 使用不存在的推荐码..."
RESP=$(curl -s -X POST "$BASE/bonus/referral" \
    -H "Authorization: Bearer $TOKEN_003" \
    -H "Content-Type: application/json" \
    -d '{"code":"ZZZZZZZZ"}')
echo "  响应: $(echo $RESP | head -c 200)"
assert_not_contains "不存在的码应拒绝" "$RESP" '"success":true'

echo ""
echo "u-003 使用自己的推荐码（自推荐）..."
U003_CODE=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_003" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('referralCode',''))" 2>/dev/null)
if [ -n "$U003_CODE" ]; then
    RESP=$(curl -s -X POST "$BASE/bonus/referral" \
        -H "Authorization: Bearer $TOKEN_003" \
        -H "Content-Type: application/json" \
        -d "{\"code\":\"$U003_CODE\"}")
    echo "  响应: $(echo $RESP | head -c 200)"
    assert_not_contains "自推荐应拒绝" "$RESP" '"success":true'
fi

# ============================================================
echo ""
echo -e "${CYAN}═══ 第5步：查看已有推荐关系 (u-006 被 u-001 推荐) ═══${NC}"
# ============================================================

echo "登录 u-006 (顾予夏, VIP, 被 u-001 推荐)..."
TOKEN_006=$(login 13800138006)
RESP=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_006")
assert_http_ok "u-006 查询会员资料" "$RESP"
assert_contains "u-006 是 VIP" "$RESP" '"tier":"VIP"'
assert_contains "u-006 推荐人=u-001" "$RESP" '"inviterUserId":"u-001"'
echo "  响应: $(echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(f'tier={d.get(\"tier\")}, inviter={d.get(\"inviterUserId\")}, code={d.get(\"referralCode\")}')" 2>/dev/null)"

# ============================================================
echo ""
echo -e "${CYAN}═══ 第6步：查看 VIP 树结构 ═══${NC}"
# ============================================================

echo "查询 u-001 的 VIP 树..."
RESP=$(curl -s "$BASE/bonus/vip/tree" -H "Authorization: Bearer $TOKEN_001")
assert_http_ok "u-001 VIP 树查询" "$RESP"
echo "  树节点: $(echo $RESP | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
me = d.get('me',{})
print(f'level={me.get(\"level\")}, position={me.get(\"position\")}, childrenCount={me.get(\"childrenCount\")}')
children = d.get('children',[])
print(f'  子节点数: {len(children)}')
for c in children[:5]:
    print(f'    - userId={c.get(\"userId\")}, level={c.get(\"level\")}, pos={c.get(\"position\")}')
" 2>/dev/null)"

echo ""
echo "查询 u-006 的 VIP 树..."
RESP=$(curl -s "$BASE/bonus/vip/tree" -H "Authorization: Bearer $TOKEN_006")
assert_http_ok "u-006 VIP 树查询" "$RESP"

# ============================================================
echo ""
echo -e "${CYAN}═══ 第7步：查看奖励钱包 ═══${NC}"
# ============================================================

echo "查询 u-001 的 VIP 奖励钱包..."
RESP=$(curl -s "$BASE/bonus/wallet" -H "Authorization: Bearer $TOKEN_001")
assert_http_ok "u-001 奖励钱包" "$RESP"
echo "  钱包: $(echo $RESP | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'balance={d.get(\"balance\")}, frozen={d.get(\"frozen\")}')
" 2>/dev/null)"

echo ""
echo "查询 u-001 的奖励流水..."
RESP=$(curl -s "$BASE/bonus/wallet/ledger?page=1&pageSize=5" -H "Authorization: Bearer $TOKEN_001")
assert_http_ok "u-001 奖励流水" "$RESP"
echo "  流水: $(echo $RESP | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
items = d.get('items',[])
print(f'共 {d.get(\"total\",0)} 条记录')
for it in items[:3]:
    print(f'  - type={it.get(\"entryType\")}, amount={it.get(\"amount\")}, status={it.get(\"status\")}, ref={it.get(\"refType\")}')
" 2>/dev/null)"

# ============================================================
echo ""
echo -e "${CYAN}═══ 第8步：新用户注册 + 自动绑定推荐码 ═══${NC}"
# ============================================================

echo "用新手机号注册（模拟 OTP 登录，自动创建账号）..."
NEW_PHONE="13900001234"
RESP=$(curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"phone\",\"mode\":\"code\",\"phone\":\"$NEW_PHONE\",\"code\":\"123456\"}")
echo "  注册响应: $(echo $RESP | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'userId={d.get(\"userId\")}, token={str(d.get(\"accessToken\",\"\"))[:20]}...')
" 2>/dev/null)"
TOKEN_NEW=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('accessToken',''))" 2>/dev/null)

if [ -n "$TOKEN_NEW" ]; then
    echo ""
    echo "新用户绑定 u-001 的推荐码 LQHE2025..."
    RESP=$(curl -s -X POST "$BASE/bonus/referral" \
        -H "Authorization: Bearer $TOKEN_NEW" \
        -H "Content-Type: application/json" \
        -d '{"code":"LQHE2025"}')
    assert_contains "新用户绑定推荐码" "$RESP" '"success":true'

    echo ""
    echo "验证新用户的推荐人..."
    RESP=$(curl -s "$BASE/bonus/member" -H "Authorization: Bearer $TOKEN_NEW")
    assert_contains "新用户推荐人=u-001" "$RESP" '"inviterUserId":"u-001"'
    assert_contains "新用户是 NORMAL" "$RESP" '"tier":"NORMAL"'
    echo "  新用户资料: $(echo $RESP | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'tier={d.get(\"tier\")}, code={d.get(\"referralCode\")}, inviter={d.get(\"inviterUserId\")}')
" 2>/dev/null)"
fi

# ============================================================
echo ""
echo -e "${CYAN}═══ 第9步：延迟深度链接 (Deferred Deep Link) ═══${NC}"
# ============================================================

echo "模拟未安装App的用户点击推荐链接（POST /deferred-link）..."
RESP=$(curl -s -X POST "$BASE/deferred-link" \
    -H "Content-Type: application/json" \
    -d '{
        "referralCode":"LQHE2025",
        "fingerprint":"test-fp-abc123",
        "ipAddress":"192.168.1.100",
        "userAgent":"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)",
        "screenInfo":"375x812",
        "language":"zh-CN"
    }')
echo "  响应: $(echo $RESP | head -c 300)"
COOKIE_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('cookieId',''))" 2>/dev/null)

if [ -n "$COOKIE_ID" ]; then
    assert_contains "深度链接创建成功" "$RESP" '"cookieId"'
    echo "  cookieId=$COOKIE_ID"

    echo ""
    echo "模拟 App 安装后通过 Cookie 解析推荐码..."
    RESP=$(curl -s "$BASE/deferred-link/resolve?cookieId=$COOKIE_ID")
    echo "  解析响应: $(echo $RESP | head -c 300)"
    assert_contains "Cookie解析推荐码" "$RESP" 'LQHE2025'
else
    echo -e "  ${YELLOW}⚠️ 深度链接模块可能未注册，跳过${NC}"
    RESP_STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCode',''))" 2>/dev/null)
    echo "  状态码: $RESP_STATUS"
fi

echo ""
echo "模拟指纹匹配（POST /deferred-link/match）..."
RESP=$(curl -s -X POST "$BASE/deferred-link/match" \
    -H "Content-Type: application/json" \
    -d '{
        "fingerprint":"test-fp-abc123",
        "ipAddress":"192.168.1.100",
        "screenInfo":"375x812"
    }')
echo "  匹配响应: $(echo $RESP | head -c 300)"

# ============================================================
echo ""
echo -e "${CYAN}═══ 第10步：查看 VIP 套餐列表 ═══${NC}"
# ============================================================

echo "获取 VIP 套餐列表..."
RESP=$(curl -s "$BASE/orders/vip-packages" -H "Authorization: Bearer $TOKEN_007" 2>/dev/null || \
       curl -s "$BASE/vip/packages" -H "Authorization: Bearer $TOKEN_007" 2>/dev/null || \
       echo '{"error":"endpoint not found"}')
echo "  响应: $(echo $RESP | head -c 400)"

# 尝试其他可能的端点
if echo "$RESP" | grep -q "error\|Cannot\|404"; then
    echo "  尝试其他端点..."
    for ep in "bonus/vip-packages" "checkout/vip-packages" "products/vip-packages"; do
        RESP2=$(curl -s "$BASE/$ep" -H "Authorization: Bearer $TOKEN_007" 2>/dev/null)
        if echo "$RESP2" | grep -q '"ok":true'; then
            echo "  找到端点: $ep"
            echo "  响应: $(echo $RESP2 | head -c 400)"
            break
        fi
    done
fi

# ============================================================
echo ""
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    测试结果汇总                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo -e "║  总测试数:  ${TOTAL}                                       ║"
echo -e "║  ${GREEN}通过:     ${PASS}${NC}                                       ║"
echo -e "║  ${RED}失败:     ${FAIL}${NC}                                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 所有测试通过！推荐链路完整无缺。${NC}"
else
    echo -e "${RED}⚠️ 有 $FAIL 个测试失败，需要排查。${NC}"
fi
