import { useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Button from './Button'

interface Props {
  open: boolean
  onClose: () => void
}

export default function DownloadModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/60 bg-white rounded-card-lg p-8 max-w-sm mx-auto"
      onClose={onClose}
    >
      <div className="text-center">
        <h3 className="text-h3 text-text-primary mb-2">下载AI爱买买 App</h3>
        <p className="text-text-secondary mb-6">扫描二维码下载，或等待应用商店上架</p>

        {/* 下载二维码 */}
        <div className="w-52 h-52 mx-auto bg-light-surface rounded-card flex items-center justify-center mb-6 border border-light-soft p-4">
          <QRCodeSVG
            value={`${window.location.origin}/aimaimia/download`}
            size={176}
            fgColor="#1a2744"
            bgColor="#f8f9fa"
          />
        </div>

        <p className="text-sm text-ai-start font-semibold mb-6">扫码即可下载</p>

        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>
    </dialog>
  )
}
