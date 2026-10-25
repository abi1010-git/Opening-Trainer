const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {value:'q',textContent:'',style:{},replaceChildren(){},appendChild(){}});
  return elements.get(id);
};
const storage = new Map();
const context = vm.createContext({
  document:{getElementById:element},
  localStorage:{setItem:(k,v)=>storage.set(k,v)},
  window:{addEventListener(){}},
});
vm.runInContext(fs.readFileSync('static/app.js','utf8').replace(/^import .*;\n/, ''), context);
vm.runInContext(`
  loadReviewPosition = () => { saveReview(); renderReviewSummary(); };
  reviewCards = Array.from({length:7}, (_,i) => ({key:String(i), item:{drop_pawns:i}, attempts:0, mastered:false}));
  savedPlayer = 'test';
  startReview();
`, context);
const read = code => vm.runInContext(code, context);
assert.equal(read('reviewSession.keys.length'), 5);
assert.equal(read('reviewSession.keys[0]'), '6');
read('recordReview(false); recordReview(true);');
assert.equal(read('reviewSession.correct'), 0);
assert.equal(read('reviewCards.find(c=>c.key==="6").mastered'), false);
read('nextReview(); recordReview(true); recordReview(true);');
assert.equal(read('reviewSession.correct'), 1);
assert.equal(read('reviewCards.find(c=>c.key==="5").attempts'), 1);
assert.equal(read('reviewCards.find(c=>c.key==="5").mastered'), true);
const saved = JSON.parse(storage.get('opening-trainer-review-v1'));
assert.equal(saved.session.index, 1);
assert.equal(saved.session.correct, 1);
assert.equal(saved.cards.length, 7);
read('nextReview(); recordReview(true); nextReview(); recordReview(true); nextReview(); recordReview(true); nextReview();');
assert.match(element('reviewSummary').textContent, /Session complete: 4 of 5/);
read('startReview();');
assert.equal(read('reviewSession.keys.length'), 3);
assert.equal(read('reviewSession.keys.includes("6")'), true);
console.log('Review session: cap, priority, retries, scoring, persistence and next session passed');
