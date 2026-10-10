/* 静态校验：main.js 里引用的所有 DOM id，是否都在 index.html 中存在
   这类「id 拼错 / 元素漏写」的 bug 在浏览器里只会静默失效，很难发现 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');

// 从 HTML 收集所有 id
const htmlIds = new Set();
let m;
const idRe = /\sid="([^"]+)"/g;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);

// 从 main.js 收集所有 $('xxx') 调用
const usedIds = new Set();
const useRe = /\$\('([^']+)'\)/g;
while ((m = useRe.exec(js))) usedIds.add(m[1]);

// 从 main.js 的模板字符串里收集动态创建的 id（形如 id="xxx"）
const dynamicIds = new Set();
const dynRe = /id="([^"]+)"/g;
while ((m = dynRe.exec(js))) dynamicIds.add(m[1]);

// 从 main.js 收集 querySelector 里用到的类/选择器，单独检查关键项
const htmlClasses = new Set();
const classRe = /\sclass="([^"]+)"/g;
while ((m = classRe.exec(html))) {
  m[1].split(/\s+/).forEach(c => { if (c) htmlClasses.add(c); });
}

console.log('\n=== HTML 中定义的 id 数量: ' + htmlIds.size + ' ===');
console.log('=== main.js 引用的 id 数量: ' + usedIds.size + ' ===');
console.log('=== 其中由 JS 动态生成的 id: ' + dynamicIds.size + ' ===\n');

let missing = [];
Array.from(usedIds).sort().forEach(id => {
  if (htmlIds.has(id)) {
    console.log('  ✓ ' + id);
  } else if (dynamicIds.has(id)) {
    console.log('  ✓ ' + id + '   （动态生成）');
  } else {
    missing.push(id);
    console.log('  ✗ ' + id + '   ← 既不在 HTML 也未动态创建！');
  }
});

// 检查 main.js 依赖的关键 class
const needClasses = ['tab', 'seg', 'chip'];
console.log('\n=== 关键 class 检查 ===');
needClasses.forEach(c => {
  console.log((htmlClasses.has(c) ? '  ✓ ' : '  ✗ ') + '.' + c);
});

// 检查脚本引入顺序（依赖必须在 main.js 之前）
console.log('\n=== 脚本引入顺序 ===');
const order = ['js/subnet.js', 'js/vlan.js', 'js/dns.js', 'js/main.js'];
let lastIdx = -1, orderOk = true;
order.forEach(f => {
  const idx = html.indexOf(f);
  if (idx === -1) { console.log('  ✗ 未引入 ' + f); orderOk = false; return; }
  if (idx < lastIdx) { console.log('  ✗ 顺序错误：' + f); orderOk = false; }
  lastIdx = idx;
  console.log('  ✓ ' + f + ' (位置 ' + idx + ')');
});

// 检查 CSS 是否引入
console.log('\n=== 样式引入 ===');
console.log((html.includes('css/style.css') ? '  ✓ ' : '  ✗ ') + 'css/style.css');

console.log('\n' + '='.repeat(44));
if (missing.length) {
  console.log('  发现 ' + missing.length + ' 个缺失的 id：' + missing.join(', '));
  console.log('='.repeat(44) + '\n');
  process.exit(1);
} else if (!orderOk) {
  console.log('  脚本引入顺序有问题');
  console.log('='.repeat(44) + '\n');
  process.exit(1);
} else {
  console.log('  DOM 引用全部匹配，脚本顺序正确');
  console.log('='.repeat(44) + '\n');
}
