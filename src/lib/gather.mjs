import { stream, exec } from './ai.mjs';
import { sleep, shuffle } from './util.mjs';
import {
  getRoundId,
  isActive,
  addListener,
  removeListener,
} from './controller.mjs';
import { getActiveJob, setJobResults, setStatus } from './store.mjs';
import { getCache, setCache } from './cache.mjs';
import { gatherTemplate } from './templates.mjs';


export const cleanLinks = (l) => {
  const clean = [];
  const seen = {};    
  console.log('clean links:', l);
  for (let item of l) {
    if (!item.url) {
      console.warn('got invalid link:', item);
      continue;
    }

    // De-dupe anchors for now. May want to revisit this later.
    item.url = item.url.split('#')[0];
    clean.push(item);
  }
  return clean;
}

export const dedupeLinks = (l) => {
  const u = [];
  const seen = {};    
  for (let item of cleanLinks(l)) {
    if (seen[item.url]) continue;
    seen[item.url] = true;
    u.push(item);
  }
  return u;
}

const chunkList = (list, maxBytes) => {
  const chunks = [];
  let current = [];
  for (let item of list) {
    current.push(item);
    if (JSON.stringify(current, null, 2).length > maxBytes) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
};

const slimmer = item => ({
  id: item.id,
  html: item.html.substr(0, 200),
  text: item.text,
  url: item.url,
});

const expander = (page, item) => {
  const m = page.links.filter(x => x.id == item.id);
  return m.length > 0 ? m[0] : item;
}

export const findPagination = async (page) => {
  const roundId = await getRoundId();

  const cached = await getCache('pagination', [page.url]);
  if (cached) return cached;

  const likelyPagintion = (url) => {
    const regexes = [
      /page=/i,
      /offset=/i,
      /start=/i,
      /p=\d+/i,
      /pg=\d+/i,
      /page-\d+/i,
      /page_\d+/i,
      /start=\d+/i,
      /(\?|&)pageno=\d+/i,
      /(\?|&)paging=\d+/i,
      /(\?|&)limitstart=\d+/i,
      /(\?|&)skip=\d+/i,
      /part=\d+/i,
      /section=\d+/i,
      /count=\d+/i,
    ];
    for (const regex of regexes) {
      if (url.match(regex)) return true;
    }
    return false;
  };
  const links = JSON.parse(JSON.stringify(page.links));
  links.sort((a, b) => {
    const [la, lb] = [likelyPagintion(a.url), likelyPagintion(b.url)];
    if (la && lb || (!la && !lb)) return 0;
    if (la) return -1;
    if (lb) return 1;
  });
  console.log('pagination sorted links:', links);

  const limit = 10000;
  const chunked = chunkList(links.map(slimmer), limit);

  let next = [];
  let pages = [];

  const max = Math.min(4, chunked.length);

  for (let i = 0; i < max; i++) {
    if (!await isActive(roundId)) break;
    const chunk = chunked[i];
    console.log('find pagination from chunk:', chunk);

    const answer = await exec(
      'pagination',
      { list: JSON.stringify(chunk.map(slimmer), null, 2) });

    console.log('ai pagination gave answer:', answer);

    if (answer.hasPagination != 'yes') continue;

    if (answer.pageLinks) {
      for (const l of answer.pageLinks) {
        const expanded = expander(page, l);
        expanded.pageNumber = l.pageNumber;
        pages.push(expanded);
      }
    }

    if (answer.nextLink) {
      next.push(expander(page, { id: answer.nextLink }));
    }

    if (pages.length >= 10) break;
  }

  if (pages.length > 0) {
    // Run it again to check for dupes, etc.
    const answer = await exec(
      'pagination',
      { list: JSON.stringify(pages.slice(0, 50).map(slimmer), null, 2) });

    pages = [];
    for (const l of (answer.pageLinks || [])) {
      const expanded = expander(page, l);
      expanded.pageNumber = l.pageNumber;
      expanded.text = l.pageNumber == 0 ? '(current)' : `(page ${l.pageNumber})`;
      pages.push(expanded);
    }
    pages.sort((a, b) => (parseInt(a.pageNumber) || 99) - (parseInt(b.pageNumber) || 99));
    pages.unshift({ url: page.url, pageNumber: 0 });
  }

  // Disabled, since we are not using the "Next" field right now

  // if (next.length > 1) {
  //   const answer = await exec(
  //     'paginationPickNext',
  //     { list: JSON.stringify(next.map(slimmer), null, 2) });
  //   console.log('pick next pagination answer', answer);
  //   if (answer?.id) {
  //     next = [expander(page, answer)];
  //   } else {
  //     next = [];
  //   }
  // }

  const result = { pages: pages.slice(0, 20), next: next[0] };
  setCache('pagination', [page.url], result);
  return result;
}

export const parseLinks = async (page, question, cb, templateName) => {
  const roundId = await getRoundId();

  const links = shuffle(page.links);
  const limit = 6000;
  const chunked = chunkList(links.map(slimmer), limit);

  let matches = [];

  for (let i = 0; i < chunked.length; i++) {
    if (!await isActive(roundId)) break;
    const chunk = chunked[i];

    const answer = (await exec(
      'gather',
      {
        question,
        list: JSON.stringify(chunk.map(slimmer), null, 2),
      })) || [];

    const expanded = answer.map(item => expander(page, item));
    if (!await isActive(roundId)) return [];
    matches = dedupeLinks(matches.concat(expanded));
    if (cb) cb(cleanLinks(matches), i / chunked.length);

    await setStatus(`Crawl stage working, ${i+1}/${chunked.length} chunks`);
  }

  return dedupeLinks(matches);
}
