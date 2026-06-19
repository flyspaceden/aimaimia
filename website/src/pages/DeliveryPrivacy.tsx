import LegalDocumentView from '@/components/LegalDocumentView'
import { DELIVERY_PRIVACY_POLICY } from '@/content/legal/deliveryPrivacy'

export default function DeliveryPrivacy() {
  return <LegalDocumentView doc={DELIVERY_PRIVACY_POLICY} />
}
