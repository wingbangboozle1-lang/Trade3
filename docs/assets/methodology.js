// Page logic for methodology.html. Extracted from the inline module so the
// render test can boot it exactly as a browser does.
import { getProxy, setProxy } from "./assets/app.js";
  const input = document.getElementById("proxy-input");
  const status = document.getElementById("proxy-status");
  const paint = () => {
    const p = getProxy();
    input.value = p;
    status.textContent = p ? "a proxy is set for this browser" : "using the Kalshi API directly";
  };
  document.getElementById("proxy-save").addEventListener("click", () => { setProxy(input.value); paint(); });
  document.getElementById("proxy-clear").addEventListener("click", () => { setProxy(""); input.value = ""; paint(); });
  paint();
