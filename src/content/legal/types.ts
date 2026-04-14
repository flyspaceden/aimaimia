// 法律文本块类型，用于结构化渲染
export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'note'; text: string };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  version: string;
  publishedAt: string;
  effectiveAt: string;
  summary: string[];
  sections: LegalSection[];
}
