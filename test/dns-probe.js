const D = require('../js/dns.js');

console.log('=== 域名校验逻辑 ===');
const cases = [
  ['example.com', true], ['github.com', true], ['a.b.c.d.e', true],
  ['', false], ['nodot', false], ['has space.com', false]
];
let ok = 0, bad = 0;
cases.forEach(([d, should]) => {
  try { D.validateDomain(d); console.log((should ? '  ✓' : '  ✗ 应拒绝') + ' ' + JSON.stringify(d));
        should ? ok++ : bad++; }
  catch (e) { console.log((should ? '  ✗ 应通过' : '  ✓') + ' ' + JSON.stringify(d) + ' -> ' + e.message);
        should ? bad++ : ok++; }
});

console.log('\n=== 真实 DoH 查询（需要网络）===');
D.query('example.com', 'A')
  .then(r => {
    console.log('  提供方: ' + r.provider);
    console.log('  状态: ' + r.statusText);
    console.log('  耗时: ' + r.elapsed + ' ms');
    r.answers.forEach(a => console.log('  ' + a.type + '  ' + a.name + '  TTL=' + a.ttl + '  ->  ' + a.data));
  })
  .catch(e => console.log('  查询失败（网络受限时属正常）: ' + e.message));
