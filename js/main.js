/* ============================================================
   main.js —— 页面交互与渲染
   ------------------------------------------------------------
   依赖：subnet.js / vlan.js / dns.js（均挂在 window 上）
   职责：读取表单 → 调用算法模块 → 渲染结果
   算法与界面分离，算法可单独测试
   ============================================================ */

(function () {
  'use strict';

  const S = window.NetSubnet;
  const V = window.NetVlan;
  const D = window.NetDns;

  /* ---------- 通用工具 ---------- */

  const $ = function (id) { return document.getElementById(id); };

  /** HTML 转义，防止用户输入里的尖括号破坏结构 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(el, html) {
    if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
  }

  function hide(el) { if (el) el.hidden = true; }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }

  /** 复制到剪贴板，带降级方案 */
  function copyText(text, btn) {
    const done = function () {
      const old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
      document.body.removeChild(ta);
    }
  }

  /** 渲染 32 位二进制位图：前 prefix 位为网络位，其余为主机位 */
  function renderBitmap(prefix, rows) {
    const legend =
      '<div class="bitmap-legend">' +
        '<span class="key"><i style="background:#e6f1fb;border:1px solid #c5dcf3"></i>网络位（前 ' + prefix + ' 位）</span>' +
        '<span class="key"><i style="background:#faeeda;border:1px solid #f0d5a8"></i>主机位（后 ' + (32 - prefix) + ' 位）</span>' +
      '</div>';

    const body = rows.map(function (r) {
      const bits = r.binary.split('');
      let html = '<div class="bitmap-row"><span class="label">' + esc(r.label) + '</span><div class="bit-octets">';
      for (let o = 0; o < 4; o++) {
        const octetBits = bits.slice(o * 8, o * 8 + 8);
        const octetVal = parseInt(octetBits.join(''), 2);
        html += '<div><div class="octet">';
        octetBits.forEach(function (b, i) {
          const idx = o * 8 + i;
          const cls = idx < prefix ? 'bit net' : 'bit host';
          html += '<span class="' + cls + '">' + b + '</span>';
        });
        html += '</div><div class="octet-value">' + octetVal + '</div></div>';
      }
      html += '</div></div>';
      return html;
    }).join('');

    return '<div class="bitmap">' + legend + body + '</div>';
  }

  /** 渲染键值网格 */
  function renderKv(items) {
    return '<div class="kv-grid">' + items.map(function (it) {
      return '<div class="kv"><span class="k">' + esc(it.k) + '</span>' +
             '<span class="v ' + (it.cls || '') + '">' + esc(it.v) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ---------- 2. 标签页切换 ---------- */
  function initTabs() {
    const tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) {
          const on = x === t;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-selected', String(on));
          const panel = $(x.getAttribute('aria-controls'));
          if (panel) {
            panel.classList.toggle('is-active', on);
            panel.hidden = !on;
          }
        });
      });
    });
  }

  /* ---------- 分段控件 ---------- */
  function initSegmented(selector, bodies, onSwitch) {
    const segs = Array.prototype.slice.call(document.querySelectorAll(selector));
    segs.forEach(function (s) {
      s.addEventListener('click', function () {
        const mode = s.dataset.mode;
        segs.forEach(function (x) {
          const on = x === s;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-selected', String(on));
        });
        Object.keys(bodies).forEach(function (k) {
          bodies[k].hidden = (k !== mode);
        });
        if (onSwitch) onSwitch(mode);
      });
    });
  }

  /* ============================================================
     3. 子网计算器
     ============================================================ */
  function initSubnet() {
    const input = $('subnet-input');
    const prefixSel = $('subnet-prefix');
    const runBtn = $('subnet-calc');
    const errBox = $('subnet-error');
    const out = $('subnet-result');

    // 填充前缀下拉
    let opts = '<option value="">— 不指定 —</option>';
    for (let i = 0; i <= 32; i++) {
      opts += '<option value="' + i + '">/' + i + '　' + S.intToIp(S.prefixToMask(i)) + '</option>';
    }
    prefixSel.innerHTML = opts;

    function run() {
      hide(errBox);
      hide(out);

      const raw = input.value.trim();
      if (!raw) { showError(errBox, '请输入 IP 地址'); return; }

      let ip, prefix;
      try {
        const parsed = S.parseCidr(raw);
        ip = parsed.ip;
        prefix = parsed.prefix;

        // 下拉框优先：用户主动选了就用它覆盖
        if (prefixSel.value !== '') prefix = Number(prefixSel.value);

        if (prefix === null || prefix === undefined) {
          throw new Error('请指定前缀长度：可写成 192.168.1.0/24，或从右侧下拉框选择');
        }

        const r = S.calculate(ip, prefix);

        // 地址类型标签
        const typePills = r.classes.map(function (c) {
          const cls = c.kind === 'private' ? 'pill-green'
                    : c.kind === 'special' ? 'pill-amber' : 'pill-blue';
          return '<span class="pill ' + cls + '" title="' + esc(c.note) + '">' + esc(c.label) + '</span>';
        }).join(' ');

        let html = '<div class="result-block">';
        html += '<div class="result-title">计算结果 <span class="badge">' + esc(r.cidr) + '</span> ' + typePills + '</div>';

        html += renderKv([
          { k: '网络地址', v: r.networkText, cls: 'accent' },
          { k: '广播地址', v: r.broadcastText },
          { k: '子网掩码', v: r.maskText },
          { k: '反掩码（通配符）', v: r.wildcardText },
          { k: '可用主机范围', v: r.firstHostText + ' ~ ' + r.lastHostText, cls: 'green' },
          { k: '可用主机数', v: r.usable.toLocaleString() },
          { k: '地址总数', v: r.total.toLocaleString() },
          { k: '前缀长度', v: '/' + r.prefix + '（' + (32 - r.prefix) + ' 位主机号）' }
        ]);

        if (!r.isNetworkAddress) {
          html += '<div class="alert alert-info">注意：你输入的 <code>' + esc(r.inputIp) +
                  '</code> 不是网络地址，它的网络地址应为 <code>' + esc(r.networkText) +
                  '</code>。计算结果已按网络地址归一化。</div>';
        }

        html += '<p class="muted" style="margin-top:14px">' + esc(r.hostNote) + '</p>';

        html += '<div class="result-title" style="margin-top:22px">32 位二进制结构</div>';
        html += renderBitmap(r.prefix, [
          { label: '输入 IP', binary: r.binary.ip },
          { label: '子网掩码', binary: r.binary.mask },
          { label: '网络地址', binary: r.binary.network },
          { label: '广播地址', binary: r.binary.broadcast }
        ]);

        html += '</div>';
        show(out, html);
      } catch (e) {
        showError(errBox, e.message);
      }
    }

    runBtn.addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    prefixSel.addEventListener('change', function () { if (input.value.trim()) run(); });

    // 示例芯片
    $('subnet-samples').addEventListener('click', function (e) {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      input.value = chip.dataset.value;
      prefixSel.value = '';
      run();
    });

    run(); // 首屏直接出一份结果
  }

  /* ============================================================
     4. 子网划分
     ============================================================ */
  function initDivide() {
    const errBox = $('divide-error');
    const out = $('divide-result');

    initSegmented('#panel-divide .seg', {
      equal: $('divide-equal'),
      vlsm: $('divide-vlsm')
    });

    /* --- 等分 --- */
    function runEqual() {
      hide(errBox); hide(out);
      try {
        const base = $('eq-base').value.trim();
        const count = Number($('eq-count').value);
        const res = S.splitInto(base, count);

        let html = '<div class="result-block">';
        html += '<div class="summary-bar">' +
                  '<div class="item"><span class="k">基础网段</span><span class="v">' + esc(base) + '</span></div>' +
                  '<div class="item"><span class="k">划分后前缀</span><span class="v">/' + res.newPrefix + '</span></div>' +
                  '<div class="item"><span class="k">子网个数</span><span class="v">' + res.list.length + '</span></div>' +
                  '<div class="item"><span class="k">每个子网可用主机</span><span class="v">' + res.list[0].usable + '</span></div>' +
                '</div>';

        html += '<div class="table-scroll"><table><thead><tr>' +
                '<th>序号</th><th>网络地址</th><th>前缀</th><th>子网掩码</th>' +
                '<th>可用范围</th><th>广播地址</th><th>可用主机数</th>' +
                '</tr></thead><tbody>';
        res.list.forEach(function (s, i) {
          html += '<tr>' +
            '<td>' + (i + 1) + '</td>' +
            '<td>' + esc(s.cidr) + '</td>' +
            '<td>/' + s.prefix + '</td>' +
            '<td>' + esc(s.maskText) + '</td>' +
            '<td class="wide">' + esc(s.firstHostText + ' ~ ' + s.lastHostText) + '</td>' +
            '<td>' + esc(s.broadcastText) + '</td>' +
            '<td class="num">' + s.usable + '</td>' +
          '</tr>';
        });
        html += '</tbody></table></div></div>';
        show(out, html);
      } catch (e) {
        showError(errBox, e.message);
      }
    }

    /* --- VLSM --- */
    function parseDemands(text) {
      const list = [];
      text.split('\n').forEach(function (line, i) {
        const s = line.trim();
        if (!s) return;
        const m = s.match(/^(.*?)[\s,，:：]+(\d+)$/);
        if (!m) {
          throw new Error('第 ' + (i + 1) + ' 行格式不对：「' + s + '」，应写成「名称 主机数」');
        }
        list.push({ name: m[1].trim(), hosts: Number(m[2]) });
      });
      if (!list.length) throw new Error('请至少填写一条地址需求');
      return list;
    }

    function runVlsm() {
      hide(errBox); hide(out);
      try {
        const base = $('vlsm-base').value.trim();
        const demands = parseDemands($('vlsm-demands').value);
        const res = S.planVlsm(base, demands);

        let html = '<div class="result-block">';
        html += '<div class="summary-bar">' +
                  '<div class="item"><span class="k">基础网段</span><span class="v">' + esc(res.base.cidr) + '</span></div>' +
                  '<div class="item"><span class="k">总地址数</span><span class="v">' + res.totalAddresses.toLocaleString() + '</span></div>' +
                  '<div class="item"><span class="k">已分配</span><span class="v">' + res.usedAddresses.toLocaleString() + '</span></div>' +
                  '<div class="item"><span class="k">剩余</span><span class="v">' + res.freeAddresses.toLocaleString() + '</span></div>' +
                  '<div class="item"><span class="k">地址利用率</span><span class="v">' + res.utilization + '%</span></div>' +
                '</div>';

        html += '<div class="table-scroll"><table><thead><tr>' +
                '<th>部门</th><th>需求主机数</th><th>分配网段</th><th>掩码</th>' +
                '<th>可用范围</th><th>网关</th><th>实际可用数</th><th>浪费</th>' +
                '</tr></thead><tbody>';
        res.list.forEach(function (s) {
          const waste = s.usable - s.demandHosts;
          html += '<tr>' +
            '<td>' + esc(s.demandName) + '</td>' +
            '<td class="num">' + s.demandHosts + '</td>' +
            '<td>' + esc(s.cidr) + '</td>' +
            '<td>' + esc(s.maskText) + '</td>' +
            '<td class="wide">' + esc(s.firstHostText + ' ~ ' + s.lastHostText) + '</td>' +
            '<td>' + esc(s.firstHostText) + '</td>' +
            '<td class="num">' + s.usable + '</td>' +
            '<td class="num">+' + waste + '</td>' +
          '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<p class="muted" style="margin-top:12px">VLSM 的精髓：按实际需求分配不同长度的前缀。' +
                '上表已按主机数从大到小排序，这样能最大限度减少地址碎片。</p>';
        html += '</div>';
        show(out, html);
      } catch (e) {
        showError(errBox, e.message);
      }
    }

    $('eq-run').addEventListener('click', runEqual);
    $('eq-base').addEventListener('keydown', function (e) { if (e.key === 'Enter') runEqual(); });
    $('eq-count').addEventListener('keydown', function (e) { if (e.key === 'Enter') runEqual(); });
    $('vlsm-run').addEventListener('click', runVlsm);
    $('vlsm-base').addEventListener('keydown', function (e) { if (e.key === 'Enter') runVlsm(); });

    runEqual();
  }

  /* ============================================================
     5. VLAN 规划
     ============================================================ */
  function initVlan() {
    const errBox = $('vlan-error');
    const out = $('vlan-result');

    initSegmented('#panel-vlan .seg', {
      sequential: $('vlan-sequential'),
      vlanAsOctet: $('vlan-asoctet')
    });

    let currentMarkdown = '';
    let currentCisco = '';

    function run() {
      hide(errBox); hide(out);
      const isSeq = document.querySelector('#panel-vlan .seg.is-active').dataset.mode === 'sequential';

      try {
        let res;
        if (isSeq) {
          res = V.planSequential({
            baseCidr: $('vlan-base').value.trim(),
            startVlan: $('vlan-start').value,
            groups: $('vlan-groups').value,
            hostsPerGroup: $('vlan-hosts').value,
            namePrefix: $('vlan-prefix').value.trim() || 'VLAN'
          });
        } else {
          res = V.planVlanAsOctet({
            octetPrefix: $('octet-head').value.trim(),
            startVlan: $('octet-start').value,
            groups: $('octet-groups').value,
            hostBits: $('octet-hostbits').value,
            namePrefix: 'VLAN'
          });
        }

        // 可选：追加服务器区
        if ($('vlan-add-server').checked) {
          const sCidr = $('server-cidr').value.trim();
          const sVlan = Number($('server-vlan').value);
          const parsed = S.parseCidr(sCidr);
          if (parsed.prefix === null) throw new Error('服务器区网段需带前缀，如 192.168.200.0/24');
          if (!(sVlan >= 1 && sVlan <= 4094)) throw new Error('服务器区 VLAN ID 需在 1~4094 之间');

          const c = S.calculate(parsed.ip, parsed.prefix);
          res.list = res.list.concat([{
            vlanId: sVlan,
            name: '服务器区',
            cidr: c.cidr,
            mask: c.maskText,
            network: c.networkText,
            broadcast: c.broadcastText,
            firstHost: c.firstHostText,
            lastHost: c.lastHostText,
            gateway: c.firstHostText,
            poolStart: S.intToIp(c.firstHost + 1),
            poolEnd: c.lastHostText,
            usable: c.usable,
            prefix: c.prefix
          }]);
          res.summary.vlanCount = res.list.length;
        }

        currentMarkdown = V.toMarkdownTable(res.list);
        currentCisco = V.toCiscoCommands(res.list);

        const list = res.list;
        let html = '<div class="result-block">';
        html += '<div class="summary-bar">' +
                  '<div class="item"><span class="k">VLAN 数量</span><span class="v">' + res.summary.vlanCount + '</span></div>' +
                  '<div class="item"><span class="k">VLAN ID 区间</span><span class="v">' +
                    (list.length ? list[0].vlanId + '~' + list[list.length - 1].vlanId : '-') + '</span></div>' +
                  '<div class="item"><span class="k">每段前缀</span><span class="v">/' + res.prefix + '</span></div>' +
                  '<div class="item"><span class="k">可用地址总量</span><span class="v">' +
                    res.summary.totalUsable.toLocaleString() + '</span></div>' +
                '</div>';

        html += '<div class="table-scroll"><table><thead><tr>' +
                '<th>VLAN ID</th><th>名称</th><th>网段</th><th>子网掩码</th>' +
                '<th>网关</th><th>DHCP 地址池</th><th>可用主机</th>' +
                '</tr></thead><tbody>';
        list.forEach(function (r) {
          const isServer = r.name === '服务器区';
          html += '<tr>' +
            '<td><span class="pill ' + (isServer ? 'pill-amber' : 'pill-blue') + '">' + r.vlanId + '</span></td>' +
            '<td>' + esc(r.name) + '</td>' +
            '<td>' + esc(r.cidr) + '</td>' +
            '<td>' + esc(r.mask) + '</td>' +
            '<td>' + esc(r.gateway) + '</td>' +
            '<td class="wide">' + esc(r.poolStart + ' ~ ' + r.poolEnd) + '</td>' +
            '<td class="num">' + r.usable + '</td>' +
          '</tr>';
        });
        html += '</tbody></table></div>';

        html += '<div class="export-bar">' +
                  '<button class="btn btn-ghost" type="button" id="vlan-copy-md">复制 Markdown 表格</button>' +
                  '<button class="btn btn-ghost" type="button" id="vlan-copy-cisco">复制 Cisco 配置</button>' +
                  '<span class="hint">可直接粘贴进课程设计报告</span>' +
                '</div>';
        html += '<pre class="export" id="vlan-cisco-out" hidden></pre>';
        html += '</div>';
        show(out, html);

        $('vlan-copy-md').addEventListener('click', function () {
          copyText(currentMarkdown, this);
        });
        $('vlan-copy-cisco').addEventListener('click', function () {
          const pre = $('vlan-cisco-out');
          if (pre.hidden) {
            pre.textContent = currentCisco;
            pre.hidden = false;
            this.textContent = '收起 Cisco 配置';
          } else {
            pre.hidden = true;
            this.textContent = '复制 Cisco 配置';
          }
        });
      } catch (e) {
        showError(errBox, e.message);
      }
    }

    $('vlan-run').addEventListener('click', run);
    ['vlan-base', 'vlan-start', 'vlan-groups', 'vlan-hosts', 'octet-head', 'octet-start', 'octet-groups']
      .forEach(function (id) {
        $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
      });
    $('octet-hostbits').addEventListener('change', run);
    $('vlan-add-server').addEventListener('change', run);

    run();
  }

  /* ============================================================
     6. DNS 查询
     ============================================================ */
  function initDns() {
    const domainEl = $('dns-domain');
    const typeEl = $('dns-type');
    const runBtn = $('dns-run');
    const errBox = $('dns-error');
    const loadBox = $('dns-loading');
    const out = $('dns-result');
    const helpEl = $('dns-type-help');

    typeEl.innerHTML = D.TYPES.map(function (t) {
      return '<option value="' + t + '"' + (t === 'A' ? ' selected' : '') + '>' + t + '</option>';
    }).join('');

    function refreshHelp() {
      helpEl.textContent = '说明：' + (D.TYPE_HELP[typeEl.value] || '');
    }
    typeEl.addEventListener('change', refreshHelp);
    refreshHelp();

    function run() {
      hide(errBox); hide(out); hide(loadBox);

      const domain = domainEl.value.trim();
      if (!domain) { showError(errBox, '请输入要查询的域名'); return; }

      loadBox.hidden = false;
      runBtn.disabled = true;
      runBtn.innerHTML = '<span class="spinner"></span>查询中';

      D.query(domain, typeEl.value)
        .then(function (r) {
          hide(loadBox);
          runBtn.disabled = false;
          runBtn.textContent = '查询';

          let html = '<div class="result-block">';
          html += '<div class="result-title">查询结果 ' +
                  '<span class="badge">' + esc(r.query) + ' ' + esc(r.type) + '</span>' +
                  '<span class="pill ' + (r.ok ? 'pill-green' : 'pill-amber') + '">' + esc(r.statusText) + '</span>' +
                  '<span class="pill pill-gray">' + esc(r.provider) + '</span>' +
                  '<span class="pill pill-gray">' + r.elapsed + ' ms</span>' +
                  '</div>';

          if (r.cnameChain.length) {
            html += '<div class="cname-chain"><span class="muted" style="font-family:inherit">CNAME 链路：</span>' +
                    '<span class="node">' + esc(r.query) + '</span>';
            r.cnameChain.forEach(function (c) {
              html += '<span class="muted" style="font-family:inherit">→</span><span class="node">' + esc(c) + '</span>';
            });
            html += '</div>';
          }

          if (!r.ok) {
            html += '<div class="alert alert-error">' +
                    '查询未成功返回记录：' + esc(r.statusText) + '。' +
                    (r.status === 3 ? '域名可能不存在或拼写有误。' :
                     r.status === 5 ? '服务器拒绝了这类查询，可换个记录类型试试。' : '') +
                    '</div>';
          } else if (!r.answers.length) {
            html += '<div class="alert alert-info">该域名没有 ' + esc(r.type) + ' 类型的记录。' +
                    '这不代表出错 —— 比如很多域名不配置 AAAA 或 MX 记录。</div>';
          } else {
            html += '<div class="table-scroll"><table><thead><tr>' +
                    '<th>记录名</th><th>类型</th><th>TTL</th><th>值</th>' +
                    '</tr></thead><tbody>';
            r.answers.forEach(function (a) {
              html += '<tr>' +
                '<td>' + esc(a.name) + '</td>' +
                '<td><span class="pill pill-blue">' + esc(a.type) + '</span></td>' +
                '<td class="num">' + esc(a.ttl) + '</td>' +
                '<td class="wide">' + esc(a.data) + '</td>' +
              '</tr>';
            });
            html += '</tbody></table></div>';
          }

          if (r.authority.length) {
            html += '<p class="muted" style="margin-top:14px">权威段（Authority Section）：' +
                    r.authority.map(function (a) { return esc(a.data); }).join(' · ') + '</p>';
          }

          html += '</div>';
          show(out, html);
        })
        .catch(function (err) {
          hide(loadBox);
          runBtn.disabled = false;
          runBtn.textContent = '查询';
          showError(errBox, err.message);
        });
    }

    runBtn.addEventListener('click', run);
    domainEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });

    $('dns-samples').addEventListener('click', function (e) {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      domainEl.value = chip.dataset.domain;
      typeEl.value = chip.dataset.type;
      refreshHelp();
      run();
    });
  }

  /* ============================================================
     7. IP 换算
     ============================================================ */
  function initConvert() {
    function renderIpToAll() {
      const errBox = $('cv-error');
      const out = $('cv-result');
      hide(errBox);
      try {
        const ip = $('cv-ip').value.trim();
        const n = S.ipToInt(ip);
        const bin = S.intToBinary(n);
        const dottedBin = [0, 8, 16, 24].map(function (i) { return bin.substr(i, 8); }).join('.');

        out.innerHTML = renderKv([
          { k: '点分十进制', v: ip, cls: 'accent' },
          { k: '32 位无符号整数', v: String(n) },
          { k: '二进制（连续）', v: bin },
          { k: '二进制（分段）', v: dottedBin },
          { k: '十六进制', v: '0x' + n.toString(16).toUpperCase().padStart(8, '0') },
          { k: '地址类型', v: S.classify(ip).map(function (c) { return c.label; }).join(' / '), cls: 'green' }
        ]);
      } catch (e) {
        showError(errBox, e.message);
      }
    }

    function renderIntToIp() {
      const errBox = $('cv2-error');
      const out = $('cv2-result');
      hide(errBox);
      try {
        const raw = $('cv-int').value.trim();
        if (!/^\d+$/.test(raw)) throw new Error('请输入非负整数');
        const n = Number(raw);
        if (!Number.isSafeInteger(n)) throw new Error('数值过大');
        if (n > 4294967295) throw new Error('超出 32 位范围，最大值为 4294967295');

        const ip = S.intToIp(n);
        out.innerHTML = renderKv([
          { k: '整数', v: raw, cls: 'accent' },
          { k: '对应 IP', v: ip, cls: 'green' },
          { k: '十六进制', v: '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0') }
        ]);
      } catch (e) {
        showError(errBox, e.message);
      }
    }

    $('cv-run').addEventListener('click', renderIpToAll);
    $('cv-ip').addEventListener('keydown', function (e) { if (e.key === 'Enter') renderIpToAll(); });
    $('cv-run2').addEventListener('click', renderIntToIp);
    $('cv-int').addEventListener('keydown', function (e) { if (e.key === 'Enter') renderIntToIp(); });

    renderIpToAll();
    renderIntToIp();
  }

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    const y = $('year');
    if (y) y.textContent = new Date().getFullYear();

    initTabs();
    initSubnet();
    initDivide();
    initVlan();
    initDns();
    initConvert();
  });
})();
