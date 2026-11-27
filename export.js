// 各頁共用的「匯出圖片」：把畫面上的表格（目前的篩選、排序、欄位）畫成 PNG，方便分享。
// 圖片＝綠色標題列＋表格（排序欄底色略深、欄名加 ▼／▲）＋說明文字＋頁尾小字＋右下角「股市小樹苗」圖示。
// 表格慣例：欄名放在 <span class="lbl">（多行用 <br>），排序中的欄位（th 與 td）加 class="sorted"；
// 名稱若用 .nm 截斷會同樣以 … 結尾；class="tag" 的元素不畫。
const TableImage = (() => {
  const font = cs => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  // 儲存格文字：欄名依 <br> 分行；其他取文字（.code 之後空一格）
  const cellLines = c => {
    const lbl = c.querySelector('.lbl');
    if (lbl) return lbl.innerHTML.split('<br>').map(s => s.replace(/<[^>]*>/g, ''));
    return [[...c.childNodes].filter(n => n.nodeType === 3 || !n.classList?.contains('tag'))
      .map(n => n.textContent + (n.classList?.contains('code') ? ' ' : '')).join('').trim()];
  };

  // opt：table、title（主標題）、sub（副標題）、note（表格下方說明，12px）、foot（頁尾小字，8px）、
  //      filename、sortDir（-1 由高到低 / 1 由低到高）、skipCols（左邊不畫的欄數，如勾選欄）
  async function exportTable(opt) {
    const {table, title, sub = '', note = '', foot = '', filename, sortDir = -1, skipCols = 0} = opt;
    const wrapEl = table.parentElement, SC = 2, PAD = 16;
    const keep = [wrapEl.scrollTop, wrapEl.scrollLeft];
    wrapEl.scrollTop = 0; wrapEl.scrollLeft = 0;   // 表頭為 sticky，捲回頂端才能量到正確位置
    try {
      // 表格上方的群組標題列（各年度含息報酬率…）和圖片標題列重複，圖片上不畫，表格往上移
      const grp = table.querySelector('thead tr.group');
      const GH = grp ? grp.getBoundingClientRect().height : 0;
      const tr0 = table.getBoundingClientRect();
      const TB = tr0.height - (table.tFoot ? table.tFoot.getBoundingClientRect().height : 0) - GH;
      const head = [...table.querySelectorAll('thead tr:not(.group)')].pop();
      const skip = [...head.cells].slice(0, skipCols).reduce((s, c) => s + c.getBoundingClientRect().width, 0);
      const W = tr0.width - skip, ox = tr0.left + skip;
      const fam = getComputedStyle(document.body).fontFamily;
      const icon = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'icon-192.png'; });
      const src = /^https?:/.test(location.href) ? location.href.split('#')[0] : '';
      const cv = document.createElement('canvas'), g = cv.getContext('2d');
      const MARK = 120;   // 右下角圖示＋「股市小樹苗」佔的寬度，下方文字不要壓到
      const wrap = (text, f) => {
        g.font = f; const out = []; let line = '';
        for (const ch of text) { if (g.measureText(line + ch).width > W - MARK && line) { out.push(line); line = ch; } else line += ch; }
        if (line) out.push(line); return out;
      };
      const noteLines = note ? wrap(note, '12px ' + fam) : [], footLines = foot ? wrap(foot, '8px ' + fam) : [];
      const BAR = 62, top = BAR + 14, ICON = 30;
      const textH = 10 + noteLines.length * 17 + 4 + footLines.length * 11 + (src ? 11 : 0);
      const H = top + TB + Math.max(textH, ICON + 14) + PAD, CW = W + PAD * 2;
      cv.width = CW * SC; cv.height = H * SC;
      g.scale(SC, SC); g.fillStyle = '#fff'; g.fillRect(0, 0, CW, H);
      g.textBaseline = 'middle';
      g.fillStyle = '#2c7a3f'; g.fillRect(0, 0, CW, BAR);   // 標題列
      g.fillStyle = '#fff'; g.font = 'bold 20px ' + fam; g.fillText(title, PAD, 23);
      g.font = '12px ' + fam; g.fillStyle = 'rgba(255,255,255,.88)';
      let st = sub;   // 副標題太長以 … 結尾
      while (st.length > 1 && g.measureText(st).width > CW - PAD * 2) st = st.slice(0, -2) + '…';
      g.fillText(st, PAD, 46);
      const cells = [...head.cells, ...[...table.tBodies[0].rows].flatMap(tr => [...tr.cells])].filter(c => c.cellIndex >= skipCols);
      for (const c of cells) {
        const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
        let x = r.left - ox + PAD, w = r.width;
        if (x < PAD) { w -= PAD - x; x = PAD; } if (w <= 0) continue;   // 隱藏的欄位寬度為 0
        const y = r.top - tr0.top - GH + top, h = r.height;
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') { g.fillStyle = cs.backgroundColor; g.fillRect(x, y, w, h); }
        const sorted = c.classList.contains('sorted');
        if (sorted) { g.fillStyle = c.tagName === 'TH' ? 'rgba(44,122,63,.16)' : 'rgba(44,122,63,.07)'; g.fillRect(x, y, w, h); }
        if (cs.borderTopStyle !== 'none') { g.strokeStyle = cs.borderTopColor; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w, h); }
        const lbl = c.querySelector('.lbl'), lines = cellLines(c);
        if (lbl && sorted) lines[lines.length - 1] += sortDir < 0 ? ' ▼' : ' ▲';   // 排序方向（與畫面上的三角形相同）
        const nm = c.querySelector('.nm');
        // 文字全在單一內層元素（如 <span class="pos">12.3%</span>）時，用它的顏色與字型
        const kids = [...c.children].filter(e => e.textContent.trim());
        const inner = !lbl && !nm && kids.length === 1 && kids[0].textContent.trim() === c.textContent.trim() ? kids[0] : null;
        const tc = getComputedStyle(lbl || nm || inner || c);
        g.font = font(tc); g.fillStyle = tc.color;
        if (nm && nm.scrollWidth > nm.clientWidth) {   // 名稱被截斷：圖片上同樣以 … 結尾
          let t = lines[0];
          while (t.length > 1 && g.measureText(t + '…').width > nm.clientWidth) t = t.slice(0, -1);
          lines[0] = t + '…';
        }
        const runNodes = !lbl && !nm && !inner && kids.length > 1 ? [...c.childNodes].filter(n => n.textContent) : null;
        if (runNodes) {   // 同一格有多種顏色（如多個類別）：逐段畫，置中或靠右時先量總寬
          const runs = runNodes.map(n => { const st = getComputedStyle(n.nodeType === 1 ? n : c); return {t:n.textContent, f:font(st), col:st.color}; });
          runs.forEach(rn => { g.font = rn.f; rn.w = g.measureText(rn.t).width; });
          const tot = runs.reduce((s, rn) => s + rn.w, 0);
          let rx = cs.textAlign === 'center' ? x + w / 2 - tot / 2 : cs.textAlign === 'right' ? x + w - parseFloat(cs.paddingRight) - tot : x + parseFloat(cs.paddingLeft);
          g.textAlign = 'left';
          for (const rn of runs) { g.font = rn.f; g.fillStyle = rn.col; g.fillText(rn.t, rx, y + h / 2); rx += rn.w; }
          continue;
        }
        const al = lbl || cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left';
        g.textAlign = al;
        const tx = al === 'center' ? x + w / 2 : al === 'right' ? x + w - parseFloat(cs.paddingRight) : x + parseFloat(cs.paddingLeft);
        const lh = parseFloat(tc.fontSize) * 1.3, y0 = y + (lbl ? h - lines.length * lh - 4 : h - lines.length * lh) / 2 + lh / 2 + (lbl ? 6 : 0);
        lines.forEach((s, i) => g.fillText(s, tx, y0 + i * lh));
      }
      g.textAlign = 'left'; g.font = '12px ' + fam; g.fillStyle = '#444';
      let fy = top + TB + 18;
      noteLines.forEach(s => { g.fillText(s, PAD, fy); fy += 17; });
      fy += 4; g.font = '8px ' + fam; g.fillStyle = '#888';
      footLines.forEach(s => { g.fillText(s, PAD, fy); fy += 11; });
      if (src) { g.fillStyle = '#2c7a3f'; g.fillText(src, PAD, fy); }
      // 右下角：App 圖示與群組名稱，和左邊的說明文字並排（底部對齊），不另起一行
      const iy = H - PAD - ICON, ix = CW - PAD - ICON;
      if (icon) {
        g.save(); g.beginPath(); g.roundRect ? g.roundRect(ix, iy, ICON, ICON, 7) : g.rect(ix, iy, ICON, ICON); g.clip();
        g.drawImage(icon, ix, iy, ICON, ICON); g.restore();
      }
      g.textAlign = 'right'; g.fillStyle = '#666'; g.font = '11px ' + fam;
      g.fillText('股市小樹苗', ix - 6, iy + ICON / 2);
      await save(cv, filename, title);
    } finally {
      [wrapEl.scrollTop, wrapEl.scrollLeft] = keep;
    }
  }
  // 手機（觸控）用分享面板，其他直接下載
  async function save(cv, name, title) {
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = new File([blob], name, {type:'image/png'});
    if (navigator.canShare && navigator.canShare({files:[file]}) && matchMedia('(pointer:coarse)').matches) {
      try { await navigator.share({files:[file], title}); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return {exportTable};
})();
