function css(name) {
  return "rgb(" + getComputedStyle(document.documentElement).getPropertyValue(name) + ")";
}

let isDark = document.documentElement.classList.contains("dark");

mermaid.initialize({
  theme: "base",
  themeVariables: {
    background: "#1a1e2a",
    primaryTextColor: "#f1f4fa",
    primaryColor: isDark ? "#6cb4ff" : "#6cb4ff",
    secondaryColor: isDark ? "#5efa9e" : "#5efa9e",
    tertiaryColor: isDark ? "#151820" : "#151820",
    primaryBorderColor: isDark ? "#6cb4ff" : "#6cb4ff",
    secondaryBorderColor: "#5efa9e",
    tertiaryBorderColor: isDark ? "#262d3d" : "#262d3d",
    lineColor: isDark ? "#7d849a" : "#7d849a",
    fontFamily:
      "ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,segoe ui,Roboto,helvetica neue,Arial,noto sans,sans-serif",
    fontSize: "16px",
    pieTitleTextSize: "19px",
    pieSectionTextSize: "16px",
    pieLegendTextSize: "16px",
    pieStrokeWidth: "1px",
    pieOuterStrokeWidth: "0.5px",
    pieStrokeColor: isDark ? "#7d849a" : "#7d849a",
    pieOpacity: "1",
  },
});
