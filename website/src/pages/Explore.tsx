import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { APP_DOWNLOAD_PAGE, MINI_PROGRAM_QR_IMAGE, MINI_PROGRAM_URL_LINK } from '@/lib/exploreLinks'
import '@/styles/explore.css'

type Modal = 'mini' | 'app' | 'wechat' | null
type IconName = 'leaf' | 'bag' | 'phone' | 'wechat' | 'truck' | 'order' | 'expand' | 'close'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    leaf: <><path d="M20 4c0 10-4 16-11 16-4 0-6-3-5-6C6 6 14 9 20 4Z" /><path d="m4 21 10-10" /></>,
    bag: <><path d="M5 7h14l2 14H3L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 18h4" /></>,
    wechat: <><path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L3 21l1.8-5A9 9 0 1 1 21 11Z" /><path d="M8 10h.01M16 10h.01" /></>,
    truck: <><path d="M1 4h13v13H1ZM14 9h4l4 5v3h-8" /><circle cx="5" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    order: <><path d="M5 3h14v19l-3-2-4 2-4-2-3 2V3Z" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function Explore() {
  const [modal, setModal] = useState<Modal>(null)
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>(MINI_PROGRAM_QR_IMAGE ? 'loading' : 'error')
  const [imageAttempt, setImageAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const inWechat = /micromessenger/i.test(navigator.userAgent)
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const miniReady = imageState === 'ready'

  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal()
    if (!modal && dialog.current?.open) dialog.current.close()
  }, [modal])

  const openMiniProgram = () => {
    if (inWechat && MINI_PROGRAM_URL_LINK) window.location.assign(MINI_PROGRAM_URL_LINK)
    else setModal('mini')
  }

  const appQr = (large = false) => <QRCodeSVG
    value={APP_DOWNLOAD_PAGE}
    size={large ? 320 : 208}
    level="M"
    marginSize={4}
    fgColor="#173e32"
    bgColor="#ffffff"
    title="爱买买 App 下载二维码"
  />

  return <div className="explore-page">
    <a className="skip-to-content" href="#explore-content">跳到介绍与扫码入口</a>
    <header className="explore-nav explore-container">
      <Link to="/" className="explore-brand" aria-label="爱买买官网首页"><img src="/logo.png" alt="" width="40" height="40" /><strong>爱买买</strong><span>农产品购物平台</span></Link>
      <a href="#explore-about">了解爱买买</a>
    </header>
    <div className="explore-container" id="explore-content">
      <section className="explore-hero" aria-labelledby="explore-title">
        <div className="explore-copy">
          <h1 id="explore-title">从产地，<br />到你的餐桌。</h1>
          <p>爱买买连接农业商家与消费者，<br className="explore-wide-break" />让选购农产品更方便。</p>
          <div className="explore-categories" aria-label="农产品类别"><Icon name="leaf" /><span>蔬果</span><span>水产</span><span>粮油</span></div>
          <p className="explore-choice">选择你习惯的方式，开始逛逛。</p>
        </div>
        <div className="explore-access" aria-label="小程序与 App 入口">
          <article className="explore-code-card explore-mini-card">
            <div className="explore-card-title"><Icon name="wechat" /><h2>微信小程序</h2><span>推荐</span></div>
            <p>微信扫一扫，打开就能逛</p>
            <div className="explore-qr-frame" aria-busy={imageState === 'loading'}>
              {MINI_PROGRAM_QR_IMAGE && imageState !== 'error' && <img
                key={imageAttempt}
                src={MINI_PROGRAM_QR_IMAGE}
                alt="爱买买微信小程序首页码"
                width="208"
                height="208"
                onLoad={() => setImageState('ready')}
                onError={() => setImageState('error')}
              />}
              {imageState !== 'ready' && <div className="explore-qr-status" role="status">
                <Icon name="wechat" />
                <strong>{imageState === 'loading' ? '正在加载小程序码' : MINI_PROGRAM_QR_IMAGE ? '小程序码暂时未能加载' : '小程序入口准备中'}</strong>
                <span>{imageState === 'loading' ? '请稍候' : isIos ? '请稍后重试，或在微信中搜索「AI爱买买」' : '你也可以使用 App 下载入口'}</span>
                {MINI_PROGRAM_QR_IMAGE && imageState === 'error' && <button type="button" onClick={() => { setImageAttempt(value => value + 1); setImageState('loading') }}>重新加载</button>}
              </div>}
            </div>
            <p className="explore-instruction">无需下载安装</p>
            {MINI_PROGRAM_URL_LINK && <button type="button" className="explore-action explore-primary explore-mobile-action" onClick={openMiniProgram}>打开微信小程序</button>}
            <button type="button" className="explore-action explore-primary" disabled={!miniReady} onClick={() => setModal('mini')}>放大小程序码<Icon name="expand" /></button>
          </article>
          <article className="explore-code-card">
            <div className="explore-card-title"><Icon name="phone" /><h2>爱买买 App</h2></div>
            <p>手机扫码，前往下载页面</p>
            <div className="explore-qr-frame">{appQr()}</div>
            <p className="explore-instruction">安卓版 · 通过下载页选择渠道</p>
            {!isIos && <a className="explore-action explore-primary explore-mobile-action" href={APP_DOWNLOAD_PAGE} onClick={event => { if (inWechat) { event.preventDefault(); setModal('wechat') } }}>前往 App 下载页</a>}
            <button type="button" className="explore-action" onClick={() => setModal('app')}>放大下载码<Icon name="expand" /></button>
          </article>
          <p className="explore-ios">使用 iPhone？可通过微信小程序体验。</p>
        </div>
      </section>
      <section className="explore-about" id="explore-about" aria-labelledby="explore-about-title">
        <div><p className="explore-section-label">认识爱买买</p><h2 id="explore-about-title">把日常所需，<br />放进你的菜篮子。</h2></div>
        <article><Icon name="bag" /><h3>选购农产品</h3><p>浏览商品与商家信息，<br />按自己的需要挑选。</p></article>
        <article><Icon name="truck" /><h3>选择收货方式</h3><p>按商品和地址支持情况，<br />选择配送或到店自提。</p></article>
        <article><Icon name="order" /><h3>管理购物订单</h3><p>查看订单进度，<br />需要帮助时联系客服。</p></article>
      </section>
    </div>
    <footer className="explore-footer"><div className="explore-container"><div><strong>爱买买</strong><span>连接农业商家与消费者</span></div><nav aria-label="网站信息"><Link to="/">官网首页</Link><Link to="/privacy">隐私政策</Link><Link to="/terms">服务条款</Link><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">粤ICP备2023047684号</a></nav><small>© {new Date().getFullYear()} 深圳华海农业科技集团有限公司</small></div></footer>
    <dialog className="explore-dialog" ref={dialog} aria-labelledby="explore-dialog-title" onClose={() => setModal(null)} onCancel={() => setModal(null)}>
      <header><h2 id="explore-dialog-title">{modal === 'mini' ? '微信小程序' : modal === 'wechat' ? '在浏览器中下载 App' : '爱买买 App'}</h2><button type="button" aria-label="关闭" onClick={() => setModal(null)}><Icon name="close" /></button></header>
      {modal === 'wechat' ? <div className="explore-wechat-guide"><p>点击微信右上角「···」，选择「在浏览器中打开」，再前往 App 下载页。</p><a className="explore-action" href={APP_DOWNLOAD_PAGE}>先打开下载页</a></div> : <>
        <div className="explore-large-qr">{modal === 'mini'
          ? miniReady ? <img src={MINI_PROGRAM_QR_IMAGE} alt="爱买买微信小程序首页码" width="320" height="320" onError={() => setImageState('error')} /> : <p role="status">小程序码暂时无法显示，请关闭后重新加载。</p>
          : appQr(true)}</div>
        <p>{modal === 'mini' ? '使用微信扫一扫。手机上可保存图片，再到微信「扫一扫」相册中选择识别。' : '手机扫码进入下载页。微信内请按页面提示在浏览器中打开。'}</p>
        {modal === 'mini' && miniReady && <a className="explore-action" href={MINI_PROGRAM_QR_IMAGE} download="爱买买小程序码.png" target="_blank" rel="noopener noreferrer">打开原图 / 保存小程序码</a>}
        {modal === 'mini' && inWechat && MINI_PROGRAM_URL_LINK && <a className="explore-action explore-primary" href={MINI_PROGRAM_URL_LINK}>打开微信小程序</a>}
      </>}
    </dialog>
  </div>
}
