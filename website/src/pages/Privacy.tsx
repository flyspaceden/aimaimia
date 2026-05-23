import LegalDocumentView from '@/components/LegalDocumentView'
import { PRIVACY_POLICY } from '@/content/legal/privacyPolicy'

export default function Privacy() {
  return <LegalDocumentView doc={PRIVACY_POLICY} />
}
