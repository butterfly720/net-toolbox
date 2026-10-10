/* ============================================================
   vlan.js —— 校园网 VLAN 规划器
   ------------------------------------------------------------
   把「每组需要多少台主机」自动翻译成一整套 VLAN 方案：
   VLAN ID、名称、网段、网关、DHCP 地址池、广播地址

   两种分配模式：
     sequential —— 从基础网段顺序切分（适合任意网段规划）
     vlanAsOctet —— VLAN 号直接作为第三段（校园网常见做法，
                    如 VLAN 21 → 192.168.21.0/24，一眼能对应）
   ============================================================ */

(function () {
  'use strict';

  const S = (typeof module !== 'undefined' && module.exports)
    ? require('./subnet.js')
    : window.NetSubnet;

  /**
   * 顺序分配模式
   * @param {object} cfg
   *   baseCidr    基础网段，如 "192.168.0.0/16"
   *   startVlan   起始 VLAN ID
   *   groups      组数
   *   hostsPerGroup 每组主机数
   *   namePrefix  名称前缀
   */
  function planSequential(cfg) {
    const parsed = S.parseCidr(cfg.baseCidr);
    if (parsed.prefix === null) throw new Error('基础网段需带前缀，如 192.168.0.0/16');

    const base = S.calculate(parsed.ip, parsed.prefix);
    const startVlan = Number(cfg.startVlan);
    const groups = Number(cfg.groups);
    const hosts = Number(cfg.hostsPerGroup);

    if (!(startVlan >= 1 && startVlan <= 4094)) throw new Error('VLAN ID 需在 1~4094 之间');
    if (!(groups >= 1 && groups <= 200)) throw new Error('组数建议在 1~200 之间');
    if (!(hosts >= 1)) throw new Error('每组主机数需大于 0');

    const prefix = S.prefixForHosts(hosts);
    const step = Math.pow(2, 32 - prefix);
    const total = Math.pow(2, 32 - base.prefix);

    if (groups * step > total) {
      throw new Error(
        '基础网段 ' + base.cidr + ' 最多容纳 ' + Math.floor(total / step) +
        ' 个 /' + prefix + ' 子网，无法分配 ' + groups + ' 组'
      );
    }

    const list = [];
    for (let i = 0; i < groups; i++) {
      const net = base.network + i * step;
      const c = S.calculate(S.intToIp(net), prefix);
      const vlanId = startVlan + i;
      if (vlanId > 4094) throw new Error('VLAN ID 超出 4094 上限');

      list.push(buildRow(vlanId, (cfg.namePrefix || 'VLAN') + (vlanId), c, prefix));
    }

    return {
      mode: 'sequential',
      prefix: prefix,
      baseCidr: base.cidr,
      list: list,
      summary: summarize(list, total, base)
    };
  }

  /**
   * VLAN 号作第三段模式
   * 例：基线 192.168 + VLAN 21 → 192.168.21.0/24
   * @param {object} cfg
   *   octetPrefix  前两段，如 "192.168"
   *   startVlan    起始 VLAN ID
   *   groups       组数
   *   namePrefix   名称前缀
   *   hostBits     主机位（默认 8 → /24）
   */
  function planVlanAsOctet(cfg) {
    const head = String(cfg.octetPrefix || '').trim().replace(/\.$/, '');
    if (!/^\d{1,3}\.\d{1,3}$/.test(head)) {
      throw new Error('前两段格式应如 192.168');
    }

    const startVlan = Number(cfg.startVlan);
    const groups = Number(cfg.groups);
    const hostBits = Number(cfg.hostBits || 8);
    const prefix = 32 - hostBits;

    if (!(startVlan >= 1 && startVlan <= 4094)) throw new Error('VLAN ID 需在 1~4094 之间');
    if (!(groups >= 1 && groups <= 200)) throw new Error('组数建议在 1~200 之间');
    if (!(hostBits >= 2 && hostBits <= 16)) throw new Error('主机位需在 2~16 之间');

    const list = [];
    for (let i = 0; i < groups; i++) {
      const vlanId = startVlan + i;
      if (vlanId > 4094) throw new Error('VLAN ID 超出 4094 上限');
      if (vlanId > 255) throw new Error('VLAN 号作第三段时不能超过 255，请改用顺序分配模式');

      const cidr = head + '.' + vlanId + '.0/' + prefix;
      const c = S.calculate(head + '.' + vlanId + '.0', prefix);
      list.push(buildRow(vlanId, (cfg.namePrefix || 'VLAN') + vlanId, c, prefix));
    }

    return {
      mode: 'vlanAsOctet',
      prefix: prefix,
      baseCidr: head + '.0.0/' + prefix,
      list: list,
      summary: summarize(list, Math.pow(2, 32 - prefix) * groups, null)
    };
  }

  /** 组装输出行：网段信息 + 网关 + DHCP 池 */
  function buildRow(vlanId, name, c, prefix) {
    const first = c.firstHost;
    const last = c.lastHost;
    const gateway = first;                                  // 网关取首个可用地址
    const poolStart = prefix >= 31 ? first : first + 9;     // 前若干地址留给静态设备
    const poolEnd = last;

    return {
      vlanId: vlanId,
      name: name,
      cidr: c.cidr,
      mask: c.maskText,
      network: c.networkText,
      broadcast: c.broadcastText,
      firstHost: S.intToIp(first),
      lastHost: S.intToIp(last),
      gateway: S.intToIp(gateway),
      poolStart: S.intToIp(Math.min(poolStart, last)),
      poolEnd: S.intToIp(poolEnd),
      usable: c.usable,
      prefix: prefix,
      demandName: null
    };
  }

  /** 汇总统计 */
  function summarize(list, totalAddresses, base) {
    let usable = 0;
    let used = 0;
    list.forEach(function (r) {
      usable += r.usable;
      used += Math.pow(2, 32 - r.prefix);
    });
    return {
      vlanCount: list.length,
      totalUsable: usable,
      usedAddresses: used,
      totalAddresses: totalAddresses,
      utilization: totalAddresses ? Math.round((used / totalAddresses) * 1000) / 10 : 0,
      vlanRange: list.length ? (list[0].vlanId + ' ~ ' + list[list.length - 1].vlanId) : '-',
      prefix: list.length ? list[0].prefix : null
    };
  }

  /** 生成可直接粘进报告的表格文本（Markdown） */
  function toMarkdownTable(list) {
    const head = '| VLAN ID | 名称 | 网段 | 子网掩码 | 网关 | DHCP 地址池 | 可用主机数 |\n' +
                 '|---|---|---|---|---|---|---|\n';
    return head + list.map(function (r) {
      return '| ' + r.vlanId + ' | ' + r.name + ' | ' + r.cidr + ' | ' + r.mask + ' | ' +
             r.gateway + ' | ' + r.poolStart + ' ~ ' + r.poolEnd + ' | ' + r.usable + ' |';
    }).join('\n');
  }

  /** 生成 Cisco 风格的配置片段（便于贴进 Packet Tracer 实验） */
  function toCiscoCommands(list) {
    const lines = [];
    list.forEach(function (r) {
      lines.push('! ---- VLAN ' + r.vlanId + ' ' + r.name + ' ----');
      lines.push('vlan ' + r.vlanId);
      lines.push(' name ' + r.name);
      lines.push('exit');
      lines.push('interface vlan ' + r.vlanId);
      lines.push(' description ' + r.name);
      lines.push(' ip address ' + r.gateway + ' ' + r.mask);
      lines.push(' no shutdown');
      lines.push('exit');
      lines.push('');
    });
    return lines.join('\n');
  }

  const api = {
    planSequential: planSequential,
    planVlanAsOctet: planVlanAsOctet,
    toMarkdownTable: toMarkdownTable,
    toCiscoCommands: toCiscoCommands
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NetVlan = api;
})();
