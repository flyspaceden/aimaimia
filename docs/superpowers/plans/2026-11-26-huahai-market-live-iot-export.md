# 华海 AI 农贸市场 · 真实养殖环境数据接入（物联网平台导出侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 物联网平台新增一个常驻导出进程：每 5 分钟把“公开登记表”里登记过的塘口的最新读数和 24 小时 / 7 天 / 30 天曲线写成 JSON 文件，由物联网服务器上一个仅内网可访问的只读站点提供给官网服务器。

**Architecture:** 一条迁移新增三张登记表和一个只读函数；一个新的 Python 模块 `huahai_iot_farm.market_export`，沿用平台现有“系统任务身份”做法以公司范围读数，纯函数负责筛选、拼装和白名单，独立 systemd 单元常驻运行。曲线用现有 `farm.iot_unit_telemetry` 按天分小段读，在上一份输出的基础上只补新段，每天整体重读一次。平台现有函数、现有任务、现有 nginx 配置一律不改。

**Tech Stack:** Python（仓库现有版本与 `.venv`）、psycopg、PostgreSQL 16（强制行级权限）、pytest、systemd、nginx。

**Spec:** 爱买买仓库 `docs/superpowers/specs/2026-11-26-huahai-market-live-environment-design.md`（设计）与 `docs/superpowers/plans/2026-11-26-huahai-market-live-site.md` 里的“数据契约 v1”（输出格式的唯一定义，本计划逐字遵守）。

**仓库与基线：** 物联网平台仓库（`/Users/jamesheden/Desktop/华海农业物联网/`），从线上版本 `9bcf7cb`（锦鲤通道 2026-11-27 已上线：后端 3c998f8 + 后台网页修复 9bcf7cb，迁移 next/040–045 已在生产执行）新开工作目录和分支。迁移用 060：线上最高 045，锦鲤会话下一个用 046，留出空间；`live_test_db.sh` 按文件名顺序套用，060 排在最后，与生产执行顺序一致，不在别的会话的工作目录里改。本计划文件存放在爱买买仓库，Task 0 会把它复制进物联网仓库。

## Global Constraints

- 只读：导出进程不写任何业务表，不调用任何外部服务。
- 不改共用文件：`runtime.py`、`task_scopes.py`、`runtime_tasks.py`、`service.py`、`repository.py`、`docs/DEPLOYMENT.md` 一律不动（锦鲤会话同时在改这些文件）；部署说明写进新文件 `docs/MARKET_PUBLIC_EXPORT_DEPLOYMENT_20261126.md`。本机测试库用独立容器 `huahai-market-pg16:55841`。
- 部署不冲突：IoT 服务器代码按一个提交整目录部署，上线前必须确认线上当时的提交，并基于“线上提交 + 本分支”的合并结果部署，不得冲掉锦鲤会话已上线的代码。
- 不改现有对象：不重定义 `farm.runtime_task_scopes`、`farm.ensure_runtime_task_actor`、`farm.iot_unit_telemetry`、`farm.overview_iot`，不碰历史投影契约清单里的函数（`sql/postgresql/farm/150*、159*、160*`），不改现有 nginx 配置文件和现有任务。
- 迁移放 `sql/baseline/next/060_market_public_export.sql`，回退放 `sql/baseline/next/rollback/060_market_public_export_down.sql`，可重复执行，文件头按 `next/027` 的写法（中文说明、不涉及历史投影契约的声明、回退路径、`BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s';`）。合并时 060 若已被占用则顺延并同步改文档。
- 输出只含数据契约 v1 的键。员工姓名、预警、养殖事件、设备序列号、盒子 / 通道 / 塘的内部编号、现场填写的探头名称一律不得出现在输出里。
- 读数取舍（用户已定）：**不看校准状态**。只导出来源为设备（`source_type` 为空或 `DEVICE`）的读数；质量为 `BAD`、`MISSING` 的不导出；`GOOD`、`SUSPECT`、空都导出（未校准的探头入库时默认就是 `SUSPECT`，不能挡）。
- 数据契约 v1 只容纳一家公司：导出进程按启动参数里的公司编号运行，一次只导出一家。
- 时间一律 UTC，格式 `YYYY-MM-DDTHH:MM:SSZ`；曲线点是 `[毫秒时间戳, 数值]`。
- 文件写入：同目录临时文件 → `os.replace`，权限 `0644`（单元里 `UMask=0077`，必须显式 `chmod`）。
- 测试只跑与本改动相关的文件（仓库规定）；审查子代理用 Sonnet、effort high。
- 不推送、不部署、不连线上。服务器上的动作只写进文档，执行前要用户放行。
- 提交：一个任务一次提交，`feat(market-export): …` 风格，只 `git add` 具体文件，结尾带 `Co-Authored-By` 行。

## Review Focus

1. 盒子或探头更换后，登记的“盒子 + 通道”不再上报 → 该项导出为空读数（`value: null`），不报错、不串到别的通道；文档写明更换设备后要重新登记。测试在 Task 3。
2. 设备时钟不准或断网后补传：读数时间比现在还晚超过 5 分钟 → 丢弃这条；补传的旧数据靠“每天整体重读一次”补进曲线。测试在 Task 2。
3. 系统里的单位与登记的单位不一致（有人改了通道配置）→ 该项导出为空读数并记一行日志，不把数值按错误单位公开。测试在 Task 2。
4. 读数文字不是数（空串、`ERR`、`NaN`、`inf`）→ 空读数 / 丢弃该点。测试在 Task 2。
5. 输出目录不存在、不可写、磁盘满，或上一份曲线文件是坏的 → 不留半个文件，旧文件原样保留，进程不退出，下一轮再试；坏的旧文件按“没有上一份”处理。测试在 Task 2、Task 3。

---

### Task 0: 工作目录、本机测试库、计划文件入库

**Files:**
- Create: `docs/plans/MARKET_PUBLIC_EXPORT_PLAN_20261126.md`（本文件的副本）
- Modify: `docs/README.md`（登记）

