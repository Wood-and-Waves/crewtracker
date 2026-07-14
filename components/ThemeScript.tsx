// Runs before paint so the saved theme is applied with no flash of the
// wrong palette. With no saved choice, CSS falls back to prefers-color-scheme.
export default function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('ct-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`
  return <script dangerouslySetInnerHTML={{ __html: js }} />
}
