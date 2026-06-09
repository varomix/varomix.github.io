function css(name) {
  return "rgb(" + getComputedStyle(document.documentElement).getPropertyValue(name) + ")";
}

let isDark = document.documentElement.classList.contains("dark");

mermaid.initialize({
  theme: "base",
  themeVariables: {
    background: "#1a1e2a",
    primaryTextColor: "#000000",
    nodeTextColor: "#000000",
    tertiaryTextColor: "#000000",
    primaryColor: isDark ? "#6cb4ff" : "#6cb4ff",
    secondaryColor: isDark ? "#5efa9e" : "#5efa9e",
    tertiaryColor: isDark ? "#151820" : "#151820",
    primaryBorderColor: isDark ? "#6cb4ff" : "#6cb4ff",
    secondaryBorderColor: "#5efa9e",
    tertiaryBorderColor: isDark ? "#262d3d" : "#262d3d",
    lineColor: "#000000",
    fontFamily:
      "ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,segoe ui,Roboto,helvetica neue,Arial,noto sans,sans-serif",
    fontSize: "16px",
    pieTitleTextSize: "19px",
    pieSectionTextSize: "16px",
    pieLegendTextSize: "16px",
    pieStrokeWidth: "1px",
    pieOuterStrokeWidth: "0.5px",
    pieStrokeColor: "#000000",
    pieOpacity: "1",
  },
});
