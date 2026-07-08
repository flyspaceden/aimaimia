# H5 Invite WeChat Login Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add H5 WeChat auxiliary login to the existing invite landing page while keeping phone SMS as the primary path and reusing the existing invite binding service.

**Architecture:** Backend adds H5-specific WeChat OAuth start/login endpoints under Auth, then funnels both App and H5 WeChat identities through one internal `loginOrCreateWechatUser` path with `unionId` priority. Website keeps the current phone-first form, adds a secondary WeChat button, handles callback query state, and preserves responsive constraints across mobile, tablet, and desktop.

**Tech Stack:** NestJS + Prisma + Jest for backend; Vite React + TypeScript + node:test static tests for website; existing `InviteH5Service.bindAfterAuth()` for referral binding.

---

## File Structure

- Modify `backend/src/modules/auth/auth.controller.ts`
  - Add public `GET /auth/h5-wechat/start` and `POST /auth/h5-wechat/invite-login`.
- Modify `backend/src/modules/auth/auth.service.ts`
  - Extract shared WeChat identity login/create logic.
  - Add H5 state signing/verification.
  - Add H5 WeChat code exchange with `WECHAT_H5_*` config.
  - Call `InviteH5Service.bindAfterAuth()` after H5 WeChat auth.
- Modify `backend/src/modules/auth/dto/send-code.dto.ts`
  - Add DTOs for H5 WeChat start/login query/body validation.
- Modify `backend/src/modules/auth/auth.service.spec.ts`
  - Add tests for H5 state generation, unionId identity reuse, and invite binding.
- Modify `website/src/lib/inviteH5.ts`
  - Add helpers for WeChat auth URL/callback parsing and response state reuse.
- Modify `website/src/pages/InviteAuthLanding.tsx`
  - Add secondary WeChat login button below phone form.
  - Add callback handler for `code/state` or `wechatCode/state`.
  - Keep phone form primary and responsive.
- Modify `website/scripts/__tests__/inviteH5.test.mjs`
  - Add static/behavior tests for phone-first layout, WeChat button placement, callback call, non-WeChat fallback, and responsive classes.
- Optionally modify `docs/superpowers/specs/2026-07-08-h5-invite-wechat-login-design.md`
  - Only if implementation reveals a necessary clarified boundary.

## Chunk 1: Backend Auth

### Task 1: Add failing backend tests

**Files:**
- Modify: `backend/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```ts
it('builds H5 WeChat auth URL with signed state containing invite context', async () => {
  const { service } = makeService(makePrisma());
  const url = service.buildH5WechatAuthUrl({
    inviteCode: 'SABC1234',
    landingSessionId: 'ih5_session_1',
  });
  expect(url).toContain('https://open.weixin.qq.com/connect/oauth2/authorize');
  expect(url).toContain('appid=stub-WECHAT_H5_APP_ID');
  expect(url).toContain('scope=snsapi_userinfo');
  expect(url).toContain('state=');
});

