import { createContext, useContext } from "react";
import { THEMES, type Theme, type ThemeName } from "./themes.js";

export const ThemeContext = createContext<Theme>(THEMES.dark);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export { THEMES };
export type { Theme, ThemeName };