- [ ] **Step 1:** 在物联网仓库主目录执行 `git worktree add ../huahai-iot-platform-market-export-20261126 -b claude/market-export 9bcf7cb`，之后所有命令都在这个新目录里跑。按仓库 README 准备 `.venv`。
- [ ] **Step 2:** 起独立的本机测试库，不占用别的会话的容器：`HUAI_TEST_PG_NAME=huahai-market-pg16 HUAI_TEST_PG_PORT=55841 scripts/dev/live_test_db.sh up`。预期生成 `.local/farm-dev/owner-dsn`、`runtime-dsn`。
- [ ] **Step 3:** 跑一个现有的库测试确认环境可用：`.venv/bin/python -m pytest tests/farm/test_task_scopes.py -q`，预期全部通过。
- [ ] **Step 4:** 复制本计划为 `docs/plans/MARKET_PUBLIC_EXPORT_PLAN_20261126.md`，在 `docs/README.md` 的计划列表里登记一行；提交 `docs(market-export): 导出任务实施计划`。

### Task 1: 迁移 060 —— 公开登记表与只读函数

**Files:**
- Create: `sql/baseline/next/060_market_public_export.sql`
- Create: `sql/baseline/next/rollback/060_market_public_export_down.sql`
- Test: `tests/farm/test_market_export_postgres.py`

**Interfaces:**
- Produces（表，全部 `OWNER TO huahai_owner`、`ENABLE` + `FORCE ROW LEVEL SECURITY`、策略 `company_boundary`（`organization_id = farm.company()`）、`REVOKE ALL … FROM PUBLIC, huahai_farm_runtime`，**不给运行角色任何表权限**，登记由属主用 psql 写入）：

```sql
farm.market_public_bases(
  organization_id uuid NOT NULL REFERENCES iot.organizations(organization_id),
  station_id uuid NOT NULL,
  base_code text NOT NULL UNIQUE CHECK (base_code ~ '^[a-z0-9]{1,12}$'),
  base_name text CHECK (base_name IS NULL OR char_length(base_name) BETWEEN 1 AND 60),   -- 空 = 用系统里的基地名
  PRIMARY KEY (organization_id, station_id))
farm.market_public_ponds(
  organization_id uuid NOT NULL, station_id uuid NOT NULL, unit_id uuid NOT NULL,
  pond_code text NOT NULL UNIQUE CHECK (pond_code ~ '^[a-z0-9]{1,12}-[a-z0-9]{1,12}$'),
  pond_name text NOT NULL CHECK (char_length(pond_name) BETWEEN 1 AND 60),
  enabled boolean NOT NULL DEFAULT true,
  registered_by text NOT NULL CHECK (char_length(registered_by) BETWEEN 1 AND 60),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, unit_id),
  FOREIGN KEY (organization_id, station_id) REFERENCES farm.market_public_bases(organization_id, station_id),
  FOREIGN KEY (organization_id, unit_id) REFERENCES farm.production_units(organization_id, unit_id))
farm.market_public_readings(
  organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  reading_key text NOT NULL CHECK (reading_key ~ '^r[0-9]{1,3}$'),
  gateway_id uuid NOT NULL, channel_id text NOT NULL, metric_code integer NOT NULL,
  public_label text NOT NULL CHECK (char_length(public_label) BETWEEN 1 AND 40),
  metric_name text NOT NULL CHECK (char_length(metric_name) BETWEEN 1 AND 20),
  unit text NOT NULL CHECK (char_length(unit) <= 12),
  sort_order integer NOT NULL,
  PRIMARY KEY (organization_id, unit_id, reading_key),
  UNIQUE (organization_id, unit_id, gateway_id, channel_id, metric_code),
  FOREIGN KEY (organization_id, unit_id) REFERENCES farm.market_public_ponds(organization_id, unit_id) ON DELETE CASCADE)
```

- Produces（函数）：`farm.market_public_registry() RETURNS jsonb`，`SECURITY DEFINER SET search_path=pg_catalog,pg_temp`，属主 `huahai_owner`，只把 `EXECUTE` 给 `huahai_farm_runtime`。
  - 守卫：先 `PERFORM farm.runtime_task_session()`；再要求 `farm.company()`、`farm.actor()` 都不为空且 `farm.runtime_task_validate(farm.company(), farm.actor())` 为真，否则 `RAISE EXCEPTION 'HUAI_REASON:SCOPE_FORBIDDEN' USING ERRCODE='42501'`。普通成员、后台接口身份都调不通。
  - 只返回当前公司、`enabled` 的塘、塘所在基地与登记的基地一致（`production_units.station_id = market_public_ponds.station_id`）、塘状态 `ACTIVE`、塘代号以 `基地代号 || '-'` 开头的行。返回结构（键名固定）：

```json
{ "company_name": "<iot.organizations.name>",
  "bases": [ { "code": "", "name": "<coalesce(base_name, iot.stations.name)>", "province": "", "city": "", "district": "",
               "address": "<address_detail>", "lat": null, "lng": null,
               "ponds": [ { "code": "", "name": "<pond_name>", "unit_id": "<uuid>", "area_value": null, "area_unit": "",
                            "readings": [ { "key": "r1", "label": "", "metric_name": "", "unit": "",
                                            "gateway_id": "<uuid>", "channel_id": "", "metric_code": 41206 } ] } ] } ] }
```

  基地按 `base_code`、塘按 `pond_code`、读数按 `sort_order, reading_key` 排序；空的省市区和地址输出 `""`；没有塘的基地不出现。`unit_id`、`gateway_id`、`channel_id`、`metric_code` 只供导出进程取数用，不进入公开文件（Task 2 的白名单负责）。

- [ ] **Step 1: 写失败的测试** `tests/farm/test_market_export_postgres.py`。库连接与建数据方式照 `tests/farm/test_member_adjustments_postgres.py:27-77`（属主事务里建公司、基地、塘）和 `tests/farm/test_farm_postgres.py:24-42`（`database()` 夹具，没有本机库就跳过）。用属主建：公司 A（已启用农事：`farm.site_settings.farm_enabled_at` 非空）带基地 S1、塘 U1、U2；公司 B 带基地 S2、塘 U3。登记：A 的基地 `ta`、塘 U1 为 `ta-01`（两项读数 `r1`、`r2`），塘 U2 为 `ta-02` 但 `enabled=false`；B 的基地 `tb`、塘 U3 为 `tb-01`。系统任务身份用 `SELECT farm.ensure_runtime_task_actor(%s)`（以运行角色连接）取得。

