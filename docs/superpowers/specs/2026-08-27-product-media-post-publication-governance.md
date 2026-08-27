# 商品图片即时发布与事后巡检设计

> 状态：本地候选已实现并完成定向验证；尚未运行迁移、推送、部署或进行真实模型验收。
>
> 本设计替代此前“已上架商品图片变更必须平台预审批”的规则。它只改变商品公开图片的治理时机；受管资产、事实硬门禁、原图证据、版本 CAS 和完整审计仍为必需。

## 1. 产品决策

商家更换已上架商品图片时，不再等待平台预审批。商家确认采用 AI 候选或提交新的受管媒体后，公开图片立即切换。

平台改为事后巡检：管理员可以查看近期发布的图片变更，发现不符合规则时，将商品恢复到该次变更前的历史图片，并向商家中心发送通知。

这不是“取消安全”：系统对已知事实错误仍 fail-closed。检测到二维码丢失/变化、条码格式变化、破坏性裁切或其它明确事实错误的 AI 候选，不允许商家采用；无法确认的情形可先发布，但标记为巡检优先。

## 2. 商家流程

```text
商家点击“确认采用 AI 候选”
  ├─ 草稿/未上架：直接采用到草稿媒体
  └─ ACTIVE + APPROVED：
       1. 验证候选、原图证据、商家三项确认、图片数上限
       2. 创建不可变历史版本记录
       3. CAS 原子替换 ProductMedia，mediaVersion +1
       4. 立即返回“公开图已更新，平台可后续巡检”
```

手工上传的已上架商品图片变更遵循相同规则：即时替换并留下历史版本。商家不再看到“提交封面审核”作为发布前门槛。

## 3. 历史与并发安全

每次即时变更写一条 `ProductMediaRevision` 历史记录：

- `status=APPLIED_BY_SELLER`；
- `previousMedia`：替换前的完整媒体快照；
- `proposedMedia`：替换后的完整媒体快照；
- `expectedMediaVersion` 与 `appliedMediaVersion`；
- 商家确认、AI 验真摘要、候选/原图证据和操作人。

更新 ProductMedia 时，`Product.mediaVersion` 必须与 `expectedMediaVersion` CAS 匹配。若并发更新，则不替换、不创建错误历史，商家刷新后重试。

## 4. 管理员巡检和回滚

管理员后台“封面变更审核”改为“商品图片巡检与回滚”：展示近期 `APPLIED_BY_SELLER` 记录的变更前/变更后图片、商家确认与最小验真摘要。

回滚必须满足：

1. 选择的记录仍是该商品当前公开媒体对应的最新发布版本；
2. Product 的 `mediaVersion == appliedMediaVersion`；
3. 用 CAS 将媒体恢复到 `previousMedia`，并使 `mediaVersion +1`；
4. 原记录标记为 `ROLLED_BACK_BY_ADMIN`，记录管理员、原因和时间；
5. 写商家中心通知 `product.mediaRolledBackForSeller`，包含商品、回滚原因和商品详情入口。

若后续商家已更新图片，管理员不能静默覆盖新版本；回滚请求返回冲突并要求管理员刷新后检查最新历史。

## 5. 数据与状态改动

`ProductMediaRevisionStatus` 新增：

- `APPLIED_BY_SELLER`
- `ROLLED_BACK_BY_ADMIN`

`ProductMediaRevision` 新增：

- `previousMedia Json?`
- `appliedMediaVersion Int?`
- `rolledBackAt DateTime?`

保留原来的 `PENDING_REVIEW/APPROVED/REJECTED/...` 仅用于历史遗留记录的兼容读取，不再为新图片采用创建待审批记录。

## 6. 不变的边界

- 商家不能传入任意 URL、提示词、模型 ID 或 Provider URL；
- AI 候选仍保留原实拍证据；
- 已知事实错误的候选仍不能即时发布；
- 平台回滚不删除历史、候选或审计证据；
- 事后巡检不代表平台可以任意编辑商家图片，只能恢复到已记录的历史版本；
- 本设计不授权迁移、推送、部署或真实模型调用。
- 即时替换当前只支持完全由受管静态图片组成的商品媒体；含视频或历史任意 URL 的商品会安全拒绝，避免图片操作误删或误标其他媒体。该兼容扩展需要单独设计。
