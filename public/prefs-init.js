// No-FOUC user-preference init (theme + text size). Loaded via
// <Script src strategy="beforeInteractive"> in app/layout.tsx so it runs
// before hydration — an INLINE next/script is not hoisted in the App Router
// and triggers React's "script tag while rendering" error instead.
;(function () {
  try {
    var t = localStorage.getItem("theme")
    var d = t
      ? t === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches
    document.documentElement.classList.toggle("dark", d)
    var s = localStorage.getItem("text-size")
    if (s === "large") document.documentElement.classList.add("text-scale-lg")
    else if (s === "xlarge")
      document.documentElement.classList.add("text-scale-xl")
  } catch (e) {}
})()
