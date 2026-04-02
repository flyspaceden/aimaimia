import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import ScrollReveal from "@/components/effects/ScrollReveal";
import Button from "@/components/ui/Button";
import { getCaptcha, submitMerchantApplication } from "@/lib/api";

const CATEGORIES = [
  "水果生鲜",
  "蔬菜菌菇",
  "粮油米面",
  "肉禽蛋奶",
  "茶叶饮品",
  "滋补养生",
  "休闲零食",
  "其他",
];

const ALLOWED_FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const inputClass =
  "w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition-colors";
const labelClass = "block text-sm font-medium text-text-primary mb-1.5";

export default function MerchantApply() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 表单字段
  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");

  // 验证码
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);

  // 提交状态
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const data = await getCaptcha();
      setCaptchaId(data.captchaId);
      setCaptchaSvg(data.svg);
      setCaptchaInput("");
    } catch {
      // 验证码加载失败时静默处理，用户可点击刷新
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  function validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (!companyName.trim()) {
      errors.companyName = "请输入企业/店铺名称";
    } else if (
      companyName.trim().length < 2 ||
      companyName.trim().length > 50
    ) {
      errors.companyName = "名称长度需在 2-50 字之间";
    }

    if (!category) {
      errors.category = "请选择经营品类";
    }

    if (!contactName.trim()) {
      errors.contactName = "请输入联系人姓名";
    } else if (
      contactName.trim().length < 2 ||
      contactName.trim().length > 20
    ) {
      errors.contactName = "姓名长度需在 2-20 字之间";
    }

    if (!phone.trim()) {
      errors.phone = "请输入手机号";
    } else if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      errors.phone = "请输入正确的手机号";
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "请输入正确的邮箱地址";
    }

    if (!file) {
      errors.file = "请上传营业执照";
    }

    if (!captchaInput.trim()) {
      errors.captcha = "请输入验证码";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!ALLOWED_FILE_TYPES.includes(selected.type)) {
      setFieldErrors((prev) => ({
        ...prev,
        file: "仅支持 JPG、PNG、PDF 格式",
      }));
      e.target.value = "";
      return;
    }

    if (selected.size > MAX_FILE_SIZE) {
      setFieldErrors((prev) => ({ ...prev, file: "文件大小不能超过 5MB" }));
      e.target.value = "";
      return;
    }

    setFile(selected);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.file;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("companyName", companyName.trim());
      formData.append("category", category);
      formData.append("contactName", contactName.trim());
      formData.append("phone", phone.trim());
      if (email.trim()) formData.append("email", email.trim());
      if (file) formData.append("licenseFile", file!);
      formData.append("captchaId", captchaId);
      formData.append("captchaCode", captchaInput.trim());

      await submitMerchantApplication(formData);
      setSuccess(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "提交失败，请稍后重试";
      setError(message);
      // 提交失败后刷新验证码
      loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  }

  // 提交成功页面
  if (success) {
    return (
      <div className="min-h-screen pt-32 pb-20 bg-light-bg">
        <div className="max-w-lg mx-auto px-6">
          <ScrollReveal>
            <div className="bg-white rounded-card-lg p-8 shadow-card text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-brand to-ai-start flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-h2 text-text-primary mb-3">申请已提交</h2>
              <p className="text-text-secondary mb-2">
                我们将在 1-3 个工作日内完成审核
              </p>
              <p className="text-text-tertiary text-sm mb-8">
                审核结果将通过短信通知到您的手机
              </p>
              <Button size="lg" onClick={() => navigate("/merchants")}>
                返回商户入驻页
              </Button>
            </div>
          </ScrollReveal>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-32 pb-20 bg-light-bg">
      <div className="max-w-2xl mx-auto px-6">
        <ScrollReveal>
          <div className="text-center mb-10">
            <h1 className="text-h1-mobile md:text-h1 text-text-primary mb-3">
              商户入驻申请
            </h1>
            <p className="text-text-secondary">
              填写以下信息，开启您的农业直销之旅
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-card-lg p-8 shadow-card space-y-6"
          >
            {/* 企业/店铺名称 */}
            <div>
              <label htmlFor="companyName" className={labelClass}>
                企业/店铺名称 *
              </label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={inputClass}
                placeholder="请输入企业或店铺名称"
                maxLength={50}
              />
              {fieldErrors.companyName && (
                <p className="mt-1 text-sm text-red-500">
                  {fieldErrors.companyName}
                </p>
              )}
            </div>

            {/* 经营品类 */}
            <div>
              <label htmlFor="category" className={labelClass}>
                经营品类 *
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              >
                <option value="">请选择经营品类</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <p className="mt-1 text-sm text-red-500">
                  {fieldErrors.category}
                </p>
              )}
            </div>

            {/* 联系人姓名 */}
            <div>
              <label htmlFor="contactName" className={labelClass}>
                联系人姓名 *
              </label>
              <input
                id="contactName"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={inputClass}
                placeholder="请输入联系人姓名"
                maxLength={20}
              />
              {fieldErrors.contactName && (
                <p className="mt-1 text-sm text-red-500">
                  {fieldErrors.contactName}
                </p>
              )}
            </div>

            {/* 手机号 */}
            <div>
              <label htmlFor="phone" className={labelClass}>
                手机号 *
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                placeholder="请输入手机号"
                maxLength={11}
              />
              {fieldErrors.phone && (
                <p className="mt-1 text-sm text-red-500">{fieldErrors.phone}</p>
              )}
            </div>

            {/* 邮箱（选填） */}
            <div>
              <label htmlFor="email" className={labelClass}>
                邮箱{" "}
                <span className="text-text-tertiary font-normal">(选填)</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="your@163.com"
              />
              {fieldErrors.email && (
                <p className="mt-1 text-sm text-red-500">{fieldErrors.email}</p>
              )}
            </div>

            {/* 营业执照上传 */}
            <div>
              <label className={labelClass}>
                营业执照 <span className="text-red-500">*</span>{" "}
                <span className="text-text-tertiary font-normal">
                  (支持 JPG/PNG/PDF，最大 5MB)
                </span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-4 py-6 rounded-lg border-2 border-dashed border-gray-200 hover:border-brand/40 transition-colors cursor-pointer text-center"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="w-5 h-5 text-brand"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <span className="text-text-primary text-sm">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                      className="ml-2 text-text-tertiary hover:text-red-500 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="text-text-tertiary">
                    <svg
                      className="w-8 h-8 mx-auto mb-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <p className="text-sm">点击上传营业执照</p>
                  </div>
                )}
              </div>
              {fieldErrors.file && (
                <p className="mt-1 text-sm text-red-500">{fieldErrors.file}</p>
              )}
            </div>

            {/* 验证码 */}
            <div>
              <label htmlFor="captcha" className={labelClass}>
                验证码 *
              </label>
              <div className="flex gap-3">
                <input
                  id="captcha"
                  type="text"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  className={`${inputClass} flex-1`}
                  placeholder="请输入验证码"
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={loadCaptcha}
                  disabled={captchaLoading}
                  className="shrink-0 w-32 h-[50px] rounded-lg border border-gray-200 overflow-hidden bg-gray-50 hover:border-brand/40 transition-colors cursor-pointer flex items-center justify-center"
                  title="点击刷新验证码"
                >
                  {captchaLoading ? (
                    <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                  ) : captchaSvg ? (
                    <div dangerouslySetInnerHTML={{ __html: captchaSvg }} />
                  ) : (
                    <span className="text-text-tertiary text-xs">点击加载</span>
                  )}
                </button>
              </div>
              {fieldErrors.captcha && (
                <p className="mt-1 text-sm text-red-500">
                  {fieldErrors.captcha}
                </p>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {/* 提交按钮 */}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting}
            >
              {submitting ? "提交中..." : "提交入驻申请"}
            </Button>

            <p className="text-text-tertiary text-xs text-center">
              提交即表示您同意平台的《商户入驻协议》和《隐私政策》
            </p>
          </form>
        </ScrollReveal>
      </div>
    </div>
  );
}
