import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-dark-bg text-text-on-dark-secondary">
      <div className="max-w-page mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* 品牌 */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="AI爱买买" className="h-8 w-auto" />
              <span className="text-white font-bold text-lg">AI爱买买</span>
            </div>
            <p className="text-sm leading-relaxed">
              AI赋能农业直销平台<br />
              从田间到餐桌的AI连接
            </p>
          </div>

          {/* 产品 */}
          <div>
            <h4 className="text-white font-semibold mb-4">产品</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/products" className="hover:text-white transition-colors">买家 App</Link></li>
              <li><Link to="/products" className="hover:text-white transition-colors">卖家后台</Link></li>
              <li><Link to="/products" className="hover:text-white transition-colors">管理平台</Link></li>
            </ul>
          </div>

          {/* 技术 */}
          <div>
            <h4 className="text-white font-semibold mb-4">技术</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/ai" className="hover:text-white transition-colors">AI 溯源</Link></li>
              <li><Link to="/ai" className="hover:text-white transition-colors">AI搜索</Link></li>
              <li><Link to="/ai" className="hover:text-white transition-colors">语音助手</Link></li>
            </ul>
          </div>

          {/* 合作 */}
          <div>
            <h4 className="text-white font-semibold mb-4">合作</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/merchants" className="hover:text-white transition-colors">商户入驻</Link></li>
              <li><Link to="/about" className="hover:text-white transition-colors">关于我们</Link></li>
              <li><Link to="/contact" className="hover:text-white transition-colors">联系我们</Link></li>
            </ul>
          </div>
        </div>

        {/* 底部 */}
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm">
          <span>© 2026 深圳华海农业科技集团有限公司 All rights reserved</span>
          <div className="flex gap-6">
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">粤ICP备2023047684号</a>
            <a href="#" className="hover:text-white transition-colors">隐私政策</a>
            <a href="#" className="hover:text-white transition-colors">服务条款</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
