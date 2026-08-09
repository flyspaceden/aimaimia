import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect } from 'react';
import { MINIAPP_PRIVACY_POLICY, MINIAPP_TERMS_OF_SERVICE } from '@/legal/documents';
import type { LegalBlock, LegalDocument } from '@/legal/types';
import './index.scss';

function blockClassName(block: LegalBlock): string {
  return `account-legal-block account-legal-block--${block.type}`;
}

export default function AccountLegalPage() {
  const router = useRouter();
  const document: LegalDocument = router.params.document === 'privacy'
    ? MINIAPP_PRIVACY_POLICY
    : MINIAPP_TERMS_OF_SERVICE;

  useEffect(() => {
    void Taro.setNavigationBarTitle({ title: document.title });
  }, [document.title]);

  return <View className='account-legal-page'>
    <ScrollView className='account-legal-scroll' scrollY enhanced showScrollbar={false}>
      <View className='account-legal-content'>
        <Text className='account-legal-title'>{document.title}</Text>
        <Text className='account-legal-meta'>版本 {document.version} · 生效日期 {document.effectiveAt}</Text>
        <View className='account-legal-summary'>
          {document.summary.map((paragraph) => <Text className='account-legal-summary__text' key={paragraph}>{paragraph}</Text>)}
        </View>
        {document.sections.map((section) => <View className='account-legal-section aim-card' id={section.id} key={section.id}>
          <Text className='account-legal-section__title'>{section.title}</Text>
          {section.blocks.map((block, index) => <Text className={blockClassName(block)} key={`${section.id}-${index}`}>{block.text}</Text>)}
        </View>)}
      </View>
    </ScrollView>
  </View>;
}
