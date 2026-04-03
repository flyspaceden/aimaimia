// website/src/contexts/CartContext.tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { CartItem, Product } from '@/data/shopMockData'

interface CartContextType {
  items: CartItem[]
  addItem: (product: Product, skuIdx?: number, qty?: number) => void
  removeItem: (productId: string) => void
  updateQty: (productId: string, delta: number, maxQty?: number) => void
  toggleCheck: (productId: string) => void
  toggleAll: () => void
  clearCart: () => void
}

const CartContext = createContext<CartContextType | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  const addItem = useCallback((product: Product, skuIdx = 0, qty = 1) => {
    const sku = product.skus[skuIdx]
    const spec = sku?.label ?? product.skus[0]?.label ?? '默认'
    const price = sku?.price ?? product.price
    const maxQty = Math.max(1, product.stock)

    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id)
      if (existing) {
        return prev.map(i =>
          i.productId === product.id
            ? { ...i, spec, price, quantity: Math.min(maxQty, i.quantity + qty) }
            : i
        )
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          spec,
          price,
          quantity: Math.min(maxQty, qty),
          checked: true,
          emoji: product.emoji,
          bgGradient: product.bgGradient || 'linear-gradient(135deg, #e8f5e9, #c8e6c9)',
        },
      ]
    })
  }, [])

  const removeItem = useCallback((productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId))
  }, [])

  const updateQty = useCallback((productId: string, delta: number, maxQty = 99) => {
    setItems(prev => prev.map(i =>
      i.productId === productId
        ? { ...i, quantity: Math.min(maxQty, Math.max(1, i.quantity + delta)) }
        : i
    ))
  }, [])

  const toggleCheck = useCallback((productId: string) => {
    setItems(prev => prev.map(i =>
      i.productId === productId ? { ...i, checked: !i.checked } : i
    ))
  }, [])

  const toggleAll = useCallback(() => {
    setItems(prev => {
      const allChecked = prev.every(i => i.checked)
      return prev.map(i => ({ ...i, checked: !allChecked }))
    })
  }, [])

  const clearCart = useCallback(() => setItems([]), [])

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQty, toggleCheck, toggleAll, clearCart }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
