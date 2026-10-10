/* ============================================================
   subnet.js —— IPv4 子网计算核心算法
   ------------------------------------------------------------
   纯函数模块，不依赖 DOM，可在浏览器和 Node 中运行
   （便于单独写单元测试验证算法正确性）

   导出：
     ipToInt / intToIp / intToBinary
     prefixToMask / maskToPrefix
     parseCidr
     calculate          单个网段的完整信息
     classify           地址类型判定
     prefixForHosts     按主机数反推前缀
     splitInto          等分为 N 个子网
     planVlsm           按需求列表做变长子网划分
   ============================================================ */

(function () {
  'use strict';

  /* ---------- 基础转换 ---------- */

  /**
   * IPv4 点分字符串 → 无符号 32 位整数
   * 用乘法累加而非位移，避免 JS 位运算的 32 位有符号陷阱
   */
  function ipToInt(ip) {
    const parts = String(ip).trim().split('.');
    if (parts.length !== 4) {
      throw new Error('IP 格式应为 a.b.c.d，当前为「' + ip + '」');
    }
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const seg = parts[i];
      if (!/^\d{1,3}$/.test(seg)) {
        throw new Error('第 ' + (i + 1) + ' 段不是 0~255 的整数：「' + seg + '」');
      }
      const v = Number(seg);
      if (v > 255) {
        throw new Error('第 ' + (i + 1) + ' 段超过 255：「' + seg + '」');
      }
      n = n * 256 + v;
    }
    return n >>> 0;
  }

  /** 无符号 32 位整数 → IPv4 点分字符串 */
  function intToIp(n) {
    n = n >>> 0;
    return [
      (n >>> 24) & 255,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255
    ].join('.');
  }

  /** 无符号 32 位整数 → 32 位二进制串（不含分隔） */
  function intToBinary(n) {
    return (n >>> 0).toString(2).padStart(32, '0');
  }

  /** 32 位二进制串 → 点分十进制（每 8 位一组） */
  function binaryToIp(bin) {
    const b = String(bin).replace(/[^01]/g, '');
    if (b.length !== 32) throw new Error('二进制应为 32 位，当前 ' + b.length + ' 位');
    return [0, 8, 16, 24]
      .map(function (i) { return parseInt(b.substr(i, 8), 2); })
      .join('.');
  }

  /* ---------- 掩码 ---------- */

  /** 前缀长度 → 子网掩码（无符号整数） */
  function prefixToMask(prefix) {
    if (prefix === 0) return 0;
    return (0xFFFFFFFF << (32 - prefix)) >>> 0;
  }

  /** 子网掩码 → 前缀长度；掩码不连续则抛错 */
  function maskToPrefix(mask) {
    let m = ipToInt(mask);
    // 校验连续性：取反后加 1 应为 2 的幂
    const inv = (~m) >>> 0;
    if ((inv & (inv + 1)) !== 0) {
      throw new Error('掩码不连续，不是合法的子网掩码：' + mask);
    }
    let prefix = 0;
    for (let i = 31; i >= 0; i--) {
      if ((m >>> i) & 1) prefix++;
      else break;
    }
    return prefix;
  }

  /** 反掩码（通配符掩码），ACL 中常用 */
  function wildcardOf(mask) {
    return (~mask) >>> 0;
  }

  /* ---------- CIDR 解析 ---------- */

  /** "192.168.1.10/24" → { ip, prefix } */
  function parseCidr(text) {
    const s = String(text).trim();
    const slash = s.indexOf('/');
    if (slash === -1) {
      return { ip: s, prefix: null };
    }
    const ip = s.slice(0, slash).trim();
    const p = s.slice(slash + 1).trim();

    let prefix;
    if (/^\d{1,2}$/.test(p)) {
      prefix = Number(p);
    } else if (p.indexOf('.') !== -1) {
      // 也允许写成 /255.255.255.0
      prefix = maskToPrefix(p);
    } else {
      throw new Error('前缀写法不支持：「' + p + '」，应写 0~32 或点分掩码');
    }

    if (prefix < 0 || prefix > 32) throw new Error('前缀长度需在 0~32 之间');
    return { ip: ip, prefix: prefix };
  }

  /* ---------- 地址类型判定 ---------- */

  const PRIVATE_RANGES = [
    { net: '10.0.0.0', prefix: 8, label: '私有地址（A 类）', note: 'RFC 1918' },
    { net: '172.16.0.0', prefix: 12, label: '私有地址（B 类）', note: 'RFC 1918' },
    { net: '192.168.0.0', prefix: 16, label: '私有地址（C 类）', note: 'RFC 1918' }
  ];

  const SPECIAL_RANGES = [
    { net: '0.0.0.0', prefix: 8, label: '本网络保留', note: 'RFC 1122' },
    { net: '100.64.0.0', prefix: 10, label: '运营商级 NAT（CGN）', note: 'RFC 6598' },
    { net: '127.0.0.0', prefix: 8, label: '环回地址', note: 'RFC 1122' },
    { net: '169.254.0.0', prefix: 16, label: '链路本地（APIPA）', note: 'RFC 3927' },
    { net: '192.0.2.0', prefix: 24, label: '文档测试用（TEST-NET-1）', note: 'RFC 5737' },
    { net: '198.18.0.0', prefix: 15, label: '基准测试保留', note: 'RFC 2544' },
    { net: '198.51.100.0', prefix: 24, label: '文档测试用（TEST-NET-2）', note: 'RFC 5737' },
    { net: '203.0.113.0', prefix: 24, label: '文档测试用（TEST-NET-3）', note: 'RFC 5737' },
    { net: '224.0.0.0', prefix: 4, label: '组播地址', note: 'RFC 5771' },
    { net: '240.0.0.0', prefix: 4, label: '保留/实验用', note: 'RFC 1112' },
    { net: '255.255.255.255', prefix: 32, label: '受限广播', note: 'RFC 919' }
  ];

  /** 判定某 IP 是否落在 [net/prefix] 内 */
  function inRange(ipInt, net, prefix) {
    const m = prefixToMask(prefix);
    return (ipInt & m) >>> 0 === (ipToInt(net) & m) >>> 0;
  }

  /**
   * 地址类型判定，返回数组（可能同时命中多条，如 127.0.0.1 既是环回也属私有网段之外）
   */
  function classify(ip) {
    const n = ipToInt(ip);
    const hits = [];

    PRIVATE_RANGES.forEach(function (r) {
      if (inRange(n, r.net, r.prefix)) {
        hits.push({ kind: 'private', label: r.label, note: r.note });
      }
    });
    SPECIAL_RANGES.forEach(function (r) {
      if (inRange(n, r.net, r.prefix)) {
        hits.push({ kind: 'special', label: r.label, note: r.note });
      }
    });

    if (!hits.length) {
      hits.push({ kind: 'public', label: '公网地址', note: '全球可路由' });
    }
    return hits;
  }

  /* ---------- 核心计算 ---------- */

  /**
   * 计算一个网段的完整信息
   * @param {string} ip      任意 IP（不必是网络地址，会自动归一化）
   * @param {number} prefix  前缀长度 0~32
   */
  function calculate(ip, prefix) {
    if (prefix === null || prefix === undefined) {
      const p = parseCidr(ip);
      ip = p.ip;
      prefix = p.prefix;
      if (prefix === null) throw new Error('缺少前缀长度，请写成 192.168.1.0/24 或单独指定');
    }
    if (!(prefix >= 0 && prefix <= 32)) throw new Error('前缀长度需在 0~32 之间');

    const ipInt = ipToInt(ip);
    const mask = prefixToMask(prefix);
    const network = (ipInt & mask) >>> 0;          // 网络地址
    const wildcard = wildcardOf(mask);              // 反掩码
    const broadcast = (network | wildcard) >>> 0;   // 广播地址
    const total = Math.pow(2, 32 - prefix);         // 总地址数

    // /31 与 /32 是特例：RFC 3021 允许 /31 两点直连，无广播语义
    let firstHost, lastHost, usable, hostNote;
    if (prefix === 32) {
      firstHost = network; lastHost = network; usable = 1;
      hostNote = '单主机（/32），不是网段';
    } else if (prefix === 31) {
      firstHost = network; lastHost = broadcast; usable = 2;
      hostNote = 'RFC 3021 点对点链路，两端均可用';
    } else {
      firstHost = (network + 1) >>> 0;
      lastHost = (broadcast - 1) >>> 0;
      usable = total - 2;
      hostNote = '扣除网络地址与广播地址';
    }

    return {
      inputIp: ip,
      ipInt: ipInt,
      prefix: prefix,
      mask: mask,
      maskText: intToIp(mask),
      wildcard: wildcard,
      wildcardText: intToIp(wildcard),
      network: network,
      networkText: intToIp(network),
      broadcast: broadcast,
      broadcastText: intToIp(broadcast),
      cidr: intToIp(network) + '/' + prefix,
      firstHostText: intToIp(firstHost),
      lastHostText: intToIp(lastHost),
      firstHost: firstHost,
      lastHost: lastHost,
      usable: usable,
      total: total,
      hostNote: hostNote,
      isNetworkAddress: ipInt === network,
      classes: classify(ip),
      binary: {
        ip: intToBinary(ipInt),
        mask: intToBinary(mask),
        network: intToBinary(network),
        broadcast: intToBinary(broadcast)
      }
    };
  }

  /* ---------- 子网划分 ---------- */

  /** 按可用主机数反推所需前缀 */
  function prefixForHosts(hosts) {
    const need = Math.max(2, Number(hosts) + 2); // +2 网络号与广播
    let bits = 1;
    while (Math.pow(2, bits) < need) bits++;
    if (bits > 32) throw new Error('主机数过大，超出一个 /0 的容量');
    return 32 - bits;
  }

  /** 按子网个数反推所需前缀（向上取整的 log2） */
  function prefixForSubnets(basePrefix, count) {
    let bits = 0;
    while (Math.pow(2, bits) < count) bits++;
    const p = basePrefix + bits;
    if (p > 32) {
      throw new Error(
        '从 /' + basePrefix + ' 划分 ' + count + ' 个子网需再借 ' + bits +
        ' 位主机号，前缀将变成 /' + p + '，超出 32 位上限'
      );
    }
    return p;
  }

  /**
   * 把 baseCidr 等分为 count 个子网
   * @returns {Array} 每个元素为 calculate() 的结果
   */
  function splitInto(baseCidr, count) {
    const parsed = parseCidr(baseCidr);
    if (parsed.prefix === null) throw new Error('基础网段需要带前缀，如 192.168.1.0/24');
    const base = calculate(parsed.ip, parsed.prefix);

    const n = Number(count);
    if (!(n >= 1)) throw new Error('子网个数至少为 1');
    const newPrefix = prefixForSubnets(base.prefix, n);
    const step = Math.pow(2, 32 - newPrefix);

    const list = [];
    for (let i = 0; i < n; i++) {
      const net = base.network + i * step;
      list.push(calculate(intToIp(net), newPrefix));
    }
    return { basePrefix: base.prefix, newPrefix: newPrefix, step: step, list: list };
  }

  /**
   * VLSM：按各部门所需主机数做变长划分
   * @param {string} baseCidr  如 "192.168.0.0/22"
   * @param {Array}  demands   [{ name, hosts }]，按数量从大到小排序后依次分配
   */
  function planVlsm(baseCidr, demands) {
    const parsed = parseCidr(baseCidr);
    if (parsed.prefix === null) throw new Error('基础网段需要带前缀，如 192.168.0.0/22');
    const base = calculate(parsed.ip, parsed.prefix);

    const total = Math.pow(2, 32 - base.prefix);
    if (!demands || !demands.length) throw new Error('请至少填写一条地址需求');

    // 贪心：主机数多的先分，避免碎片
    const reqs = demands
      .map(function (d) {
        return { name: d.name, hosts: Number(d.hosts) };
      })
      .filter(function (d) { return d.hosts > 0; })
      .sort(function (a, b) { return b.hosts - a.hosts; });

    if (!reqs.length) throw new Error('主机数需大于 0');

    let cursor = base.network;
    const limit = base.network + total;
    const allocated = [];

    reqs.forEach(function (r) {
      const p = prefixForHosts(r.hosts);
      const size = Math.pow(2, 32 - p);
      if (cursor + size > limit) {
        throw new Error(
          '地址空间不足：分配「' + r.name + '」需要 ' + size + ' 个地址，已超出 ' + base.cidr
        );
      }
      const c = calculate(intToIp(cursor), p);
      c.demandName = r.name;
      c.demandHosts = r.hosts;
      allocated.push(c);
      cursor += size;
    });

    const usedSize = cursor - base.network;
    return {
      base: base,
      list: allocated,
      usedAddresses: usedSize,
      totalAddresses: total,
      freeAddresses: total - usedSize,
      utilization: Math.round((usedSize / total) * 1000) / 10
    };
  }

  /* ---------- 导出 ---------- */
  const api = {
    ipToInt: ipToInt,
    intToIp: intToIp,
    intToBinary: intToBinary,
    binaryToIp: binaryToIp,
    prefixToMask: prefixToMask,
    maskToPrefix: maskToPrefix,
    wildcardOf: wildcardOf,
    parseCidr: parseCidr,
    classify: classify,
    calculate: calculate,
    prefixForHosts: prefixForHosts,
    prefixForSubnets: prefixForSubnets,
    splitInto: splitInto,
    planVlsm: planVlsm
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NetSubnet = api;
})();
