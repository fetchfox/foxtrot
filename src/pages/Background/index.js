import { GATHER_TARGETS_PROMPT, EXAMPLE_LINKS } from '../../lib/constants.mjs';
import { sleep, splitUrls } from '../../lib/util.mjs';
import { exec } from '../../lib/ai.mjs';
import {
  getKey,
  setKey,
  nextId,
  saveJob,
  getActiveJob,
  setJobField,
  setActiveJob,
  setJobResults,
  setStatus,
  setPercent,
  setScrapeStatus,
  setScrapeAnswer,
  pushConsole,
} from '../../lib/store.mjs';
import { unique } from 'radash';
import { getPageData, getTabData, getActiveTab, reportSleep } from '../../lib/navigation.mjs';
import { parseLinks, cleanLinks, dedupeLinks } from '../../lib/gather.mjs';
import { scrapePage } from '../../lib/scrape.mjs';
import { getRoundId, isActive, runStopListeners, advanceRound } from '../../lib/controller.mjs';
import { nameTemplate } from '../../lib/templates.mjs';
import { sendReport } from '../../lib/report.mjs';
import { initSentry } from '../../lib/errors.mjs';
import icon34 from '../../assets/img/icon-34.png';

initSentry();

let iconInterval;
let loadingRoundId;
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.inFlight) {
    if (changes.inFlight.newValue == 0) {
      if (iconInterval) {
        clearInterval(iconInterval);
        iconInterval = null;
      }
      chrome.action.setIcon({ path: icon34 });
    } else if (iconInterval == null) {

      const context = (new OffscreenCanvas(100, 100)).getContext('2d');
      const start = new Date();
      const lines = 16;
      const cW = 40;
      const cH = 40;

      loadingRoundId = await getRoundId();

      iconInterval = setInterval(() => {
        const rotation = parseInt(((new Date() - start) / 1000) * lines) / lines;
        context.save();
        context.clearRect(0, 0, cW, cH);
        context.translate(cW / 2, cH / 2);
        context.rotate(Math.PI * 2 * rotation);
        for (var i = 0; i < lines; i++) {
          context.beginPath();
          context.rotate(Math.PI * 2 / lines);
          context.moveTo(cW / 10, 0);
          context.lineTo(cW / 4, 0);
          context.lineWidth = cW / 30;
          context.strokeStyle = 'rgba(0, 0, 0,' + i / lines + ')';
          // context.strokeStyle = 'rgba(223, 101, 70,' + i / lines + ')';
          context.stroke();
        }
        const imageData = context.getImageData(10, 10, 19, 19);
        chrome.action.setIcon({ imageData });
        context.restore();
      }, 1000/30);
    }
  }
});

chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
  if (req.action != 'console') console.log('bg got message:', req);

  if (req.action == 'runJob') runJob(req.job, req.tabId);
  else if (req.action == 'runGather') runGather(req.job, req.tabId);
  else if (req.action == 'runScrape') runScrape(req.job, req.urls);
  else if (req.action == 'stop') runStopListeners();

  else if (req.action == 'checkLoading') {
    checkLoading(req.text, req.html).then(sendResponse);
    return true;
  }

  if (req.action == 'reportSleep') {
    reportSleep(req.url, req.msec);
  }

  else if (req.action == 'setStatus') {
    setStatus(req.message);
  }

  else if (req.action == 'console') {
    saveConsole(req.key, req.args);
  }

  else if (req.action == 'reportBug') {
    reportBug().then(sendResponse);
    return true;
  }

  else if (req.action == 'nextId') {
    nextId().then(sendResponse);
    return true;
  }
});

const runJob = async (job, tabId) => {
  const roundId = await getRoundId();

  job = await maybeNameJob(job);
  if (!await isActive(roundId)) return;

  await setStatus('Run job ' + job.name, roundId, 1);

  let targets;
  let gatherShare = 0.25;

  const mergeTargets = (newTargets) => {
    // Merge with existing pagination results, if any
    const merged = [];
    const existing = job.results?.targets || [];
    const partialComplete = existing.filter(x => x.status != 'scraped').length > 0;
    for (const nt of newTargets) {
      const e = existing
        .filter(t => t.url == nt.url)
        .filter(t => t.text == nt.text)
        .filter(t => t.status == 'scraped');
      if (partialComplete && e.length > 0) {
        // Job is partially complete, and we already scraped this one. Skip it.
      } else {
        merged.push(nt);
      }
    }
    return merged
  }

  if (job.urls.action == 'manual') {
    gatherShare = 0;
    const manualTargets = splitUrls(job.urls.manualUrls)
      .map(url => ({ url, text: '(manual)' }));
    targets = mergeTargets(manualTargets);
    await setJobResults(job.id, { targets });

  } else if (job.urls.action == 'current') {
    const active = await getActiveTab();
    let url;
    if (active) {
      url = active.url;
      // Save it for next time, in case Chrome can't find it
      setJobField(job.id, 'urls', Object.assign({}, job.urls, { currentUrl: url }));
    } else if (job.urls.currentUrl) {
      url = job.urls.currentUrl;
    }
    gatherShare = 0;

    if (job.urls.pagination?.follow) {
      const paginationTargets = [];
      for (const link of job.urls.pagination.links) {
        paginationTargets.push({ url: link.url, text: link.text });
      }
      targets = mergeTargets(paginationTargets);
      console.log('pagination gave targets:', targets);
    } else {
      targets = [{ url, text: '(current)' }];
    }

    await setJobResults(job.id, { targets });

  } else {
    gatherShare = 0.25;
    targets = await runGather(job, tabId, gatherShare);
    targets = targets.concat(job.results?.targets || []);
  }

  if (!await isActive(roundId)) return;

  console.log('Call runScrape');
  await runScrape(
    job,
    targets.map(t => t.url),
    gatherShare);
  if (!await isActive(roundId)) return;

  console.log('all done, lets advance the round just in case');
  await advanceRound();
  await setStatus('Completed job ' + job.name);
}

