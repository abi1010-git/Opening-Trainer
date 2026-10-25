const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', style: {}, disabled: false,
    replaceChildren() {},
  });
  return elements.get(id);
}
element('username').value = 'public-player';
element('maxGames').value = '3';
element('plies').value = '12';
element('depth').value = '10';
element('timeMode').value = 'all';
const context = vm.createContext({
  document: {getElementById: element, createElement: () => ({})},
  window: {addEventListener() {}}, URLSearchParams,
  fetch: async () => { throw new Error('Lichess unavailable'); },
});
const source = fs.readFileSync('static/app.js', 'utf8').replace(/^import .*;\n/, '');
vm.runInContext(source, context);
(async () => {
  await vm.runInContext('analyze()', context);
  assert.equal(element('progressText').textContent, 'Analysis failed');
  assert.equal(element('progressPercent').textContent, 'Stopped');
  assert.equal(element('progressFill').style.width, '0%');
  assert.match(element('details').textContent, /analysis failed/);
  assert.equal(element('analyzeBtn').disabled, false);
  assert.equal(element('practiceSelectedBtn').disabled, true);
  console.log('Failure-state regression passed');
})();