```python
def test_registry_returns_only_enabled_ponds_of_own_company(database, world):
    data = as_task_actor(database, world.company_a, "SELECT farm.market_public_registry() AS r")["r"]
    assert data["company_name"] == world.company_a_name
    assert [b["code"] for b in data["bases"]] == ["ta"]
    assert [p["code"] for p in data["bases"][0]["ponds"]] == ["ta-01"]            # ta-02 已停用；tb-01 是别的公司
    assert data["bases"][0]["name"] == world.station_s1_name                       # base_name 为空时用系统里的名字
    assert [r["key"] for r in data["bases"][0]["ponds"][0]["readings"]] == ["r1", "r2"]
    assert set(data["bases"][0]["ponds"][0]) == {"code", "name", "unit_id", "area_value", "area_unit", "readings"}
    assert set(data["bases"][0]["ponds"][0]["readings"][0]) == {"key", "label", "metric_name", "unit", "gateway_id", "channel_id", "metric_code"}

def test_registry_refused_for_ordinary_member_and_for_owner_session(database, world):
    with pytest.raises(psycopg.Error) as member:        # 公司 A 的普通成员，经运行角色、已设 farm.actor_id / farm.organization_id
        as_member(database, world.company_a, world.member_a, "SELECT farm.market_public_registry()")
    assert "SCOPE_FORBIDDEN" in str(member.value)
    with pytest.raises(psycopg.Error) as owner:         # 属主连接直接调
        as_owner(database, "SELECT farm.market_public_registry()")
    assert "RUNTIME_TASK_IDENTITY_REQUIRED" in str(owner.value)

def test_runtime_role_cannot_touch_registry_tables(database, world):
    for table in ("market_public_bases", "market_public_ponds", "market_public_readings"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            as_task_actor(database, world.company_a, f"SELECT count(*) FROM farm.{table}")

def test_constraints_reject_bad_codes(database, world):  # 属主写入：pond_code 'TA_01'、base_code 'T A'、reading_key 'do'、同一通道登记两次、public_label 41 字 → 各自抛约束错误

def test_pond_registered_under_wrong_base_is_not_returned(database, world):   # 把 U1 登记到本公司另一个基地名下 → registry 里没有它

def test_rollback_and_reapply(database):                 # 依次执行 down、up、up → 三张表与函数存在且无报错（可重复执行）
```

- [ ] **Step 2: 运行确认失败** — `.venv/bin/python -m pytest tests/farm/test_market_export_postgres.py -q`，预期：函数 / 表不存在。
- [ ] **Step 3: 写迁移与回退文件**，并用属主套到本机库：`psql "$(cat .local/farm-dev/owner-dsn)" -X -v ON_ERROR_STOP=1 -f sql/baseline/next/060_market_public_export.sql`。函数以属主身份运行且表强制了行级权限，所以函数里读登记表靠的是会话里已设的 `farm.company()`；若属主读 `iot.stations` / `iot.organizations` 被拦，按 `farm.overview_iot` 读基地行的同样方式处理，以第一个测试里“基地名取到了”为准。
- [ ] **Step 4: 运行确认通过** — 同 Step 2 的命令。
- [ ] **Step 5: 提交** — `git add sql/baseline/next/060_market_public_export.sql sql/baseline/next/rollback/060_market_public_export_down.sql tests/farm/test_market_export_postgres.py && git commit -m "feat(market-export): 公开登记表与只读登记函数（迁移 060）"`

### Task 2: 纯函数 —— 读数取舍、曲线合并、白名单拼装、原子写文件

**Files:**
- Create: `src/huahai_iot_farm/market_export.py`
- Test: `tests/farm/test_market_export.py`

**Interfaces:**
- Produces：

```python
SCHEMA = 1
RANGES = {"24h": (86_400_000, 300_000), "7d": (604_800_000, 3_600_000), "30d": (2_592_000_000, 14_400_000)}  # 范围: (跨度毫秒, 每段毫秒)
CHUNK_MS = 86_400_000          # 每次查询最多读一天
FUTURE_TOLERANCE_MS = 300_000  # 读数时间比现在晚超过这么多就丢弃

def iso_utc(moment: datetime) -> str                       # 'YYYY-MM-DDTHH:MM:SSZ'，舍去秒以下
def to_ms(moment: datetime) -> int
def number(text) -> float | None                           # 有限数字才返回；'' / None / 'ERR' / 'NaN' / 'inf' → None
def usable(source_type, quality) -> bool                   # source_type in (None,'DEVICE') 且 quality not in ('BAD','MISSING')
def reading_value(row: dict | None, unit: str, now: datetime) -> tuple[float | None, str | None]
    # row 是 farm.overview_iot 的一条 reading（键 value_text / observed_at / quality / source_type / unit）；
    # row 为空、不可用、单位与登记不符、不是数、没有时间、时间太超前 → (None, None)；否则 (数值, iso_utc(采样时间))
def series_points(rows: list[dict] | None, now_ms: int) -> list[tuple[int, float]]
    # rows 是 farm.iot_unit_telemetry 的 items（取 row['observed_at'] 与 row['original'] 里的 value_text / quality / source_type）；同样的取舍，按时间升序
def window(range_id: str, now_ms: int) -> tuple[int, int]   # until = now_ms 向下取整到该范围的段边界；since = until − 跨度
def chunks(start_ms: int, until_ms: int, bucket_ms: int) -> list[tuple[int, int, int]]
    # 把 [start, until) 切成不超过 CHUNK_MS 的小段，每段给 (since, until, 段数)；start >= until 时为空
def resume_from(previous: list, since_ms: int, bucket_ms: int) -> int
    # 上一份里落在窗口内的最后一个点所在段的下一段起点；没有可用的点时为 since_ms
def merge_points(previous: list, fresh: list[tuple[int, float]], since_ms: int, until_ms: int, bucket_ms: int) -> list[list]
    # 合并后只留 [since, until) 内的点，每段只留时间最晚的一个，升序，元素为 [int, float]
def build_index(registry: dict, latest: list[dict], now: datetime, company_name: str | None = None) -> dict
    # latest 是 overview_iot 的 readings；按 (unit_id, gateway_id, channel_id, metric_code) 对上登记的读数；逐键拼装，只出契约里的键；
    # 系统里取来的文字超出契约长度（公司名、基地名 60 字，省市区 30 字，地址 120 字）→ 抛 ValueError，不截断、不导出
def build_pond(code: str, series: dict[str, list[dict]], now: datetime) -> dict     # series = {'24h': [{'key','points'}], '7d': …, '30d': …}
def write_json(directory: Path, name: str, payload: dict) -> None                   # 紧凑、ensure_ascii=False、allow_nan=False；临时文件 → chmod 0o644 → os.replace
def load_previous(directory: Path, code: str) -> dict | None   # 读 pond-<code>.json；不存在、不是合法 JSON、schema 不是 1、pond 不符 → None
def needs_full_rebuild(previous: dict | None, now: datetime) -> bool   # 没有上一份，或上一份的 generated_at 与 now 不在同一个 UTC 日
def remove_unlisted(directory: Path, codes: set[str]) -> list[str]     # 删掉不在 codes 里的 pond-*.json（只匹配 ^pond-[a-z0-9]{1,12}-[a-z0-9]{1,12}\.json$），返回删掉的文件名
```

