// Shared versioned presentation choices; never infer a theme from fit or price.
export const PRODUCT_THEMES = [
  { id: "home-terrain-v1", name: "Home Terrain · เข้ม / ส้ม", bodyClass: "" },
  { id: "woven-stride-v1", name: "Woven Stride · ขาว / ดำ", bodyClass: "theme-paper" },
];
export const defaultProductTheme = slug => slug === "drop02" ? "woven-stride-v1" : "home-terrain-v1";
export const validProductTheme = id => PRODUCT_THEMES.some(theme => theme.id === id);
