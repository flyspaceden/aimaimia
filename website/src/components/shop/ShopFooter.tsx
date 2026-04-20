// website/src/components/shop/ShopFooter.tsx
import { Link } from 'react-router-dom'

export default function ShopFooter() {
  return (
    <footer className="bg-brand-dark text-white/70 text-sm mt-auto">
      <div className="max-w-page mx-auto px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div>
            <div className="text-white font-bold text-base mb-3">🛒 爱买买生鲜</div>
            <p className="text-xs leading-relaxed">
              广东本地生鲜直销平台，专注粤港澳优质农产品直供，每日清晨直采，冷链直送到家。
            </p>
          </div>
          <div>
            <div className="text-white/90 font-semibold mb-3">快速入口</div>
            <div className="flex flex-col gap-2 text-xs">
              <Link to="/shop" className="hover:text-white transition-colors">商城首页</Link>
              <Link to="/shop/category/seafood" className="hover:text-white transition-colors">海鲜水产</Link>
              <Link to="/shop/cart" className="hover:text-white transition-colors">我的购物车</Link>
              <Link to="/shop/user" className="hover:text-white transition-colors">个人中心</Link>
            </div>
          </div>
          <div>
            <div className="text-white/90 font-semibold mb-3">客户服务</div>
            <div className="flex flex-col gap-2 text-xs">
              <span>客服热线：400-888-8888</span>
              <span>服务时间：08:00–22:00</span>
              <span>企业邮箱：service@ai-maimai.com</span>
              <Link to="/" className="hover:text-white transition-colors mt-1">返回官网 →</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-4 text-xs text-center space-y-1">
          <p>© 2026 深圳华海农业科技集团有限公司 版权所有</p>
          <p className="space-x-3">
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">粤ICP备2023047684号-3</a>
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">粤ICP备2023047684号-5</a>
          </p>
          <p>本平台所有商品均经严格质检，如有质量问题请联系客服</p>
        </div>
      </div>
    </footer>
  )
}