- [ ] **Step 1: 写失败的测试** `tests/farm/test_market_export.py`

```python
NOW = datetime(2026, 11, 26, 6, 35, 0, tzinfo=UTC)
NOW_MS = market_export.to_ms(NOW)
def row(**over):   # overview_iot 的一条读数
    return {"unit_id": "U1", "gateway_id": "G1", "channel_id": "c1", "metric_code": 41206, "unit": "mg/L",
            "value_text": "6.82", "observed_at": "2026-11-26T06:34:00+00:00", "quality": "SUSPECT",
            "source_type": "DEVICE", "calibration_state": "UNVERIFIED", "name": "张三的探头", "gateway_code": "SN-001"} | over

def test_reading_value_rules():
    assert market_export.reading_value(row(), "mg/L", NOW) == (6.82, "2026-11-26T06:34:00Z")          # 未校准、SUSPECT 照常导出
    assert market_export.reading_value(row(quality="GOOD", calibration_state="VERIFIED"), "mg/L", NOW)[0] == 6.82
    assert market_export.reading_value(row(quality=None, source_type=None), "mg/L", NOW)[0] == 6.82
    for bad in (row(quality="BAD"), row(quality="MISSING"), row(source_type="TEST_GENERATOR"), row(source_type="MANUAL"),
                row(source_type="LAB"), row(source_type="AI_DERIVED"), row(unit="ppm"), row(value_text=""), row(value_text="ERR"),
                row(value_text="NaN"), row(value_text="inf"), row(observed_at=None), row(observed_at="2026-11-26T06:41:00+00:00"), None):
        assert market_export.reading_value(bad, "mg/L", NOW) == (None, None)
    assert market_export.reading_value(row(observed_at="2026-11-26T06:39:00+00:00"), "mg/L", NOW)[0] == 6.82   # 超前 4 分钟内容忍

def test_series_points_filter_and_order():
    item = lambda at, value, **o: {"observed_at": at, "original": {"value_text": value, "quality": "SUSPECT", "source_type": "DEVICE"} | o}
    rows = [item("2026-11-26T06:10:00+00:00", "6.5"), item("2026-11-26T06:05:00+00:00", "6.4"),
            item("2026-11-26T06:15:00+00:00", "x"), item("2026-11-26T06:20:00+00:00", "6.6", quality="BAD"),
            item("2026-11-26T06:25:00+00:00", "6.7", source_type="TEST_GENERATOR"), item("2026-11-26T07:00:00+00:00", "9")]
    assert [v for _, v in market_export.series_points(rows, NOW_MS)] == [6.4, 6.5]
    assert market_export.series_points(None, NOW_MS) == []

def test_window_chunks_resume_merge():
    since, until = market_export.window("24h", NOW_MS)
    assert until == NOW_MS - NOW_MS % 300_000 and until - since == 86_400_000
    assert [(c[1] - c[0], c[2]) for c in market_export.chunks(since, until, 300_000)] == [(86_400_000, 288)]
    s30, u30 = market_export.window("30d", NOW_MS)
    parts = market_export.chunks(s30, u30, 14_400_000)
    assert len(parts) == 30 and all(p[2] == 6 for p in parts) and parts[0][0] == s30 and parts[-1][1] == u30
    assert market_export.chunks(until, until, 300_000) == []
    previous = [[since - 1, 1.0], [since + 10, 2.0], [since + 600_010, 3.0]]
    assert market_export.resume_from(previous, since, 300_000) == since + 900_000
    assert market_export.resume_from([], since, 300_000) == since
    assert market_export.resume_from([[since - 5, 1.0]], since, 300_000) == since
    merged = market_export.merge_points(previous, [(since + 900_020, 4.0), (since + 900_050, 5.0), (until + 5, 6.0)], since, until, 300_000)
    assert merged == [[since + 10, 2.0], [since + 600_010, 3.0], [since + 900_050, 5.0]]      # 窗口外的丢掉；同一段只留最晚的

REGISTRY = {"company_name": "华海公司", "bases": [{"code": "yx", "name": "阳江永兴基地", "province": "广东省", "city": "阳江市", "district": "",
    "address": "某路 1 号", "lat": 21.75, "lng": 111.85, "ponds": [{"code": "yx-00", "name": "永兴 0 号塘", "unit_id": "U1",
    "area_value": 5, "area_unit": "亩", "readings": [
        {"key": "r1", "label": "溶解氧 · 1 号探头", "metric_name": "溶解氧", "unit": "mg/L", "gateway_id": "G1", "channel_id": "c1", "metric_code": 41206},
        {"key": "r2", "label": "水温 · 1 号探头", "metric_name": "水温", "unit": "℃", "gateway_id": "G1", "channel_id": "c2", "metric_code": 41201}]}]}]}

def test_build_index_is_whitelist_only():
    index = market_export.build_index(REGISTRY, [row(), row(unit_id="U9", value_text="1")], NOW)   # U9 没登记
    assert set(index) == {"schema", "generated_at", "company", "bases"} and index["schema"] == 1
    assert index["generated_at"] == "2026-11-26T06:35:00Z" and index["company"] == {"name": "华海公司"}
    base, = index["bases"]; pond, = base["ponds"]; r1, r2 = pond["readings"]
    assert set(base) == {"code", "name", "province", "city", "district", "address", "lat", "lng", "ponds"}
    assert set(pond) == {"code", "name", "area_value", "area_unit", "readings"}
    assert r1 == {"key": "r1", "label": "溶解氧 · 1 号探头", "metric_name": "溶解氧", "unit": "mg/L", "value": 6.82, "observed_at": "2026-11-26T06:34:00Z"}
    assert r2 == {"key": "r2", "label": "水温 · 1 号探头", "metric_name": "水温", "unit": "℃", "value": None, "observed_at": None}   # 这一路没有读数
    text = json.dumps(index, ensure_ascii=False)
    assert not any(secret in text for secret in ("U1", "G1", "c1", "41206", "张三", "SN-001", "UNVERIFIED", "SUSPECT"))
    assert market_export.build_index(REGISTRY, [], NOW, company_name="华海农科")["company"] == {"name": "华海农科"}
    assert market_export.build_index({"company_name": "华海公司", "bases": []}, [], NOW)["bases"] == []
    with pytest.raises(ValueError):
        market_export.build_index({**REGISTRY, "bases": [{**REGISTRY["bases"][0], "address": "x" * 121}]}, [], NOW)

def test_build_pond_shape():
    pond = market_export.build_pond("yx-00", {"24h": [{"key": "r1", "points": [[1, 2.0]]}], "7d": [], "30d": []}, NOW)
    assert pond == {"schema": 1, "generated_at": "2026-11-26T06:35:00Z", "pond": "yx-00",
                    "series": {"24h": [{"key": "r1", "points": [[1, 2.0]]}], "7d": [], "30d": []}}

def test_write_json_atomic_and_readable(tmp_path):
    market_export.write_json(tmp_path, "index.json", {"a": "中"})
    assert (tmp_path / "index.json").read_text(encoding="utf-8") == '{"a":"中"}'
    assert stat.S_IMODE((tmp_path / "index.json").stat().st_mode) == 0o644
    with pytest.raises(ValueError):
        market_export.write_json(tmp_path, "index.json", {"a": float("nan")})
    assert (tmp_path / "index.json").read_text(encoding="utf-8") == '{"a":"中"}'      # 失败不动旧文件
    assert [p.name for p in tmp_path.iterdir()] == ["index.json"]                       # 不留临时文件
    with pytest.raises(OSError):
        market_export.write_json(tmp_path / "missing", "index.json", {})

def test_previous_file_handling(tmp_path):
    assert market_export.load_previous(tmp_path, "yx-00") is None
    (tmp_path / "pond-yx-00.json").write_text("{broken", encoding="utf-8")
    assert market_export.load_previous(tmp_path, "yx-00") is None
    market_export.write_json(tmp_path, "pond-yx-00.json", market_export.build_pond("yx-00", {"24h": [], "7d": [], "30d": []}, NOW))
    previous = market_export.load_previous(tmp_path, "yx-00")
    assert previous["pond"] == "yx-00" and market_export.load_previous(tmp_path, "yx-01") is None
    assert market_export.needs_full_rebuild(None, NOW) is True
    assert market_export.needs_full_rebuild(previous, NOW) is False
    assert market_export.needs_full_rebuild(previous, NOW + timedelta(days=1)) is True
    (tmp_path / "pond-yx-07.json").write_text("{}"); (tmp_path / "notes.txt").write_text("x")
    assert market_export.remove_unlisted(tmp_path, {"yx-00"}) == ["pond-yx-07.json"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["notes.txt", "pond-yx-00.json"]
```

