import LegalDocumentView from '@/components/LegalDocumentView'
import { DELIVERY_SELLER_AGREEMENT } from '@/content/legal/deliverySellerAgreement'

export default function DeliverySellerAgreement() {
  return <LegalDocumentView doc={DELIVERY_SELLER_AGREEMENT} />
}