const maybeNameJob = async (job) => {
  if (job.name.indexOf('Untitled') != -1 || job.name.indexOf('undefined') != -1) {
    const name = '' + (await runGetName(job));

    console.log('maybeNameJob got name:', name);

    job.name = name;
    await saveJob(job);
  }
  return job;
}

const runGetName = async (job) => {
  const slim = {};
  slim.scrape = job.scrape;
  slim.urls = job.urls;
  return exec('name', { job: JSON.stringify(slim, null, 2) })
    .then(x => x?.name || 'Unnamed');
};

const runGather = async (job, tabId, percentFactor) => {
  if (!percentFactor) percentFactor = 1;
  const roundId = await getRoundId();
  await setStatus('Start job', roundId, 1);
  await setPercent(0.01);
  job = await maybeNameJob(job);

  console.log('runGather got tabId:', tabId);

  let tabUrl;
  if (tabId) {
    const activeTab = await getActiveTab();
    tabUrl = activeTab?.url;
  }

  const urlsList = splitUrls(job.urls.url);
  if (job.urls.pagination?.follow) {
      for (const link of job.urls.pagination.links) {
        urlsList.push(link.url);
      }
  }
  urlsList = unique(urlsList);
  console.log('urlsList', urlsList);

  let links = [];
  for (let i = 0; i < urlsList.length; i++) {
    const url = urlsList[i];
    console.log('gather from url:', url);
    if (!url) continue;

    if (!await isActive(roundId)) return [null, null, null];

    setStatus('Crawl URLs from ' + url);

    let page;

    console.log('gather current tab?', tabId, tabUrl, url);

    if (tabId && tabUrl == url) {
      page = await getTabData(tabId, { shouldClose: false });
    } else {
      page = await getPageData(
        url,
        {
          active: job.scrape?.concurrency < 0,
          sleepTime: job.scrape?.sleepTime,
        });
    }

    console.log('gather got page:', page);

    if (page?.error) {
      console.error('Error, skipping' + url, page?.error);
      await setScrapeStatus(job.id, roundId, [url], 'error');
      continue;
    }

    const factor = (i + 1) / urlsList.length;
    const partial = await parseLinks(
      page,
      job.urls.question,
      (targets, percent) => {
        console.log('changes percent cb', targets, percent);
        setJobResults(job.id, { targets });
        setPercent(percent * percentFactor * factor);
      });

    console.log('got partial', partial);

    if (partial) {
      links = cleanLinks(dedupeLinks(links.concat(partial)));
      setJobResults(job.id, { targets: links });
      console.log('links is now:', links);
    }
  }

  console.log('links:', links);

  setStatus('AI found URLs:\n' + JSON.stringify(links, null, 2), roundId, -1);
  if (percentFactor == 1) setPercent(null);

  return links
};

const checkLoading = async (text, html) => {
  // TODO: re-enable this after dev done
  // if (true) {
  //   return { status: 'ok', answer: { status: 'done' } };
  // }


  const job = await getActiveJob();
  if (!job) {
    // Hack...
    return { status: 'ok', answer: { status: 'done' } };
  }

  const answer = await exec(
    'checkLoading',
    {
      text: text.substr(0, 10000),
      html: html.substr(0, 30000),
      questions: JSON.stringify(job.scrape?.questions || []),
    });

  if (!answer) {
    return { status: 'error' };
  } else {
    return { status: 'ok', answer };
  }
}