- [ ] **Step 2: 运行确认失败** — `.venv/bin/python -m pytest tests/farm/test_market_export.py -q`，预期：模块不存在。
- [ ] **Step 3: 实现上述函数。**
- [ ] **Step 4: 运行确认通过** — 同上命令；再跑 `ruff check src/huahai_iot_farm/market_export.py tests/farm/test_market_export.py`。
- [ ] **Step 5: 提交** — `git add src/huahai_iot_farm/market_export.py tests/farm/test_market_export.py && git commit -m "feat(market-export): 读数取舍、曲线合并、白名单拼装与原子写文件"`

### Task 3: 取数与一轮导出

**Files:**
- Modify: `src/huahai_iot_farm/market_export.py`
- Test: `tests/farm/test_market_export.py`（追加）、`tests/farm/test_market_export_postgres.py`（追加）

**Interfaces:**
- Consumes：Task 1 的 `farm.market_public_registry()`；Task 2 的全部函数；现有 `task_scopes.execute(service, row, operation)`、`FarmService.run(actor, org, operation)`、事务对象的 `tx.one(sql, params)`；现有 SQL 函数 `farm.overview_iot(uuid[], uuid[], int[])` 与 `farm.iot_unit_telemetry(unit, metric, since_ms, until_ms, latest_only, gateway, channel, buckets)`。
- Produces：

