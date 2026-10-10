/* ============================================================
   dns.js —— 基于 DNS over HTTPS 的在线解析查询
   ------------------------------------------------------------
   关键点：这是纯静态站点，没有自己的后端。
   浏览器无法直接发 DNS 查询（UDP 53 不可用），
   但可以调用公共的 DoH（DNS over HTTPS）接口 —— 本质是把
   DNS 查询封装成 HTTPS 请求，返回 JSON。

   这种做法本身就是个可以写进简历的技术点：
   用 DoH 绕过浏览器沙箱的限制，实现零后端的 DNS 查询。

   支持的记录类型对应 RFC 编号，见 TYPE_MAP
   ============================================================ */

(function () {
  'use strict';

  /* DNS 记录类型 → 编号（DoH 接口用数字表示类型） */
  const TYPE_MAP = {
    A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12,
    MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257, ANY: 255
  };

  /* 记录编号 → 可读名称（用于解析响应） */
  const CODE_NAME = {};
  Object.keys(TYPE_MAP).forEach(function (k) { CODE_NAME[TYPE_MAP[k]] = k; });

  /* 响应码含义（RFC 1035 / 6895） */
  const RCODE = {
    0: 'NOERROR · 查询成功',
    1: 'FORMERR · 请求格式错误',
    2: 'SERVFAIL · 服务器故障',
    3: 'NXDOMAIN · 域名不存在',
    4: 'NOTIMP · 服务器不支持该查询类型',
    5: 'REFUSED · 服务器拒绝查询'
  };

  /* 多个公共 DoH 提供方，按顺序尝试，前面失败自动切换下一个
     注意：dns.google 在中国大陆不可访问，因此把它放在最后作为兜底；
     阿里公共 DNS 在国内速度快且未受限制，作为国内主力 */
  const PROVIDERS = [
    {
      name: 'Cloudflare',
      region: '全球',
      build: function (name, type) {
        return 'https://cloudflare-dns.com/dns-query?name=' +
               encodeURIComponent(name) + '&type=' + type;
      }
    },
    {
      name: '阿里公共 DNS',
      region: '国内',
      build: function (name, type) {
        return 'https://dns.alidns.com/resolve?name=' +
               encodeURIComponent(name) + '&type=' + type;
      }
    },
    {
      name: 'Google Public DNS',
      region: '海外',
      build: function (name, type) {
        return 'https://dns.google/resolve?name=' +
               encodeURIComponent(name) + '&type=' + type;
      }
    }
  ];

  const TIMEOUT_MS = 12000;

  /** 带超时的 fetch，避免网络不通时一直挂着 */
  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, { headers: { Accept: 'application/dns-json' } });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /** 校验域名基本格式（允许末尾带点、允许 punycode） */
  function validateDomain(domain) {
    const d = String(domain || '').trim().replace(/\.$/, '');
    if (!d) throw new Error('请输入要查询的域名');
    if (d.length > 253) throw new Error('域名长度不能超过 253 个字符');
    if (!/^[a-zA-Z0-9\u4e00-\u9fa5][a-zA-Z0-9\-._\u4e00-\u9fa5]*$/.test(d)) {
      throw new Error('域名含非法字符：' + d);
    }
    if (d.indexOf('.') === -1) {
      throw new Error('请输入完整域名，如 example.com');
    }
    return d;
  }

  /**
   * 查询一条记录
   * @returns {Promise<object>} 归一化后的结果
   */
  function query(domain, type) {
    return new Promise(function (resolve, reject) {
      let name, t;
      try {
        name = validateDomain(domain);
        t = String(type || 'A').toUpperCase();
        if (!TYPE_MAP[t]) throw new Error('不支持的记录类型：' + t);
      } catch (e) {
        reject(e);
        return;
      }

      const started = Date.now();
      let lastErr = null;

      // 依次尝试各个提供方
      const tryAt = function (idx) {
        if (idx >= PROVIDERS.length) {
          reject(new Error(
            '已依次尝试 Cloudflare、阿里公共 DNS、Google Public DNS，均无法连接。' +
            '原因通常是当前网络限制了境外 HTTPS 访问（校园网、公司内网较常见）。' +
            (lastErr ? '最后一次错误：' + lastErr.message : '')
          ));
          return;
        }
        const p = PROVIDERS[idx];

        fetchWithTimeout(p.build(name, t), TIMEOUT_MS)
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (json) {
            resolve(normalize(json, name, t, p.name, Date.now() - started));
          })
          .catch(function (err) {
            lastErr = err;
            tryAt(idx + 1);
          });
      };

      tryAt(0);
    });
  }

  /** 把不同提供方的响应归一化成统一结构 */
  function normalize(json, name, type, provider, elapsed) {    const answers = (json.Answer || []).map(function (a) {
      return {
        name: String(a.name || '').replace(/\.$/, ''),
        typeCode: a.type,
        type: CODE_NAME[a.type] || ('TYPE' + a.type),
        ttl: a.TTL,
        data: String(a.data == null ? '' : a.data)
      };
    });

    const authority = (json.Authority || []).map(function (a) {
      return {
        name: String(a.name || '').replace(/\.$/, ''),
        type: CODE_NAME[a.type] || ('TYPE' + a.type),
        ttl: a.TTL,
        data: String(a.data == null ? '' : a.data)
      };
    });

    const chain = [];
    if (json.Answer) {
      json.Answer.forEach(function (a) {
        if (a.type === 5) chain.push(String(a.data).replace(/\.$/, ''));
      });
    }

    return {
      query: name,
      type: type,
      provider: provider,
      elapsed: elapsed,
      status: json.Status,
      statusText: RCODE[json.Status] || ('未知状态码 ' + json.Status),
      ok: json.Status === 0,
      truncated: !!json.TC,
      answers: answers,
      authority: authority,
      cnameChain: chain
    };
  }

  /** 记录类型说明，用于界面上做提示 */
  const TYPE_HELP = {
    A: '把域名指向一个 IPv4 地址，最常见的记录',
    AAAA: '把域名指向一个 IPv6 地址',
    CNAME: '域名别名，把域名指向另一个域名',
    MX: '邮件服务器记录，指明由哪台服务器收信',
    TXT: '文本记录，常用于域名所有权验证与 SPF 反垃圾邮件',
    NS: '该域名由哪些权威 DNS 服务器负责解析',
    SOA: '起始授权记录，描述该区域的主服务器与序列号',
    SRV: '服务记录，指明某项服务的主机与端口',
    CAA: '指定哪些证书颁发机构可以为该域名签发证书',
    PTR: '反向解析，由 IP 查域名（通常配合 in-addr.arpa）',
    ANY: '请求所有记录（多数服务器出于安全考虑会拒绝）'
  };

  const api = {
    query: query,
    validateDomain: validateDomain,
    TYPES: Object.keys(TYPE_MAP),
    TYPE_HELP: TYPE_HELP,
    RCODE: RCODE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NetDns = api;
})();