const runScrape = async (job, urls, percentAdd) => {
  if (!percentAdd) percentAdd = 0;
  console.log('bg got runscrape', job, urls);

  job = await maybeNameJob(job);

  const usingActive = (job.scrape?.concurrency || 0) < 0;

  const roundId = await getRoundId();
  const maxConc = Math.abs(job.scrape?.concurrency || 3);

  console.log('bg running with maxConc', maxConc);

  await setStatus(
    'Queue ' + (urls.length == 1 ? urls[0] : urls.length + ' URLs'),
    roundId,
    urls.length);

  await setScrapeStatus(
    job.id,
    roundId,
    urls,
    'queued');

  const extraRules = (job.urls.action == 'gather'
    ? 'Important: For this scrape, ONLY find exactly 1 item. So itemCount will always be 1, and you will return only 1 result after that.'
    : '');

  const itemDescription = (job.urls.action == 'manual'
    ? job.urls.question
    : '');

  const fn = async (url, index, cb) => {
    console.log('bg runscrape got url', next, url);
    await setScrapeStatus(job.id, roundId, [url], 'scraping');

    if (!await isActive(roundId)) return [null, null, null];
    console.log('bg runscrape getting page data', url);

    let timeoutId;
    const options = {
      active: job.scrape?.concurrency < 0,
      sleepTime: job.scrape?.sleepTime,
      onCreate: (tab) => {
        timeoutId = setTimeout(
          () => {
            try { chrome.tabs.remove(tab.id) } catch(e) {};
          },
          15*1000);
      }
    };
    const page = await getPageData(url, options);

    if (timeoutId) clearTimeout(timeoutId);

    console.log('bg runscrape got page data', url, page);

    if (page.error) {
      return [index, url, { error: page.error }];
    }

    if (!await isActive(roundId)) return [null, null, null];
    console.log('bg runscrape scraping', url);
    let result;
    try {
      result = await scrapePage(
        page,
        job.scrape.questions,
        job.urls?.perPage,
        itemDescription,
        extraRules,
        cb);
    } catch(e)  {
      console.error('scrapePage gave error:', e);
      throw e;
    }
    console.log('bg runscrape scraped', url, result);

    if (!await isActive(roundId)) return [null, null, null];

    return [index, url, result];
  };

  let next = 0;
  let done = 0;

  let p = [];

  while (next <= urls.length) {
    for (let i = p.filter(x => !!x).length; i < maxConc && next < urls.length; i++) {
      const url = urls[next++];
      const index = p.length;
      console.log('bg nnn runscrape start:', next, index, url);
      p.push(fn(
        url,
        index,
        ({ items, percent }) => {
          console.log('partial partialItems', items, percent);
          setScrapeAnswer(job.id, url, items);

          if (percent) {
            setPercent(percent, 0, 1);
          }
        }));
      if (usingActive) await sleep(2000);
    }

    console.log('bg nnn runscrape wait for any', next, urls.length, p);
    const l = p.filter(x => !!x);
    if (l.length == 0) break;
    let [doneIndex, url, result] = [null, null, null];
    console.log('Promise.any', l);
    [doneIndex, url, result] = await Promise.any(l);

    if (doneIndex === null) break;

    console.log('bg nnn runscrape got completed:', doneIndex);
    console.log('bg runscrape setting results/status', url);

    done++;

    if (result.error) {
      await setScrapeStatus(job.id, roundId, [url], 'error');
    } else {
      await setScrapeStatus(job.id, roundId, [url], 'scraped');
      await setScrapeAnswer(job.id, url, result);
    }

    await setStatus(
      (result.error ? 'Error' : 'Scraped') +
      ' (' + next + '/' + urls.length + ') ' + url, roundId,  -1);

    await setPercent(
      percentAdd + ((done / urls.length) * (1 - percentAdd)),
      done,
      urls.length,
    );

    p[doneIndex] = null;
  }

  setPercent(null);
}

let consoleMessages = [];
let consoleTimeoutId = null;
const saveConsole = (key, args) => {
  // Disable for now
  setKey('consoleMessages', []);
  return;

  // Do not put any console.log() statements in here

  const message = [
    '' + (new Date()),
    key,
    JSON.stringify(args),
  ].join('\t').substr(0, 5000); // max 5kB per message
  consoleMessages.push(message);


  // Buffer and write
  if (consoleTimeoutId) clearTimeout(consoleTimeoutId);

  consoleTimeoutId = setTimeout(
    async () => {
      const prev = (await getKey('consoleMessages')) || [];
      consoleMessages = prev.concat(consoleMessages);

      const l = consoleMessages.length;
      const max = 100000;
      if (l > max) {
        consoleMessages = consoleMessages.slice(l - max);
      }

      setKey('consoleMessages', consoleMessages);
      consoleMessages = [];
    }, 1000);
}

(() => {
  const devMode = !('update_url' in chrome.runtime.getManifest());
  if (devMode) return;

  for (const key of ['log', 'warn', 'error']) {
    const original = console[key];
    console[key] = (...args) => {
      original(...args);
      saveConsole(key, args);
    };
  }
})();

const reportBug = async () => {
  const messages = (await getKey('consoleMessages')) || [];
  return sendReport(messages.join('\n'));
}