```python
def read_registry(tx) -> dict            # SELECT farm.market_public_registry() AS registry
def read_latest(tx, unit_ids: list[str], metric_codes: list[int]) -> list[dict]
    # SELECT farm.overview_iot(%s::uuid[], '{}'::uuid[], %s::int[]) AS facts → facts['readings']；没有登记的塘时不查，返回 []
def read_chunk(tx, unit_id, reading: dict, since_ms: int, until_ms: int, buckets: int) -> list[dict]
    # SELECT farm.iot_unit_telemetry(%s,%s,%s,%s,false,%s,%s,%s) AS rows，参数依次 unit_id、metric_code、since、until、gateway_id、channel_id、buckets
def reading_series(run, unit_id, reading: dict, previous: list, range_id: str, now_ms: int, full: bool) -> list[list]
    # run(fn) 在一个独立事务里执行 fn(tx)。full 为真从窗口起点读，否则从 resume_from 读；按 chunks 逐段 read_chunk → series_points → merge_points
def export_company(service, actor: dict, company_id: str, output_dir: Path, *, now: datetime | None = None, company_name: str | None = None) -> dict
def export_once(service, company_id: str, output_dir: Path, *, now: datetime | None = None, company_name: str | None = None) -> dict
    # 经 task_scopes.execute(service, {"organization_id": company_id, "station_id": None}, operation) 取得系统任务身份；
    # operation 里以 {"user_id": actor, "_independent_runtime_task": True} 调 export_company
```

- `export_company` 的顺序与规定：
  1. 一个事务里读登记和最新读数，`build_index`，`write_json(output_dir, 'index.json', …)`。
  2. 逐口塘：`load_previous`；`full = needs_full_rebuild(previous, now)`；逐项读数、逐个范围调 `reading_series`（**每一小段查询各用一个事务**，不开长事务）；某项读数任何一段查询出错 → 这项读数三个范围都沿用上一份里的点（没有上一份就不出现），记一行不含内部编号的日志，继续下一项；最后 `build_pond` 并写 `pond-<代号>.json`。没有点的读数不写进该范围。
  3. `remove_unlisted(output_dir, 本次登记的塘代号)`。
  4. 返回 `{"processed": True, "ponds": n, "readings": m, "failed_series": k, "removed": [...]}`。
  - 第 1 步失败（登记读不到、写不了文件）：异常上抛，什么都不删，旧文件原样。`export_once` 在系统任务身份不可用时返回 `{"processed": False, "state": "SCOPE_UNAVAILABLE"}`，同样不动文件。

- [ ] **Step 1: 写失败的测试**

  追加到 `tests/farm/test_market_export.py`（不连库，用假的 `run` 和打桩的 `read_chunk`）：

```python
def test_reading_series_full_then_incremental(monkeypatch):
    calls = []
    def fake_chunk(tx, unit_id, reading, since_ms, until_ms, buckets):
        calls.append((since_ms, until_ms, buckets))
        at = datetime.fromtimestamp((until_ms - 1000) / 1000, UTC).isoformat()
        return [{"observed_at": at, "original": {"value_text": "6.5", "quality": "GOOD", "source_type": "DEVICE"}}]
    monkeypatch.setattr(market_export, "read_chunk", fake_chunk)
    run = lambda fn: fn(None)
    reading = REGISTRY["bases"][0]["ponds"][0]["readings"][0]
    full = market_export.reading_series(run, "U1", reading, [], "7d", NOW_MS, True)
    assert len(calls) == 7 and all(c[2] == 24 for c in calls) and len(full) == 7
    calls.clear()
    again = market_export.reading_series(run, "U1", reading, full, "7d", NOW_MS, False)
    assert calls == [] and again == full                                        # 没有新的整段，不查
    later = market_export.reading_series(run, "U1", reading, full, "7d", NOW_MS + 3_600_000, False)
    assert len(calls) == 1 and calls[0][2] == 1 and len(later) == 8             # 只补新出现的那一段
    assert later[0][0] >= market_export.window("7d", NOW_MS + 3_600_000)[0]

def test_export_company_keeps_previous_series_when_a_query_fails(tmp_path, monkeypatch):
    # 假 service：run(actor, org, fn) 直接 fn(tx)；tx.one 对登记返回 REGISTRY、对 overview_iot 返回 {"readings": [row()]}。
    # 第一轮 read_chunk 正常 → pond-yx-00.json 里 r1 三个范围都有点；
    # 第二轮让 read_chunk 对 r1 抛 RuntimeError → 返回值 failed_series == 1，文件里 r1 的点与第一轮相同，index.json 的 generated_at 已更新；
    # 第三轮把 REGISTRY 换成 bases: [] → index.json 的 bases 为 []，pond-yx-00.json 被删，返回值 removed == ["pond-yx-00.json"]。

def test_export_company_registry_failure_leaves_files_untouched(tmp_path, monkeypatch):
    # 先成功导出一轮并记下两份文件的字节；再让 tx.one 对登记抛错 → export_company 抛出，两份文件字节不变。
```

  追加到 `tests/farm/test_market_export_postgres.py`（连本机库，沿用 Task 1 的 `world`；用 `FarmService(PostgresFarmRepository(database), private_storage_root=tmp_path, load_alert_provider_from_environment=False, load_alert_channels_from_environment=False)`，写法照 `tests/farm/test_koi_summary.py` 里的 `task_service`——该文件在别的分支上，照其构造方式即可）：

```python
def test_export_once_writes_only_registered_pond_with_empty_readings(database, world, tmp_path):
    result = market_export.export_once(service(database, tmp_path), world.company_a, tmp_path, now=NOW)
    assert result["processed"] is True and result["ponds"] == 1
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert [p["code"] for b in index["bases"] for p in b["ponds"]] == ["ta-01"]
    assert all(r["value"] is None and r["observed_at"] is None for r in index["bases"][0]["ponds"][0]["readings"])   # 本机库里这口塘没有读数：出空读数而不是报错
    pond = json.loads((tmp_path / "pond-ta-01.json").read_text(encoding="utf-8"))
    assert pond["series"] == {"24h": [], "7d": [], "30d": []}
    text = (tmp_path / "index.json").read_text(encoding="utf-8")
    assert str(world.unit_u1) not in text and str(world.unit_u2) not in text and str(world.unit_u3) not in text and "tb-01" not in text
    assert sorted(p.name for p in tmp_path.iterdir()) == ["index.json", "pond-ta-01.json"]

def test_export_once_for_company_without_task_identity(database, world, tmp_path):   # 未启用农事的公司 C → {"processed": False, "state": "SCOPE_UNAVAILABLE"}，目录为空
```

