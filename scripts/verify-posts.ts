/**
 * Tests the two cases that the admin web table cannot tell apart.
 * Run: npx tsx scripts/verify-posts.ts
 */
import { findDuplicates, listPosts } from '../src/circle/posts.js';
import type { CircleClient } from '../src/circle/client.js';

function fakeClient(pages: unknown[][]): CircleClient {
  let call = 0;
  return {
    dryRun: false,
    buildUrl: () => '',
    async request() {
      const records = pages[call] ?? [];
      const hasNext = call < pages.length - 1;
      call += 1;
      return { count: 0, has_next_page: hasNext, records } as never;
    },
  } as unknown as CircleClient;
}

const rec = (id: number, name: string, at: string) => ({
  id, name, status: 'scheduled', space_id: 2831307, space_name: 'Community Manager (Elizabeth)',
  published_at: at, url: `https://x/${id}`,
});

const problems: string[] = [];
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) problems.push(`${label}: got ${a}, expected ${e}`);
}

// Case 1: two separate records at the same minute. A real duplicate.
{
  const client = fakeClient([[
    rec(1, 'The Pivot You Never Tested', '2026-10-18T07:00:00Z'),
    rec(2, 'The Pivot You Never Tested', '2026-10-18T07:00:00Z'),
    rec(3, 'Try the Smallest Version First', '2026-10-18T17:00:00Z'),
  ]]);
  const r = await listPosts(client, { status: 'scheduled' });
  const d = findDuplicates(r.posts);
  check('case1 unique', r.posts.length, 3);
  check('case1 repeatedIds', r.repeatedIds, []);
  check('case1 duplicate groups', d.length, 1);
  check('case1 extras', d.reduce((n, g) => n + g.length - 1, 0), 1);
  check('case1 ids in group', d[0]?.map((p) => p.id), [1, 2]);
}

// Case 2: ONE record handed back on two pages, which is what makes the web
// table look duplicated. Must be counted once and reported as a paging repeat.
{
  const client = fakeClient([
    [rec(1, 'The Pivot You Never Tested', '2026-10-18T07:00:00Z')],
    [rec(1, 'The Pivot You Never Tested', '2026-10-18T07:00:00Z'),
     rec(3, 'Try the Smallest Version First', '2026-10-18T17:00:00Z')],
  ]);
  const r = await listPosts(client, { status: 'scheduled' });
  const d = findDuplicates(r.posts);
  check('case2 unique', r.posts.length, 2);
  check('case2 rowsReturned', r.rowsReturned, 3);
  check('case2 repeatedIds', r.repeatedIds, [1]);
  check('case2 duplicate groups', d.length, 0);
}

// Case 3: same title and space, different minutes. Not a duplicate.
{
  const client = fakeClient([[
    rec(1, 'Same Title', '2026-10-18T07:00:00Z'),
    rec(2, 'Same Title', '2026-10-19T07:00:00Z'),
  ]]);
  const r = await listPosts(client, { status: 'scheduled' });
  check('case3 duplicate groups', findDuplicates(r.posts).length, 0);
}

// Case 4: pagination stops when has_next_page is false, even with a full page.
{
  const client = fakeClient([[rec(1, 'Only Page', '2026-10-18T07:00:00Z')]]);
  const r = await listPosts(client, {});
  check('case4 pagesFetched', r.pagesFetched, 1);
}

if (problems.length) {
  console.error(`${problems.length} failure(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('OK — id based counting separates a real duplicate from a paging repeat.');
