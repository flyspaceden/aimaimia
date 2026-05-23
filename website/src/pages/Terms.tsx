import LegalDocumentView from '@/components/LegalDocumentView'
import { TERMS_OF_SERVICE } from '@/content/legal/termsOfService'

export default function Terms() {
  return <LegalDocumentView doc={TERMS_OF_SERVICE} />
}
