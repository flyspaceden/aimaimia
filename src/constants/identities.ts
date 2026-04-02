import { BookingIdentity } from '../types';

export const identityOptions: Array<{ value: BookingIdentity; label: string }> = [
  { value: 'consumer', label: '消费者' },
  { value: 'buyer', label: '采购商' },
  { value: 'student', label: '学生/研学' },
  { value: 'media', label: '媒体/自媒体' },
  { value: 'investor', label: '投资者/合作方' },
  { value: 'other', label: '其他' },
];
