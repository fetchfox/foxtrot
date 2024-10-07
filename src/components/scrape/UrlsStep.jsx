import React, { useState, useEffect, useRef } from 'react';
import { FiCheck, FiEdit2 } from 'react-icons/fi';
import Textarea from 'react-expanding-textarea';
import { MdEditSquare } from 'react-icons/md';
import { set } from 'radash';
import {
  IoMdSettings,
  IoMdAddCircle,
  IoMdCloseCircle,
  IoMdArrowBack,
  IoIosArrowDroprightCircle,
} from 'react-icons/io';
import { IoPlayCircle, IoCloseCircle } from 'react-icons/io5';
import {
  TbLayoutBottombarExpandFilled,
  TbLayoutBottombarCollapseFilled,
  TbFileArrowRight,
} from 'react-icons/tb';
import { TiDelete } from 'react-icons/ti';
import { HiMiniPencilSquare } from 'react-icons/hi2';
import {
  FaCircleStop,
  FaFileCsv,
  FaShareFromSquare,
  FaCircleMinus,
  FaPencil,
} from 'react-icons/fa6';
import {
  FaPlus,
  FaArrowRight,
} from 'react-icons/fa';
import {
  FiPlus,
  FiMinus,
  FiMinusCircle,
} from 'react-icons/fi';
import { HiArrowsExpand } from 'react-icons/hi';
import { runJob, runGather, runScrape, sendStopMessage } from '../../lib/job.mjs';
import { genJob, genBlankJob, genJobFromUrls } from '../../lib/gen.mjs';
import { formatNumber, getJobColumn, getJobUrl, sleep } from '../../lib/util.mjs';
import { getActiveTab, getTabData } from '../../lib/navigation.mjs';
import { setGlobalError } from '../../lib/errors.mjs';
import {
  getKey,
  setKey,
  setActiveJob,
  saveJob,
  setJobField,
  getJob,
  setStatus,
  addUrlsToJob,
  removeUrlsFromJob,
  setJobResults,
  clearJobResults,
  setScrapeStatus,
} from '../../lib/store.mjs';
import { useRoundId, advanceRound, getRoundId } from '../../lib/controller.mjs';
import { bgColor, mainColor } from  '../../lib/constants.mjs';
import { downloadJobCsv } from '../../lib/csv.mjs';
import {
  useJobs,
  useJob,
  useActiveJob,
} from '../../state/jobs';
import { useAutoSleepTime, useMirror } from '../../state/util';
import { useOpenAiKey, useUsage, useQuota } from '../../state/openai';
import { useLocal } from '../../state/storage';
import { Loading } from '../common/Loading';
import { Checkbox } from '../common/Checkbox';
import { Pills } from '../common/Pills';
import { Error } from '../common/Error';
import { HelpBar } from '../common/HelpBar';
import { GlobalError } from '../common/GlobalError';
import { Input } from '../common/Input';
import { OpenAiKeyEntry } from '../openai/OpenAiKeyEntry';
import { Pagination } from '../pagination/Pagination';
import { PerPage } from '../perpage/PerPage';
import { Share } from '../share/Share';
import { FoxSays } from '../fox/FoxSays';
import { Results } from './Results';
import { InputPrompt } from '../prompt/InputPrompt';
import fox from '../../assets/img/fox-transparent.png';
import {
  blankJob,
  mainStyle,
  stepStyle,
  stepHeaderStyle,
  smallButtonStyle,
  maybeOpenPanel,
} from './shared.js';