it('H5 WeChat invite login reuses unionId identity and binds after auth', async () => {
  // Mock code exchange to return openId from H5 and unionId matching existing App identity.
  // Expect no user.create and InviteH5Service.bindAfterAuth called with existing userId.
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
cd backend
npx jest src/modules/auth/auth.service.spec.ts --runInBand --noStackTrace
```

Expected: FAIL because H5 WeChat methods do not exist.

### Task 2: Implement shared WeChat identity logic

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/dto/send-code.dto.ts`

- [ ] **Step 1: Add DTOs**

Add:

```ts
export class H5WechatStartQueryDto {
  @IsString()
  @Length(8, 8)
  inviteCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  landingSessionId?: string;
}

export class H5WechatInviteLoginDto {
  @IsString()
  @Length(1, 256)
  wechatCode: string;

  @IsString()
  @Length(16, 2048)
  state: string;

  @IsString()
  @Length(8, 8)
  inviteCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  landingSessionId?: string;
}
```

- [ ] **Step 2: Extract identity logic**

Create private `loginOrCreateWechatUser(profile)` used by existing `loginWithWeChat()` and new H5 login.

Rules:
- If `unionId` exists, search `AuthIdentity` by `provider=WECHAT` and `unionId`.
- Fallback to `provider=WECHAT`, `identifier=openId`, and either matching `appId` or `appId=null` for legacy rows.
- Existing user must be `ACTIVE`.
- New identity stores `identifier=openId`, `unionId`, `appId`, `verified=true`, and profile snapshot in `meta`.

- [ ] **Step 3: Add H5 state helpers**

Implement:

```ts
buildH5WechatAuthUrl(input)
verifyH5WechatState(state)
```

Use HMAC SHA-256 with `WECHAT_H5_AUTH_STATE_SECRET`, fallback to `JWT_SECRET` in non-production tests only. State payload contains `inviteCode`, optional `landingSessionId`, `nonce`, and `iat`; reject malformed, mismatched, or older than 10 minutes.

- [ ] **Step 4: Add H5 invite login**

Implement:

```ts
async h5WechatInviteLogin(dto: H5WechatInviteLoginDto)
```

It verifies state, exchanges `wechatCode` using H5 service-account config, logs/creates the user through `loginOrCreateWechatUser`, calls `InviteH5Service.bindAfterAuth()`, and returns session plus `inviteBinding`.

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd backend
npx jest src/modules/auth/auth.service.spec.ts --runInBand --noStackTrace
```

Expected: PASS.

### Task 3: Wire backend controller

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Add controller routes**

Add:

```ts
@Public()
@Get('h5-wechat/start')
startH5WechatLogin(@Query() dto: H5WechatStartQueryDto, @Res() res: Response) {
  return res.redirect(this.authService.buildH5WechatAuthUrl(dto));
}

@Public()
@Post('h5-wechat/invite-login')
h5WechatInviteLogin(@Body() dto: H5WechatInviteLoginDto) {
  return this.authService.h5WechatInviteLogin(dto);
}
```

- [ ] **Step 2: Run backend targeted tests**

Run:

```bash
cd backend
npx jest src/modules/auth/auth.service.spec.ts src/modules/invite-h5 --runInBand --noStackTrace
```

Expected: PASS.

## Chunk 2: Website H5 Page

### Task 4: Add failing website tests

**Files:**
- Modify: `website/scripts/__tests__/inviteH5.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```js
test('H5 invite page is phone-first with WeChat as secondary action', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')
  assert.match(page, /手机号登录/)
  assert.match(page, /登录并绑定/)
  assert.match(page, /微信登录/)
  assert.ok(page.indexOf('登录并绑定') < page.indexOf('微信登录'))
  assert.doesNotMatch(page, /登录成功后自动记录推荐关系/)
})

test('H5 invite page handles WeChat callback and non-WeChat fallback', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')
  assert.match(page, /h5-wechat\\/invite-login/)
  assert.match(page, /h5-wechat\\/start/)
  assert.match(page, /请在微信中打开，或使用手机号登录/)
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
cd website
npm run test:invite-h5
```

Expected: FAIL because WeChat button/callback code is missing.

### Task 5: Implement website helpers and page behavior

**Files:**
- Modify: `website/src/lib/inviteH5.ts`
- Modify: `website/src/pages/InviteAuthLanding.tsx`

- [ ] **Step 1: Add helper functions**

Add helper functions for:
- extracting `wechatCode` from `wechatCode` or WeChat's `code` query param,
- checking `state`,
- building `/auth/h5-wechat/start` URL.

- [ ] **Step 2: Add callback effect**

In `InviteAuthLanding`, after invite code is known:
- detect `wechatCode` + `state`,
- call `POST /auth/h5-wechat/invite-login`,
- store tokens in sessionStorage,
- set `loginCompleted`,
- render binding result using existing `bindingStatusText()` / `submitStateForBindingStatus()`,
- clean callback query from browser history.

- [ ] **Step 3: Add secondary WeChat button**

Place below phone submit button separated by “也可以使用”.

Behavior:
- If not in WeChat browser, show error notice: `请在微信中打开，或使用手机号登录`.
- If in WeChat browser, redirect to `/auth/h5-wechat/start?inviteCode=...&landingSessionId=...`.
- Keep `登录并绑定` as the primary visual CTA.

- [ ] **Step 4: Tighten responsive classes**

Use a stable centered container:
- `w-full max-w-[480px]`
- mobile `px-4`/`px-5`
- code row `grid-cols-1 min-[360px]:grid-cols-[1fr_112px]`
- buttons full width with fixed height and no horizontal overflow.

- [ ] **Step 5: Run website tests**

Run:

```bash
cd website
npm run test:invite-h5
```

Expected: PASS.

## Chunk 3: Verification and Documentation

### Task 6: Run full targeted verification

**Files:** No new files.

- [ ] **Step 1: Backend verification**

Run:

```bash
cd backend
npx jest src/modules/auth/auth.service.spec.ts src/modules/invite-h5 --runInBand --noStackTrace
DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma validate
DATABASE_URL='postgresql://user:pass@localhost:5432/nongmai' npx prisma generate
npm run build
```

- [ ] **Step 2: Website verification**

Run:

```bash
cd website
npm run test:invite-h5
npm run build
```

- [ ] **Step 3: App/static regression**

Run:

```bash
node --test scripts/__tests__/app-h5-invite-link.test.mjs scripts/__tests__/app-referral-center.test.mjs
npx tsc --noEmit
git diff --check
```

### Task 7: Commit implementation

**Files:** All modified implementation and tests.

- [ ] **Step 1: Review diff**

Run:

```bash
git status --short
git diff --stat
```

- [ ] **Step 2: Commit**

Run:

```bash
git add backend/src/modules/auth/auth.controller.ts \
  backend/src/modules/auth/auth.service.ts \
  backend/src/modules/auth/dto/send-code.dto.ts \
  backend/src/modules/auth/auth.service.spec.ts \
  website/src/lib/inviteH5.ts \
  website/src/pages/InviteAuthLanding.tsx \
  website/scripts/__tests__/inviteH5.test.mjs
git commit -m "feat: add h5 invite wechat login"
```
