import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../estate/index.html', import.meta.url), 'utf8');
function app() {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', children: [], scrollIntoView() {} });
    return nodes.get(id);
  }};
  const context = vm.createContext({ document, navigator: { userAgent: '' }, localStorage: { getItem: () => null }, Intl, Date, setTimeout, clearTimeout });
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.slice(0, script.lastIndexOf('\ninitControls();')), context);
  return { run: (code) => vm.runInContext(code, context), context, nodes, document };
}

test('late ABA search generation cannot restore results', async () => {
  const a = app();
  a.run('searchIndex = () => new Promise(r => globalThis.finish = r)');
  const pending = a.run("runSearch('가나다')");
  a.run('invalidateSearch(); invalidateSearch()');
  a.context.finish({ all: [{ apt: '가나다', norm: '가나다', src: 'dongtan', dong: '청계동' }], failed: 0 });
  await pending;
  assert.equal(a.document.getElementById('searchList').innerHTML, '');
});

test('partial failures are not reported as a complete empty search', async () => {
  const a = app();
  a.run('searchIndex = async () => ({ all: [], failed: 2 })');
  await a.run("runSearch('없는단지')");
  const output = a.document.getElementById('searchList').innerHTML;
  assert.match(output, /일부 단지가 빠질/);
  assert.doesNotMatch(output, /단지 중에 없습니다/);
});

test('index groups repeated monthly deals, excludes cancellations and separates regions', async () => {
  const a = app();
  a.run(`loadStaticIndex = async () => {}; monthsBack = () => ['202609','202610'];
    fetchMonth = async () => 'ok';
    const deal = {apt:'푸르지오',dong:'능동',built:2000};
    store.dongtan.trade['202609'] = [deal, {...deal,canceled:true}];
    store.dongtan.trade['202610'] = [deal];
    store.giheung.trade['202610'] = [deal];`);
  const result = await a.run('searchIndex()');
  assert.equal(result.all.length, 2);
  assert.equal(result.all[0].cnt, 2);
  a.run('searchIndex = async () => ({ all: searchIndexCache.all, failed: 0 })');
  await a.run("runSearch('동탄예당마을푸르지오')");
  assert.match(a.document.getElementById('searchList').innerHTML, /푸르지오/);
});

test('same month requests share transport and failures back off', async () => {
  const a = app();
  a.context.calls = 0;
  a.run(`fetch = () => { calls++; return new Promise(r => globalThis.finish = r); }; staticIndex = false`);
  const one = a.run("fetchMonth('dongtan', 'trade', '202610')");
  const two = a.run("fetchMonth('dongtan', 'trade', '202610')");
  assert.equal(a.context.calls, 1);
  a.context.finish({ status: 429 });
  await Promise.all([one, two]);
  await a.run("fetchMonth('dongtan', 'trade', '202610')");
  assert.equal(a.context.calls, 1);
});

test('cancelled selection never relaxes cap or selects an apartment', async () => {
  const a = app();
  a.run('ensureData = () => new Promise(r => globalThis.finish = r); complexStats = () => { throw Error("stale selection continued"); }');
  const pending = a.run("openSearchHit({src:'giheung',apt:'테스트',dong:'신갈동'})");
  a.run("selectionSeq++; state.tab = 'dongtan2'");
  a.context.finish();
  await pending;
  assert.equal(a.run('state.cap'), true);
  assert.equal(a.run('state.selectedApt'), null);
  assert.equal(a.document.getElementById('searchList').textContent, '');
});

test('real aggregation and trend cache support uncapped selection', async () => {
  const a = app();
  a.run(`monthsBack = () => ['202610']; state.tab = 'giheung';
    store.giheung.trade['202610'] = [{apt:'테스트',dong:'신갈동',area:100,amt:50000,date:'2026-10-01',canceled:false}];`);
  assert.equal(a.run('complexStats().length'), 0);
  assert.equal(a.run('complexStats(true).length'), 1);
  a.run('state.cap = false');
  assert.equal(a.run('complexStats().length'), 1);
});

test('missing selection retains cap; real uncapped selection relaxes it', async () => {
  const a = app();
  a.run('ensureData = async () => {}; render = () => {}; complexStats = () => []');
  await a.run("openSearchHit({src:'giheung',apt:'테스트',dong:'신갈동'})");
  assert.equal(a.run('state.cap'), true);
  a.run("complexStats = (ignoreCap) => (ignoreCap || !state.cap) ? [{apt:'테스트',dong:'신갈동',point:null}] : []");
  await a.run("openSearchHit({src:'giheung',apt:'테스트',dong:'신갈동'})");
  assert.equal(a.run('state.cap'), false);
  assert.equal(a.run('state.selectedApt.apt'), '테스트');
  assert.match(a.document.getElementById('searchList').textContent, /좌표가 없어/);
});