export const UrlsStep = ({ jobId, isPopup }) => {
  const { job, setJob } = useJob(jobId);
  const [mirror, updateMirror] = useMirror(job, setJob);

  const [step, setStep] = useLocal('step');
  const [pagination, setPagination] = useState();
  const [error, setError] = useState();
  const [manualError, setManualError] = useState();

  useEffect(() => {
    const update = () => {
      if (step != 'inner') return;
      console.log('running current URL update');
      getActiveTab().then(async (a) => {
        console.log('current URL update got active tab URL:', a?.url, 'current:', mirror?.urls?.currentUrl);
        await updateMirror([
          ['urls.url', a.url],
          ['urls.currentUrl', a.url],
        ]);
      });
    };

    update();

    const on = chrome.webNavigation.onHistoryStateUpdated;
    on.addListener(update);
    return () => on.removeListener(update);
  }, []);

  useEffect(() => {
    setError(null);
    if (job?.urls.currentUrl.indexOf('https://chromewebstore.google.com') != -1) {
      setError('Due to Google policy, cannot scrape Chrome Extension Store');
    }
  }, [job?.urls.currentUrl]);

  const handleAction = async (a) => {

    switch (a) {
      case 'gather':
        await updateMirror([
          ['urls.action', a],
          ['urls.perPage', 'guess'],
          ['scrape.concurrency', 3],
        ]);
        break;
      case 'current':
        await updateMirror([
          ['urls.action', a],
          ['urls.perPage', 'multiple'],
          ['scrape.concurrency', -1],
        ]);
        break;
      case 'manual':
        await updateMirror([
          ['urls.action', a],
          ['urls.perPage', 'guess'],
          ['scrape.concurrency', 3],
        ]);
        break;
    }
  }

  const numResults = (mirror?.results?.targets || []).length;
  const currentStep = numResults == 0 ? 1 : 2;

  const cleanManualUrls = (x) => x
    .split('\n')
    .map(x => x.trim())
    .filter(x => !!x && x != '');

  const checkManualUrls = (val, skipShort) => {
    setManualError();
    for (const url of cleanManualUrls(val)) {
      if (skipShort && url.length < 8) continue;
      if (url.indexOf('http://') != 0 && url.indexOf('https://') != 0) {
        setManualError('URLs must start with http:// or https://');
        return false;
      }
    }
    return true;
  }

  const handleClick = async () => {
    const activeTab = await getActiveTab();

    if (isPopup) {
      await maybeOpenPanel(job);
    }

    switch (mirror.urls.action) {
      case 'gather':
        runGather(job);
        if (mirror.urls.shouldClear) {
          updateShouldClear(false);
        }
        break;

      case 'manual':
        if (!checkManualUrls(mirror.urls.manualUrls, false)) return;
        const add = cleanManualUrls(mirror?.urls.manualUrls);
        addUrlsToJob(mirror?.id, add);
        setManualUrls('');
        break;

      default:
        throw 'unhandled action: ' + mirror.urls.action;
    }
  }

  const perPageNode = (
    <PerPage
      perPage={mirror?.urls.perPage}
      onChange={val => updateMirror([['urls.perPage', val]])}
    />
  );

  const questionNode = (
    <div>
      <p>What kinds of {job?.urls.action == 'gather' ? 'links' : 'items' } should we look for?</p>
      <Input
        style={{ width: '100%',
                 fontFamily: 'sans-serif',
                 resize: 'none',
                 padding: '4px 8px',
                 border: 0,
                 borderRadius: 2,
               }}
        placeholder="Look for links to product pages"
        value={mirror?.urls.question}
        onChange={(e) => updateMirror([['urls.question', e.target.value]])} />
    </div>
  );

  const gatherNode = (
    <div>
      <p>Find links on current page</p>
      <div style={{ position: 'relative' }}>

        <div style={{ background: '#fff3',
                      padding: '8px',
                      margin: '10px 0',
                      borderRadius: 4,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
          {mirror?.urls.currentUrl}
        </div>
      </div>
      <Pagination
        url={mirror?.urls.currentUrl}
        onChange={(val) => updateMirror([['urls.pagination', val]])}
        follow={mirror?.urls.pagination?.follow || false}
        count={mirror?.urls.pagination?.count || 0}
      />

      {questionNode}
      {perPageNode}

      <div style={{ marginTop: 10 }}>
        <button
          className={'btn btn-gray btn-md'}
          style={{ width: '100%' }}
          onClick={handleClick}
          >
          Run Only Crawl
        </button>
      </div>
    </div>
  );

  const currentNode = (
    <div>
      <p>We will only scrape the current page</p>
      <div style={{ position: 'relative' }}>
        <div style={{ background: '#fff3',
                      padding: '8px',
                      margin: '10px 0',
                      borderRadius: 4,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
          {mirror?.urls.currentUrl}
        </div>
      </div>

      <Pagination
        url={mirror?.urls.currentUrl}
        onChange={(val) => updateMirror([['urls.pagination', val]])}
        follow={mirror?.urls.pagination?.follow || false}
        count={mirror?.urls.pagination?.count || 0}
      />

      {/*<pre>{JSON.stringify(job.urls?.pagination, null, 2)}</pre>*/}

      {questionNode}
      {perPageNode}
    </div>
  );

  const manualNode = (
    <div>
      <p>Enter the URLs you would like to scrape (one per row)</p>
      <div style={{ position: 'relative' }}>
        <textarea
          style={{ width: '100%',
                   minHeight: 80,
                   fontFamily: 'sans-serif',
                   padding: '8px',
                   border: 0,
                   borderRadius: 4,
                   marginBottom: 2,
                 }}
          className={manualError ? 'error' : ''}
          placeholder={`https://www.example.com/page-1
https://www.example.com/page-2
...`}
          onChange={(e) => updateMirror([['urls.manualUrls', e.target.value]])}
          value={mirror?.urls.manualUrls}
        />
      </div>
      <Error message={manualError} />
      {questionNode}
      {perPageNode}
    </div>
  );

  if (!job || !mirror) return null;

  return (
    <div style={stepStyle}>

      {/*
      <p>job</p>
      <pre>{JSON.stringify(job?.urls, null, 2)}</pre>
      <p>mirror</p>
      <pre>{JSON.stringify(mirror?.urls, null, 2)}</pre>
      */}

      <div style={stepHeaderStyle}>What page do you want to scrape?</div>
      <Pills value={mirror?.urls.action} onChange={(val) => handleAction(val)}>
        <div key="current">Current Page Only</div>
        <div key="gather">Linked Pages</div>
        <div key="manual">Manually Enter URLs</div>
      </Pills>

      {mirror?.urls.action == 'current' && currentNode}
      {mirror?.urls.action == 'gather' && gatherNode}
      {mirror?.urls.action == 'manual' && manualNode}

      <Error message={error} />
    </div>
  );
};
