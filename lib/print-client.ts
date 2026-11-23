// 화면의 한 부분만 인쇄한다. 보이지 않는 iframe 에 그 부분을 복사해 담고(스타일도 함께), 거기서 인쇄 창을 연다.
// 버튼은 인쇄물에 나오지 않는다. 숨겨 둔(hidden) 인쇄 전용 요소도 인쇄할 수 있다.
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function printElement(el: HTMLElement | null, opts: { title: string; heading?: string; landscape?: boolean }): Promise<void> {
  if (!el || typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) { iframe.remove(); return; }
  doc.open();
  doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${esc(opts.title)}</title></head><body></body></html>`);
  doc.close();

  // 화면과 같은 글꼴·색이 나오도록 스타일을 복사한다
  const waits: Promise<void>[] = [];
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(n => {
    const c = n.cloneNode(true) as HTMLElement;
    if (c.tagName === "LINK") waits.push(new Promise<void>(res => { c.addEventListener("load", () => res()); c.addEventListener("error", () => res()); }));
    doc.head.appendChild(c);
  });
  const extra = doc.createElement("style");
  extra.textContent = `
    @page { size: A4 ${opts.landscape ? "landscape" : "portrait"}; margin: 12mm; }
    html, body { background: #fff !important; color: #000 !important; }
    body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    button, input, select, textarea, [role="tablist"], .no-print { display: none !important; }
    * { box-shadow: none !important; }
    section, tr { break-inside: avoid; }
  `;
  doc.head.appendChild(extra);

  const root = el.cloneNode(true) as HTMLElement;
  root.classList.remove("hidden");
  root.removeAttribute("id");
  if (opts.heading) {
    const h = doc.createElement("h1");
    h.textContent = opts.heading;
    h.style.cssText = "font-size:20px;font-weight:800;margin:0 0 10px";
    doc.body.appendChild(h);
  }
  doc.body.appendChild(root);
  const stamp = doc.createElement("p");
  stamp.textContent = `출력일 ${new Date().toLocaleDateString("ko-KR")}`;
  stamp.style.cssText = "font-size:10px;color:#666;margin:10px 0 0;text-align:right";
  doc.body.appendChild(stamp);

  await Promise.all(waits);
  await new Promise(r => setTimeout(r, 150)); // 스타일이 적용될 시간을 조금 준다
  const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => iframe.isConnected && iframe.remove(), 120_000); // 인쇄 창이 닫힌 신호가 없을 때를 대비
  win.focus();
  win.print();
}