- [ ] **Step 2: 运行确认失败** — `.venv/bin/python -m pytest tests/farm/test_market_export.py tests/farm/test_market_export_postgres.py -q`。
- [ ] **Step 3: 实现。**核对 `farm.iot_unit_telemetry` 在 `latest_only=false` 时返回的 jsonb 形状（对照 `src/huahai_iot_admin/farm_read.py:192-200` 的用法），`read_chunk` 统一返回条目列表。
- [ ] **Step 4: 运行确认通过** — 同上命令。
- [ ] **Step 5: 提交** — `git add src/huahai_iot_farm/market_export.py tests/farm/test_market_export.py tests/farm/test_market_export_postgres.py && git commit -m "feat(market-export): 以系统任务身份取数并完成一轮导出"`

### Task 4: 命令行入口与常驻循环

**Files:**
- Modify: `src/huahai_iot_farm/market_export.py`
- Test: `tests/farm/test_market_export.py`（追加）

**Interfaces:**
- Produces：

```python
def candidates(service, company_id: str, unit_id: str) -> list[dict]
    # 以系统任务身份读这口塘当前所有读数（overview_iot，metric 不限），每条只给 gateway_id / channel_id / metric_code / unit / name / value_text / observed_at / quality / source_type，供拟登记清单用
def run_forever(service, company_id: str, output_dir: Path, *, interval_seconds: int, stopping, company_name: str | None = None) -> None
def main(argv=None, *, service_factory=None) -> int
```

- 命令行：`python -m huahai_iot_farm.market_export --company-id <uuid> --output-dir <目录> --interval-seconds <60–3600> [--company-name <文字>] [--execute] [--once] [--print] [--candidates <unit uuid>]`。
  - 不带 `--execute`：只做检查（服务能建、`task_scopes.check(service)` 通过、输出目录存在且可写），打印一行通过说明，返回 0；不写任何文件。
  - `--execute --once`：跑一轮，`processed` 为真返回 0，否则 1。
  - `--execute`（不带 `--once`）：`run_forever`，每轮结束 `stopping.wait(interval_seconds)`；单轮异常只记日志、不退出；停止信号沿用 `runtime_tasks._stop_signals`。
  - `--print`：导出到临时目录后把 `index.json` 打到标准输出并删掉临时目录，不碰 `--output-dir`（给用户过目公开清单用）。
  - `--candidates`：把 `candidates` 的结果按行打到标准输出，不写文件。
  - 服务用 `(service_factory or runtime.build_farm_service)(load_alert_provider_from_environment=False, task="evaluate")` 建（借用 `evaluate` 的“不装任何外呼”配置；**不改 `runtime.py`**，避免与锦鲤分支改同一行任务名单）；返回 `None`（农事未启用）时打印原因并返回 1。
  - `--company-name` 不传时取环境变量 `HUAI_MARKET_COMPANY_NAME`，再没有就用系统里的公司名。
  - 任何出错路径都不打印异常原文（可能含连接串），只打印固定中文提示，返回 1。

- [ ] **Step 1: 写失败的测试**（追加；`service_factory` 传假服务，`export_once` 打桩）

```python
def test_main_check_only_writes_nothing(tmp_path, monkeypatch, capsys):   # 不带 --execute → 返回 0，目录仍为空，export_once 没被调用
def test_main_once_returns_1_when_not_processed(tmp_path, monkeypatch):    # export_once 返回 {"processed": False, "state": "SCOPE_UNAVAILABLE"} → 1
def test_main_rejects_bad_arguments(tmp_path):                             # 非 uuid 的 --company-id、间隔 30、输出目录不存在 → 返回非 0 且不建目录
def test_main_print_does_not_touch_output_dir(tmp_path, monkeypatch, capsys):   # --execute --print → 标准输出是合法 JSON 且含 "schema": 1；--output-dir 仍为空
def test_run_forever_survives_one_failed_round(tmp_path, monkeypatch):     # 第一轮 export_once 抛错、第二轮成功后置位 stopping → 共调用 2 次，函数正常返回
def test_main_hides_exception_text(tmp_path, monkeypatch, capsys):         # service_factory 抛 RuntimeError("postgresql://user:secret@host") → 输出里没有 "secret"，返回 1
```

- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行确认通过** — `.venv/bin/python -m pytest tests/farm/test_market_export.py -q`；在本机库上手动跑一次 `--execute --once`（公司用 Task 1 测试留下的数据或临时登记一口塘），确认目录里出现两份文件。
- [ ] **Step 5: 提交** — `git commit -m "feat(market-export): 命令行入口、常驻循环、公开清单预览与候选读数列表"`（先 `git add` 这两个文件）

### Task 5: 部署样例

**Files:**
- Create: `deploy/farm/huahai-farm-market-export.service.example`
- Create: `deploy/farm/farm-market-export.env.example`
- Create: `deploy/farm/nginx-market-live-vhost.conf.example`
- Create: `deploy/farm/market-public-register.sql.example`
- Test: `tests/farm/test_market_export_deploy.py`

**Interfaces:**
- 服务单元：整份照 `deploy/farm/huahai-farm-quality-reports.service.example` 的加固项，只改四处——`Description`；`EnvironmentFile=/etc/huahai-iot-admin/farm-market-export.env`；`ExecStart=/opt/huahai-iot-platform/.venv/bin/python -m huahai_iot_farm.market_export --company-id ${HUAI_MARKET_COMPANY_ID} --output-dir /var/lib/huahai-market-public/v1 --interval-seconds ${HUAI_FARM_TASK_INTERVAL_SECONDS} --execute`；新增 `ReadWritePaths=/var/lib/huahai-market-public`。
- 环境文件样例：`HUAI_FARM_TASK_INTERVAL_SECONDS=300`、`HUAI_MARKET_COMPANY_ID=<公司编号>`、可选的 `HUAI_MARKET_COMPANY_NAME=<对外显示的公司名>`，只写占位。
- nginx（新文件，不改现有任何配置；与现有内网转发共用同一个监听地址，靠 Host 名区分）：

