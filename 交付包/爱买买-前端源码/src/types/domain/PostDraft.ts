/**
 * 域模型：发帖草稿（PostDraft）
 *
 * 用途：
 * - 发布前保存草稿、草稿箱列表
 */
import { AiMusicTrack, AiTagSuggestion } from './Ai';
import { PostTemplate, PostVisibility } from './Post';
import { Product } from './Product';

export type PostDraft = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  images: string[];
  template: PostTemplate;
  storyOrigin?: string;
  storyProcess?: string;
  storyTaste?: string;
  diaryStage?: string;
  diaryWeather?: string;
  diaryNote?: string;
  recipeIngredients?: string;
  recipeSteps?: string;
  recipeTips?: string;
  product?: Product | null;
  music?: AiMusicTrack | null;
  aiTagSuggestions?: AiTagSuggestion[];
  aiMusicCandidates?: AiMusicTrack[];
  visibility: PostVisibility;
  allowComments: boolean;
  syncToCompany: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PostDraftInput = Omit<PostDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
