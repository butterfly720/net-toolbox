/* VLAN 规划器测试 —— 含课程设计真实场景校验 */
const V = require('../js/vlan.js');
const S = require('../js/subnet.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      期望: ' + e + '\n      实际: ' + a); }
}

console.log('\n【1. 顺序分配模式】');
const r1 = V.planSequential({
  baseCidr: '192.168.0.0/16',
  startVlan: 21,
  groups: 6,
  hostsPerGroup: 60,
  namePrefix: 'VLAN'
});
eq(r1.prefix, 26, '60 台主机 -> /26');
eq(r1.list.length, 6, '分配 6 个 VLAN');
eq(r1.list.map(x => x.vlanId), [21,22,23,24,25,26], 'VLAN ID 21~26');
eq(r1.list[0].cidr, '192.168.0.0/26', '首个网段');
eq(r1.list[1].cidr, '192.168.0.64/26', '第二个网段紧接');
eq(r1.list[0].gateway, '192.168.0.1', '网关为首个可用地址');
eq(r1.list[0].usable, 62, '/26 可用 62 台');

console.log('\n【2. 课程设计真实场景 —— 192.168.21.0/24 起，每 VLAN /24】');
const r2 = V.planSequential({
  baseCidr: '192.168.0.0/16',
  startVlan: 21,
  groups: 6,
  hostsPerGroup: 200,
  namePrefix: 'VLAN'
});
eq(r2.prefix, 24, '200 台 -> /24');
eq(r2.list[0].cidr, '192.168.0.0/24', '首段 /24');
eq(r2.list[5].cidr, '192.168.5.0/24', '第六段');
eq(r2.summary.vlanRange, '21 ~ 26', 'VLAN 区间正确');
eq(r2.summary.totalUsable, 254 * 6, '总可用主机数');

console.log('\n【3. VLAN 号作第三段模式（校园网常见）】');
const r3 = V.planVlanAsOctet({
  octetPrefix: '192.168',
  startVlan: 21,
  groups: 6,
  namePrefix: 'VLAN'
});
eq(r3.list[0].cidr, '192.168.21.0/24', 'VLAN 21 -> 192.168.21.0/24');
eq(r3.list[5].cidr, '192.168.26.0/24', 'VLAN 26 -> 192.168.26.0/24');
eq(r3.list[0].gateway, '192.168.21.1', '网关 192.168.21.1');
eq(r3.list[0].poolStart, '192.168.21.10', 'DHCP 池从第 10 个地址起');
eq(r3.list[0].poolEnd, '192.168.21.254', 'DHCP 池到末位');
eq(r3.list[0].broadcast, '192.168.21.255', '广播地址');

console.log('\n【4. 服务器区 VLAN 对齐课程设计】');
const srv = S.calculate('192.168.200.0', 24);
eq(srv.networkText, '192.168.200.0', '服务器区网段');
eq(S.intToIp(srv.firstHost + 1), '192.168.200.2', 'DNS 服务器 192.168.200.1 之后的下一地址');
eq(S.intToIp(srv.firstHost + 2), '192.168.200.3', 'FTP 服务器地址');

console.log('\n【5. 输出格式 —— 可直接粘进报告】');
const md = V.toMarkdownTable(r3.list);
eq(md.split('\n').length, 8, 'Markdown 表格行数 = 表头2行 + 6行数据');
eq(md.includes('| 21 |'), true, '表格含 VLAN 21');
eq(md.includes('192.168.21.0/24'), true, '表格含网段');

const cisco = V.toCiscoCommands(r3.list.slice(0, 1));
eq(cisco.includes('vlan 21'), true, 'Cisco 片段含 vlan 21');
eq(cisco.includes('name VLAN21'), true, 'Cisco 片段含名称');
eq(cisco.includes('ip address 192.168.21.1 255.255.255.0'), true, 'Cisco 片段含三层接口地址');

console.log('\n【6. 边界与错误处理】');
function throws(fn, label) {
  try { fn(); fail++; console.log('  ✗ ' + label + '（未抛错）'); }
  catch (e) { pass++; console.log('  ✓ ' + label + ' → ' + e.message); }
}
throws(() => V.planSequential({ baseCidr: '192.168.0.0/24', startVlan: 21, groups: 6, hostsPerGroup: 200 }),
       '基础网段容量不足');
throws(() => V.planSequential({ baseCidr: '192.168.0.0/16', startVlan: 4090, groups: 10, hostsPerGroup: 50 }),
       'VLAN ID 超出上限');
throws(() => V.planSequential({ baseCidr: '192.168.0.0/16', startVlan: 21, groups: 0, hostsPerGroup: 50 }),
       '组数为 0');
throws(() => V.planVlanAsOctet({ octetPrefix: '192', startVlan: 21, groups: 3 }),
       '前两段格式错误');
throws(() => V.planVlanAsOctet({ octetPrefix: '192.168', startVlan: 250, groups: 10 }),
       'VLAN 号超过 255 无法作第三段');

console.log('\n' + '='.repeat(46));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(46) + '\n');
process.exit(fail === 0 ? 0 : 1);
