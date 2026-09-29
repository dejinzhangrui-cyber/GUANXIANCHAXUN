/* 第 2 步：前端逻辑。只干三件事 —— 解压数据 / 建索引 / 搜索渲染 */
(function () {
  if (!window.DB) return ensureData(boot);   // 数据没取到就自动重拉
  boot();

  function boot() {
  var DB = window.DB;
  var CM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_';
  var CMAP = {}; for (var i = 0; i < 64; i++) CMAP[CM[i]] = i;

  var N = DB.n, COLS = DB.cols, NC = COLS.length;
  var ci = {}; COLS.forEach(function (c, i) { ci[c] = i; });

  /* ---------- 1. 解压：定宽字符串 -> 下标矩阵 ---------- */
  var IDX = new Uint16Array(N * NC);
  for (var c = 0; c < NC; c++) {
    var s = DB.data[c], w = DB.w[c], p = 0;
    for (var r = 0; r < N; r++) {
      var x = 0;
      for (var k = 0; k < w; k++) x = x * 64 + CMAP[s[p + k]];
      IDX[r * NC + c] = x; p += w;
    }
  }
  function cell(r, name) { return DB.dict[ci[name]][IDX[r * NC + ci[name]]]; }

  /* ---------- 2. 建索引 ---------- */
  var pipes = {}, order = [];                 // 管线号 -> 该管线的所有行号
  for (var r = 0; r < N; r++) {
    var k = cell(r, '管线号');
    if (!pipes[k]) { pipes[k] = []; order.push(k); }
    pipes[k].push(r);
  }
  var hay = new Array(N);                     // 每行拼一条搜索串（焊口维度）
  for (var r = 0; r < N; r++) {
    hay[r] = [cell(r, '焊缝编号'), cell(r, '焊工号根层'), cell(r, '焊工号填充、盖面'),
      cell(r, '炉批号1'), cell(r, '管线号')].join(' ').toUpperCase();
  }
  var phay = {};                              // 每条管线拼一条搜索串（管线维度）
  order.forEach(function (k) {
    var r0 = pipes[k][0];
    phay[k] = [k, cell(r0, '图纸号'), cell(r0, '介质'), cell(r0, '装置'),
      cell(r0, '区域'), cell(r0, '施工队')].join(' ').toUpperCase();
  });

  /* ---------- 3. 搜索 ---------- */
  function hit(h, words) {
    for (var i = 0; i < words.length; i++) if (h.indexOf(words[i]) < 0) return false;
    return true;
  }
  function search(q) {
    var w = q.toUpperCase().split(/\s+/).filter(Boolean);
    var P = [], W = [];
    if (!w.length) return { p: order.slice(0, 100), w: [] };
    order.forEach(function (k) { if (hit(phay[k], w)) P.push(k); });
    for (var r = 0; r < N; r++) if (hit(hay[r], w)) W.push(r);
    return { p: P, w: W };
  }

  /* ---------- 4. 渲染 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var tab = 'pipe', last = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  function render() {
    var res = search(last), h = '';
    if (tab === 'pipe') {
      res.p.forEach(function (k) {
        var rows = pipes[k], r0 = rows[0];
        h += '<div class="card" data-p="' + esc(k) + '">' +
          '<h3>' + esc(k) + '</h3>' +
          '<p>' + esc(cell(r0, '装置')) + ' · ' + esc(cell(r0, '介质')) + ' · ' + esc(cell(r0, '图纸号')) + '</p>' +
          '<span class="tag">焊口 ' + rows.length + '</span>' +
          '<span class="tag">' + esc(cell(r0, '施工队')) + '</span></div>';
      });
    } else {
      res.w.slice(0, 200).forEach(function (r) {
        h += '<div class="card" data-w="' + r + '">' +
          '<h3>' + esc(cell(r, '焊缝编号')) + '</h3>' +
          '<p>' + esc(cell(r, '管线号')) + ' · ' + esc(cell(r, '尺寸')) + ' · ' + esc(cell(r, '焊接日期')) + '</p>' +
          '<span class="tag">' + esc(cell(r, '安装/F预制/S')) + '</span>' +
          '<span class="tag">VT ' + (esc(cell(r, 'VT检测结果')) || '未检') + '</span></div>';
      });
      if (res.w.length > 200) h += '<div class="empty">仅显示前 200 条，共 ' + res.w.length + ' 条</div>';
    }
    if (!h) h = '<div class="empty">没有匹配结果</div>';
    $('list').innerHTML = h;
    $('meta').textContent = order.length + ' 条管线 / ' + N + ' 道焊口';
  }

  function kv(names, r) {
    return '<table class="kv">' + names.map(function (n) {
      var v = esc(cell(r, n));
      return '<tr><th>' + n + '</th><td>' + (v || '—') + '</td></tr>';
    }).join('') + '</table>';
  }

  var PIPE_INFO = ['管线号', '图纸号', '版本号', '介质', '装置', '区域', '工区号', '施工队', '管线材料等级'];
  var WELD_INFO = COLS.filter(function (c) { return PIPE_INFO.indexOf(c) < 0; });

  function openSheet(title, html) {
    $('shtitle').textContent = title;
    $('shbody').innerHTML = html;
    $('sheet').classList.add('on'); $('mask').classList.add('on');
  }
  function closeSheet() { $('sheet').classList.remove('on'); $('mask').classList.remove('on'); }

  function openPipe(k) {
    var rows = pipes[k], r0 = rows[0], nvt = 0, nrt = 0, npre = 0;
    rows.forEach(function (r) {
      if (cell(r, 'VT检测结果')) nvt++;
      if (cell(r, 'RT检测结果')) nrt++;
      if (cell(r, '安装/F预制/S').indexOf('预制') >= 0) npre++;
    });
    var h = '<div class="stat"><div><b>' + rows.length + '</b><span>焊口总数</span></div>' +
      '<div><b style="color:var(--ok)">' + nvt + '</b><span>VT已检</span></div>' +
      '<div><b style="color:var(--warn)">' + nrt + '</b><span>RT已检</span></div>' +
      '<div><b>' + npre + '</b><span>预制口</span></div></div>' + kv(PIPE_INFO, r0) +
      '<div style="margin:14px 0 6px;font-weight:600">焊口清单</div>';
    rows.forEach(function (r) {
      h += '<div class="row" data-w="' + r + '"><b>' + esc(cell(r, '焊缝编号')) + '</b>' +
        '<p>' + esc(cell(r, '尺寸')) + ' · ' + esc(cell(r, '焊工号根层')) + ' · ' +
        (esc(cell(r, 'VT检测结果')) || 'VT未检') + '</p></div>';
    });
    openSheet(k, h);
  }
  function openWeld(r) { openSheet(cell(r, '焊缝编号') || '焊口', kv(WELD_INFO, r)); }

  /* ---------- 5. 事件 ---------- */
  $('q').addEventListener('input', function () { last = this.value.trim(); render(); });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.t;
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on'); render();
    });
  });
  $('list').addEventListener('click', function (e) {
    var el = e.target.closest('[data-p],[data-w]'); if (!el) return;
    if (el.dataset.p !== undefined) openPipe(el.dataset.p); else openWeld(+el.dataset.w);
  });
  $('shbody').addEventListener('click', function (e) {
    var el = e.target.closest('[data-w]'); if (el) openWeld(+el.dataset.w);
  });
  $('shclose').addEventListener('click', closeSheet);
  $('mask').addEventListener('click', closeSheet);

  /* 离线缓存：file:// 打开时浏览器不支持，必须走 http 或 https */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js');
  }
  render();
  }

  /* 兜底：腾讯云默认域名偶发取不到大文件，这里自动重拉 3 次 */
  function ensureData(done) {
    var list = document.getElementById('list'), tries = 0;
    list.innerHTML = '<div class="empty">数据加载中…</div>';
    attempt();
    function attempt() {
      var s = document.createElement('script');
      s.src = 'data.js?retry=' + Date.now();
      s.onload = function () { window.DB ? done() : retry(); };
      s.onerror = retry;
      document.head.appendChild(s);
    }
    function retry() {
      if (++tries < 3) return setTimeout(attempt, 800);
      list.innerHTML = '<div class="empty">数据加载失败，请刷新页面重试</div>';
    }
  }
})();
