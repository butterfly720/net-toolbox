/* 子网算法单元测试 —— 用 node 运行验证正确性 */
const S = require('../js/subnet.js');

let pass = 0, fail = 0;

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      期望: ' + e + '\n      实际: ' + a); }
}

console.log('\n【1. IP 与整数互转】');
eq(S.ipToInt('0.0.0.0'), 0, '0.0.0.0 -> 0');
eq(S.ipToInt('255.255.255.255'), 4294967295, '255.255.255.255 -> 4294967295');
eq(S.ipToInt('192.168.1.1'), 3232235777, '192.168.1.1 -> 3232235777');
eq(S.intToIp(3232235777), '192.168.1.1', '3232235777 -> 192.168.1.1');
eq(S.intToIp(4294967295), '255.255.255.255', '边界值回环');

console.log('\n【2. 二进制转换】');
eq(S.intToBinary(3232235777), '11000000101010000000000100000001', '192.168.1.1 二进制');
eq(S.binaryToIp('11000000101010000000000100000001'), '192.168.1.1', '二进制回转 IP');
eq(S.intToBinary(0).length, 32, '二进制补齐 32 位');

console.log('\n【3. 掩码与前缀】');
eq(S.prefixToMask(24), 4294967040, '/24 掩码整数');
eq(S.intToIp(S.prefixToMask(24)), '255.255.255.0', '/24 -> 255.255.255.0');
eq(S.intToIp(S.prefixToMask(26)), '255.255.255.192', '/26 -> 255.255.255.192');
eq(S.intToIp(S.prefixToMask(0)), '0.0.0.0', '/0 -> 0.0.0.0');
eq(S.intToIp(S.prefixToMask(32)), '255.255.255.255', '/32 -> 全 1');
eq(S.maskToPrefix('255.255.255.192'), 26, '掩码反推前缀');
eq(S.intToIp(S.wildcardOf(S.prefixToMask(24))), '0.0.0.255', '/24 反掩码');

console.log('\n【4. CIDR 解析】');
eq(S.parseCidr('192.168.1.10/24'), { ip: '192.168.1.10', prefix: 24 }, '标准 CIDR');
eq(S.parseCidr('10.0.0.0/255.0.0.0').prefix, 8, '点分掩码写法');
eq(S.parseCidr('192.168.1.1').prefix, null, '无前缀');

console.log('\n【5. 网段计算 —— 课程设计常用场景】');
const a = S.calculate('192.168.21.0', 24);
eq(a.networkText, '192.168.21.0', '/24 网络地址');
eq(a.broadcastText, '192.168.21.255', '/24 广播地址');
eq(a.maskText, '255.255.255.0', '/24 掩码');
eq(a.firstHostText, '192.168.21.1', '/24 首个可用');
eq(a.lastHostText, '192.168.21.254', '/24 末个可用');
eq(a.usable, 254, '/24 可用主机数');
eq(a.total, 256, '/24 总地址数');
eq(a.cidr, '192.168.21.0/24', '归一化 CIDR');

const b = S.calculate('192.168.200.2', 24);
eq(b.networkText, '192.168.200.0', '输入主机地址时能被归一化');
eq(b.isNetworkAddress, false, '标记出输入不是网络地址');

console.log('\n【6. /26 子网（每组 60 台主机的场景）】');
const c = S.calculate('192.168.21.64', 26);
eq(c.networkText, '192.168.21.64', '/26 网络地址');
eq(c.broadcastText, '192.168.21.127', '/26 广播地址');
eq(c.usable, 62, '/26 可用主机数');
eq(c.maskText, '255.255.255.192', '/26 掩码');

console.log('\n【7. 边界前缀特例】');
eq(S.calculate('10.0.0.1', 32).usable, 1, '/32 单主机');
eq(S.calculate('10.0.0.0', 31).usable, 2, '/31 点对点');
eq(S.calculate('0.0.0.0', 0).total, 4294967296, '/0 总地址数');

console.log('\n【8. 地址类型判定】');
eq(S.classify('192.168.1.1')[0].kind, 'private', '192.168.x.x 判定为私有');
eq(S.classify('10.1.2.3')[0].kind, 'private', '10.x.x.x 判定为私有');
eq(S.classify('172.16.5.5')[0].kind, 'private', '172.16.x.x 判定为私有');
eq(S.classify('8.8.8.8')[0].kind, 'public', '8.8.8.8 判定为公网');
eq(S.classify('127.0.0.1').some(x => x.kind === 'special'), true, '127.0.0.1 命中特殊段');
eq(S.classify('169.254.1.1').some(x => x.label.includes('链路本地')), true, '169.254.x.x 链路本地');
eq(S.classify('224.0.0.1').some(x => x.label.includes('组播')), true, '224.x 组播');

console.log('\n【9. 按主机数反推前缀】');
eq(S.prefixForHosts(2), 30, '2 台主机 -> /30');
eq(S.prefixForHosts(60), 26, '60 台主机 -> /26');
eq(S.prefixForHosts(62), 26, '62 台主机 -> /26');
eq(S.prefixForHosts(100), 25, '100 台主机 -> /25');
eq(S.prefixForHosts(254), 24, '254 台主机 -> /24');
eq(S.prefixForHosts(500), 23, '500 台主机 -> /23');

console.log('\n【10. 等分子网】');
const sp = S.splitInto('192.168.21.0/24', 4);
eq(sp.newPrefix, 26, '/24 分 4 个子网 -> /26');
eq(sp.list.length, 4, '产生 4 个子网');
eq(sp.list.map(x => x.cidr),
   ['192.168.21.0/26','192.168.21.64/26','192.168.21.128/26','192.168.21.192/26'],
   '子网边界正确');

console.log('\n【11. VLSM 变长划分】');
const v = S.planVlsm('192.168.0.0/22', [
  { name: '研发部', hosts: 100 },
  { name: '市场部', hosts: 50 },
  { name: '财务部', hosts: 20 }
]);
eq(v.list.length, 3, '分配 3 个网段');
eq(v.list[0].demandName, '研发部', '需求最大的优先分配');
eq(v.list[0].prefix, 25, '100 台 -> /25');
eq(v.list[1].prefix, 26, '50 台 -> /26');
eq(v.list[2].prefix, 27, '20 台 -> /27');
eq(v.list[0].networkText, '192.168.0.0', '首段从基础网段起始');
eq(v.list[1].networkText, '192.168.0.128', '次段紧接其后');
eq(v.list[2].networkText, '192.168.0.192', '三段紧接');
eq(v.utilization > 0 && v.utilization < 100, true, '利用率在合理区间');

console.log('\n【12. 错误处理】');
function throws(fn, label) {
  try { fn(); fail++; console.log('  ✗ ' + label + '（未抛错）'); }
  catch (e) { pass++; console.log('  ✓ ' + label + ' → ' + e.message); }
}
throws(() => S.ipToInt('192.168.1'), '段数不足');
throws(() => S.ipToInt('192.168.1.256'), '段值超范围');
throws(() => S.ipToInt('192.168.1.abc'), '非数字段');
throws(() => S.maskToPrefix('255.0.255.0'), '不连续掩码');
throws(() => S.splitInto('192.168.1.0/30', 8), '子网数超出容量');
throws(() => S.planVlsm('192.168.0.0/24', [{ name: '超大部门', hosts: 700 }]), 'VLSM 地址不足');

console.log('\n' + '='.repeat(46));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(46) + '\n');

process.exit(fail === 0 ? 0 : 1);
