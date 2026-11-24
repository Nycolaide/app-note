export interface FolderActions {
  create: (parent: string) => void;
  rename: (path: string) => void;
  move: (path: string) => void;
  trash: (path: string) => void;
}

export type ThemeName = "system" | "light" | "dark";
