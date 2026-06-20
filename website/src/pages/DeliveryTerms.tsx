import LegalDocumentView from '@/components/LegalDocumentView'
import { DELIVERY_TERMS } from '@/content/legal/deliveryTerms'

export default function DeliveryTerms() {
  return <LegalDocumentView doc={DELIVERY_TERMS} />
}
