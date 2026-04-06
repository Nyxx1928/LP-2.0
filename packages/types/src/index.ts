export type ProductSummary = {
  id: string
  title: string
  sku: string
  price: number
  currencyCode: string
  inStock: boolean
}

export type CartSummary = {
  id: string
  itemCount: number
  subtotal: number
  currencyCode: string
}

export type OrderSummary = {
  id: string
  orderNumber: string
  status: "pending" | "paid" | "packed" | "shipped" | "delivered" | "cancelled"
  total: number
  currencyCode: string
}
