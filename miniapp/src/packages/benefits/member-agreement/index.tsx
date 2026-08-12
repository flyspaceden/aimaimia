import { ScrollView, Text, View } from '@tarojs/components';
import { MINIAPP_MEMBER_SERVICE_AGREEMENT } from '@/legal/documents';
import type { LegalBlock } from '@/legal/types';
import './index.scss';

function blockClassName(block: LegalBlock): string {
  return `member-agreement-block member-agreement-block--${block.type}`;
}

export default function MemberAgreementPage() {
  const document = MINIAPP_MEMBER_SERVICE_AGREEMENT;
  return <View className='member-agreement-page'>
    <ScrollView className='member-agreement-scroll' scrollY enhanced showScrollbar={false}>
      <View className='member-agreement-content'>
        <Text className='member-agreement-title' userSelect>{document.title}</Text>
        <Text className='member-agreement-meta' userSelect>版本 {document.version} · 生效日期 {document.effectiveAt}</Text>
        <View className='member-agreement-summary'>{document.summary.map((paragraph) => <Text className='member-agreement-summary__text' key={paragraph} userSelect>{paragraph}</Text>)}</View>
        {document.sections.map((section) => <View className='member-agreement-section aim-card' id={section.id} key={section.id}><Text className='member-agreement-section__title' userSelect>{section.title}</Text>{section.blocks.map((block, index) => <Text className={blockClassName(block)} key={`${section.id}-${index}`} userSelect>{block.text}</Text>)}</View>)}
      </View>
    </ScrollView>
  </View>;
}