```nginx
server {
    listen 172.17.228.115:18081;
    server_name market-live.internal;
    allow 172.17.228.114;
    deny all;
    access_log /var/log/nginx/huahai-market-live.access.log;
    location ~ ^/market-live/v1/(index|pond-[a-z0-9]+-[a-z0-9]+)\.json$ {
        alias /var/lib/huahai-market-public/v1/$1.json;
        limit_except GET HEAD { deny all; }
        types { }
        default_type application/json;
    }
    location / { return 404; }
}
```

- 登记样例（属主用 psql 执行；一个事务；全是占位符）：先 `INSERT … market_public_bases`，再 `market_public_ponds`，再逐条 `market_public_readings`；文件头用中文写清：公开标签必须重新拟、不得照抄现场填写的探头名称；`gateway_id` / `channel_id` / `metric_code` / `unit` 从 `--candidates` 的输出抄；登记完用 `--execute --print` 看结果；取消公开是把 `enabled` 改成 `false`（或删行）。

- [ ] **Step 1: 写失败的测试**

```python
def test_service_unit_runs_market_export_with_writable_public_dir():
    unit = Path("deploy/farm/huahai-farm-market-export.service.example").read_text(encoding="utf-8")
    assert "-m huahai_iot_farm.market_export" in unit and "--execute" in unit and "--output-dir /var/lib/huahai-market-public/v1" in unit
    assert "ReadWritePaths=/var/lib/huahai-market-public" in unit and "ProtectSystem=strict" in unit and "User=huahai-iot-admin" in unit
def test_nginx_vhost_is_intranet_only_and_serves_two_file_shapes():
    conf = Path("deploy/farm/nginx-market-live-vhost.conf.example").read_text(encoding="utf-8")
    assert "listen 172.17.228.115:18081;" in conf and "server_name market-live.internal;" in conf
    assert conf.index("allow 172.17.228.114;") < conf.index("deny all;")
    assert "alias /var/lib/huahai-market-public/v1/$1.json;" in conf and "location / { return 404; }" in conf
    assert "proxy_pass" not in conf and "autoindex" not in conf
def test_examples_contain_no_real_identifiers():
    for name in ("farm-market-export.env.example", "market-public-register.sql.example"):
        text = Path("deploy/farm", name).read_text(encoding="utf-8")
        assert re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text) is None
```

- [ ] **Step 2–4:** 运行确认失败 → 写四个文件 → `.venv/bin/python -m pytest tests/farm/test_market_export_deploy.py tests/test_deploy_assets.py -q` 通过。
- [ ] **Step 5: 提交** — `git commit -m "feat(market-export): 服务单元、内网只读站点与登记样例"`（先 `git add` 这五个文件）

### Task 6: 文档、与官网侧对接核对、收尾

**Files:**
- Create: `docs/MARKET_PUBLIC_EXPORT_DEPLOYMENT_20261126.md`
- Modify: `docs/README.md`

- [ ] **Step 1: 新建 `docs/MARKET_PUBLIC_EXPORT_DEPLOYMENT_20261126.md`**，写清：
  - 迁移 060 的执行命令（同 `docs/DEPLOYMENT.md` 里 `next/005` 的写法）与回退命令；迁移只加表和函数，不动现有对象。
  - 目录：`install -d -o huahai-iot-admin -g huahai-iot-admin -m 0755 /var/lib/huahai-market-public/v1`。
  - 登记步骤：`--candidates <塘>` 列出当前读数 → 拟公开清单（公开标签重新拟）→ **给用户过目** → 属主执行登记 SQL → `--execute --print` 再给用户看一遍最终公开内容。本期登记：阳江永兴基地（基地代号 `yx`）测试1塘，公开名“永兴 0 号塘”，塘代号 `yx-00`。
  - 安装单元并启动；**首轮要读满 30 天，可能跑几分钟**，之后每轮只补新段，每天 UTC 零点后的第一轮整体重读一次。
  - nginx：放入新的配置文件，`nginx -t` 后重载；在官网服务器上验证 `curl -H 'Host: market-live.internal' http://172.17.228.115:18081/market-live/v1/index.json` 为 200，`/market-live/v1/x.json` 为 404；从其他机器访问被拒。并用不带该 Host 的请求确认现有内网转发照常。
  - 运行须知：更换盒子或探头后登记的通道会失效，网页上该项显示“暂无读数”，需要重新登记；停止公开全部数据 = 停掉单元并清空输出目录。
  - 回退：停单元、删 nginx 配置并重载、执行迁移回退文件。
- [ ] **Step 2: `docs/README.md` 登记** 迁移、模块、部署样例与本计划。
- [ ] **Step 3: 与官网侧对接核对**（爱买买仓库的网站侧计划 Task 6 完成后做；没完成就在收尾说明里写明这一步未做）：在本机库上 `--execute --once` 导出到临时目录 A，再运行官网侧取回脚本 `python3 <爱买买仓库>/huahai-market-site/deploy/live-fetch/fetch_live.py --source file://A/ --dest B`，预期返回 0 且 B 里两份文件内容与 A 等价。这一步证明导出严格符合数据契约 v1。
- [ ] **Step 4: 全量验证** — `.venv/bin/python -m pytest tests/farm/test_market_export.py tests/farm/test_market_export_postgres.py tests/farm/test_market_export_deploy.py tests/farm/test_task_scopes.py tests/test_deploy_assets.py -q` 与 `ruff check src/huahai_iot_farm/market_export.py tests/farm/test_market_export*.py`。
- [ ] **Step 5: 独立只读审查**（Sonnet、effort high）：对照设计稿“绝不能出现”清单、本计划 Global Constraints 和 Review Focus 检查全部改动；重点看有没有任何路径把内部编号、现场名称或未登记的塘写进输出，以及有没有动到现有函数。High / Critical 全修。
- [ ] **Step 6: 提交** — `git commit -m "docs(market-export): 部署、登记与回退步骤"`（先 `git add` 这两个文件）。不推送、不部署；向用户说明并等待放行。收尾时停掉本机测试库：`HUAI_TEST_PG_NAME=huahai-market-pg16 scripts/dev/live_test_db.sh down`。
