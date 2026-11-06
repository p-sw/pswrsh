// Terminal style choices, shared by the settings page, the terminal, and the server check.
import type { ITheme } from "@xterm/xterm";

export const SYSTEM_FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

export type FontChoice = { id: string; label: string; family: string; weights: number[] };

/** Weights come from each @fontsource package's metadata.json (normal style). */
export const FONTS: FontChoice[] = [
  { id: "system", label: "시스템 기본", family: SYSTEM_FONT_STACK, weights: [400, 700] },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: '"JetBrains Mono"', weights: [100, 200, 300, 400, 500, 600, 700, 800] },
  { id: "fira-code", label: "Fira Code", family: '"Fira Code"', weights: [300, 400, 500, 600, 700] },
  { id: "source-code-pro", label: "Source Code Pro", family: '"Source Code Pro"', weights: [200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", family: '"IBM Plex Mono"', weights: [100, 200, 300, 400, 500, 600, 700] },
  { id: "cascadia-code", label: "Cascadia Code", family: '"Cascadia Code"', weights: [200, 300, 400, 500, 600, 700] },
  { id: "ubuntu-mono", label: "Ubuntu Mono", family: '"Ubuntu Mono"', weights: [400, 700] },
  { id: "iosevka", label: "Iosevka", family: '"Iosevka"', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "inconsolata", label: "Inconsolata", family: '"Inconsolata"', weights: [200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "roboto-mono", label: "Roboto Mono", family: '"Roboto Mono"', weights: [100, 200, 300, 400, 500, 600, 700] },
];

const ANSI_BASE = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

export type ThemeChoice = { id: string; label: string; theme: ITheme & { background: string; foreground: string } };

export const THEMES: ThemeChoice[] = [
  {
    id: "default",
    label: "기본 (zinc 다크)",
    theme: { ...ANSI_BASE, background: "#09090b", foreground: "#f4f4f5", cursor: "#f4f4f5", selectionBackground: "#3f3f46" },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    theme: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#93a1a1",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    theme: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "nord",
    label: "Nord",
    theme: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "light",
    label: "Light",
    theme: {
      background: "#ffffff",
      foreground: "#1f2328",
      cursor: "#1f2328",
      selectionBackground: "#c8d4e3",
      black: "#24292f",
      red: "#cf222e",
      green: "#116329",
      yellow: "#7d4e00",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#1a7f37",
      brightYellow: "#633c01",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#8c959f",
    },
  },
];

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;

/** size null means the device default (13px desktop, 15px phone). */
export type TerminalStyle = { font: string; size: number | null; weight: number; theme: string };

export const DEFAULT_STYLE: TerminalStyle = { font: "system", size: null, weight: 400, theme: "default" };

export function fontOf(id: string) {
  return FONTS.find((font) => font.id === id) ?? FONTS[0];
}

export function themeOf(id: string) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** A valid style from stored or submitted data, or null when something is out of range. */
export function parseStyle(input: unknown): TerminalStyle | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const font = FONTS.find((f) => f.id === value.font);
  const theme = THEMES.find((t) => t.id === value.theme);
  const size = value.size === null ? null : Number(value.size);
  const weight = Number(value.weight);
  if (!font || !theme) return null;
  if (size !== null && (!Number.isInteger(size) || size < MIN_FONT_SIZE || size > MAX_FONT_SIZE)) return null;
  if (!font.weights.includes(weight)) return null;
  return { font: font.id, size, weight, theme: theme.id };
}

/** The bold weight xterm uses: the next available weight about 300 heavier. */
export function boldWeightOf(font: FontChoice, weight: number) {
  return font.weights.find((w) => w >= weight + 300) ?? font.weights[font.weights.length - 1];
}
