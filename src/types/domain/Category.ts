export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  path: string;
  icon?: string;
};
