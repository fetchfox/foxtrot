import React, { useState, useEffect, useRef } from 'react';
import { FiCheck, FiEdit2 } from 'react-icons/fi';
import Textarea from 'react-expanding-textarea';
import { MdEditSquare } from 'react-icons/md';
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
import { useAutoSleepTime } from '../../state/util';
import { useOpenAiKey, useUsage, useQuota } from '../../state/openai';
import { useLocal } from '../../state/storage';
import { Loading } from '../common/Loading';
import { Checkbox } from '../common/Checkbox';
import { Pills } from '../common/Pills';
import { Error } from '../common/Error';
import { HelpBar } from '../common/HelpBar';
import { GlobalError } from '../common/GlobalError';
import { OpenAiKeyEntry } from '../openai/OpenAiKeyEntry';
import { PerPage } from '../perpage/PerPage';
import { Share } from '../share/Share';
import { FoxSays } from '../fox/FoxSays';
import { InputPrompt } from '../prompt/InputPrompt';
import { Results } from './Results';
import { ScrapeStep } from './ScrapeStep';
import { UrlsStep } from './UrlsStep';
import fox from '../../assets/img/fox-transparent.png';
import './Scrape.css';
import {
  blankJob,
  mainStyle,
  stepStyle,
  stepHeaderStyle,
  smallButtonStyle,
  openPanel,
  maybeOpenPanel,
} from './shared.js';

const StatusBar = ({ onRun }) => {
  const usage = useUsage();
  const [status] = useLocal("status");
  const [percent] = useLocal("percent");
  const [completion] = useLocal("completion");
  const [tpm] = useLocal("tpm");
  const [inFlight] = useLocal("inFlight");

  const message = status?.message ?? "";
  const busy = (inFlight || 0) != 0;

  const size = 28;

  const buttonNode = (
    <div>
      <button
        className={"btn btn-lg btn-primary"}
        style={{ width: "100%" }}
        onClick={onRun}
      >
        Run Scrape
      </button>
    </div>
  );

  const calcWidth = "calc(100% - " + (2 * size + 16) + "px)";

  const loadingNode = (
    <div
      style={{
        height: size + 20,
        padding: "2px 0",
        display: "flex",
        gap: 5,
        alignItems: "center",
        overflow: "hidden",
        position: "relative",
      }}
      >
      {/*BUSY:{''+busy} INFLIGHT:{''+inFlight}*/}
      <div style={{ width: size + 2, paddingLeft: 2, textAlign: "right" }}>
        {busy ? <Loading width={size} /> : null}
      </div>

      {busy && (
        <div style={{ width: size }}>
          <a
            style={{ color: "white" }}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              advanceRound();
              sendStopMessage();
            }}
          >
            <FaCircleStop size={size} />
          </a>
        </div>
      )}

      {busy && percent && (
        <div
          style={{
            width: calcWidth,
            height: 18,
            bottom: 10,
            position: "absolute",
            marginLeft: size * 2 + 16,
            background: "#fff3",
            borderRadius: 4,
          }}
        >
          <div
            style={{
              width: Math.floor(100 * percent) + "%",
              height: 18,
              background: mainColor,
              borderRadius: 4,
            }}
          ></div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          width: calcWidth,
          marginLeft: size * 2 + 16,
          fontSize: 10,
          top: 6,
        }}
      >
        <div>
          {percent && Math.round(100 * percent) + "%"}
          {percent && !!completion?.done && !!completion?.total && (
            <span> ({`${completion.done}/${completion.total}`})</span>
          )}
        </div>
        <div>
          {tpm && (
            <span>
              {" "}
              {formatNumber(tpm, true)} tpm,{" "}
              {formatNumber(usage.total || 0, true)}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          zIndex: 2,
          width: "calc(100% - 10px)",
          paddingRight: 30,
          marginLeft: 8,
          marginTop: 8,
        }}
      >
        {inFlight > 0 ? " " + message : ""}
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: "100%",
        position: "fixed",
        background: bgColor,
        left: 0,
        bottom: 0,
        padding: 10,
        height: 74,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        {!busy && buttonNode}
        {busy && loadingNode}
      </div>
    </div>
  );
}

const Welcome = ({ isPopup, onStart, onSkip }) => {
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState();
  const [manual, setManual] = useState();
  const [manualUrls, setManualUrls] = useState('');
  const [disabled, setDisabled] = useState();
  const [step, setStep] = useLocal('step');
  const jobs = useJobs();

  useEffect(() => {
    getActiveTab().then(tab => setUrl(tab.url));
    getKey('masterPrompt').then(val => setPrompt(val || ''));
  }, []);

  useEffect(() => {
    setDisabled(manual && !manualUrls.trim());
  }, [manual, manualUrls]);

  const examples = [
    [
      'Find comment pages, get main topic, and tone in 1-3 words',
      'https://news.ycombinator.com/',
    ],
    [
      'Find number of bedrooms, bathrooms, 2-5 word summary',
      'https://sfbay.craigslist.org/search/apa#search=1~list~0~0',
    ],
    [
      'Find articles, get title, author, date, key people, company',
      'https://techcrunch.com/',
    ],
  ];

  const exampleStyle = {
    cursor: 'pointer',
    background: '#0006',
    color: '#bbb',
    padding: 10,
    borderRadius: 10,
    flexBasis: '100%',
  };

  const jobStyle = {
    cursor: 'pointer',
    background: '#0006',
    color: '#bbb',
    padding: 10,
    borderRadius: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const instructionStyle = {
    textAlign: 'center',
    marginTop: jobs.length == 0 ? 40 : 20,
  };

  const handleExample = async (e, prompt, url) => {
    setPrompt(prompt);
    setUrl(url);
    await handleSubmit(e, prompt, url);
    await setStep('inner');
    const activeTab = await getActiveTab();
    chrome.tabs.update(activeTab.id, { url });
    if (isPopup) openPanel();
  }

  let i = 0;
  const exampleNodes = examples.map(([prompt, url]) => {
    return (
      <div
        style={exampleStyle}
        onClick={(e) => handleExample(e, prompt, url)}
        key={i++}
        >
        <div style={{ whiteSpace: 'nowrap', marginBottom: 4 }}>
          <b>{(new URL(url)).hostname}</b>
        </div>
        {prompt}
      </div>
    );
  });

  const jobNodes = jobs.filter(j => j && j.name && !j.name.startsWith('Untitled'))
    .slice(0, 4)
    .map((j) => {
      return (
        <div
          style={jobStyle}
          onClick={() => onStart(j)}
          >
          {j.name}
        </div>
      )});

  const loadingNode = (
    <div style={{ position: 'absolute',
                  width: '100%',
                  textAlign: 'center',
                  bottom: 0,
                }}>
      <Loading width={24} />
    </div>
  );

  const handleSubmit = async (e, prompt, url, isActive) => {
    e.preventDefault();
    setLoading(true);

    try {
      const activeTab = await getActiveTab();
      const useUrl = isActive ? activeTab.url : url;

      let job;
      if (manual) {
        job = await genJobFromUrls(prompt, manualUrls.split('\n'));
      } else {
        const page = isActive ? (await getTabData()) : null;
        if (page?.error) {
          setGlobalError(page.error);
          return;
        }
        job = await genJob(prompt, useUrl, page);
      }
      console.log('==== GEN JOB DONE ====');
      console.log('Gen job gave:', job);
      return onStart(job);
    } catch (e) {
      setGlobalError('Error generating job, try again: ' + e);
      throw e;
    } finally {
      setLoading(false);
    }
  };


  const timeoutRef = useRef(null);
  const updatePrompt = (e) => {
    setPrompt(e.target.value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(
      () => setKey('masterPrompt', e.target.value),
      100);
  }

  const inputNode = (
    <InputPrompt
      onSubmit={(e) => handleSubmit(e, prompt, url, true)}
      onChange={updatePrompt}
      prompt={prompt}
      loading={loading}
      disabled={disabled}
    />
  );

  const prevNode = (
    <div>
      <div style={instructionStyle}>Previous scrapes</div>
      <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 5,
                    marginTop: 10,
                  }}>
        {jobNodes}
      </div>
    </div>
  );

  let urlNode
  if (manual) {
    urlNode = (
      <div style={{ color: '#bbb' }}>
        <div>Scrape these URLs (one per line)</div>
        <Textarea
          style={{ width: '100%',
                   fontFamily: 'sans-serif',
                   fontSize: 14,
                   margin: '5px 0',
                   padding: 8,
                   paddingLeft: 12,
                   paddingRight: 36,
                   border: 0,
                   borderRadius: 8,
                   minHeight: 60,
                   maxHeight: 120,
                 }}
          value={manualUrls}
          onChange={(e) => setManualUrls(e.target.value)}
        />
      </div>
    );
  } else {
    urlNode = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#bbb' }}>
        <div>Scrape <b style={{ color: '#fff' }}>{url}</b></div>
        <MdEditSquare style={{ cursor: 'pointer' }} onClick={() => { setManual(true); setManualUrls(url) }} />
      </div>
    );
  }

  return (
    <div style={{ ...mainStyle, paddingBottom: 10, paddingTop: 40 }}>
      <FoxSays message="Hi! I'm FetchFox" />

      <div style={instructionStyle}>Try these examples</div>
      <div style={{ display: 'flex',
                    width: '100%',
                    gap: 10,
                    marginTop: 10, }}>
        {exampleNodes}
      </div>

      {jobNodes.length > 0 && prevNode}

      <div style={instructionStyle}>Create your own scrape</div>
      <div style={{ marginTop: 10,
                    background: '#fff2',
                    padding: 10,
                    borderRadius: 10,
                  }}>
        {urlNode}
        <div style={{ position: 'relative' }}>
          {/*loading && loadingNode*/}
          {inputNode}
        </div>

      </div>

      <div style={{...instructionStyle, marginBottom: 40 }}>
        Know what you're doing?{' '}
        <span className="clickable" onClick={onSkip}>
          Go to Editor &raquo;
        </span>
      </div>
    </div>
  );
}

const Inner = ({ isPopup, onNewJob, onShowSettings }) => {

  // const [showSettings, setShowSettings] = useState();
  const { key: openAiKey, plan: openAiPlan, loading: loadingOpenAiKey } = useOpenAiKey('loading');
  const { job } = useActiveJob();

  console.log('Active job:', job);
  const handleScrape = async (urls) => {
    return runScrape(job, urls);
  }

  const handleRemove = async (urls) => {
    console.log('remove these target urls:', urls);
    removeUrlsFromJob(job.id, urls);
  }

  const clearAll = async () => {
    clearJobResults(job.id);
  }

  const clearScrape = async () => {
    await setJobResults(job.id, { answers: {} }, true);
    await setScrapeStatus(
      job.id,
      await getRoundId(),
      (job.results?.targets || []).map(t => t.url),
      'new');
  }

  const rerunErrors = async () => {
    const errorUrls = (job?.results?.targets || [])
      .filter(r => r.status == 'error')
      .map(r => r.url);
    return runScrape(job, errorUrls);
  }

  if (loadingOpenAiKey) {
    return null;
  }

  const handleRun = async () => {
    if (isPopup) {
      await maybeOpenPanel(job);
    }
    runJob(job);
  };

  const currentStep = (job?.results?.targets || []).length == 0 ? 1 : 2;
  const noAnswers = (job?.results?.targets || []).filter(r => !!r.answer).length == 0;
  const numErrors = (job?.results?.targets || []).filter(r => r.status == 'error').length;

  const controlsNode = (
    <div>
      <button
        className="btn btn-gray"
        disabled={currentStep < 2}
        onClick={() => downloadJobCsv(job)}
        style={{ margin: '5px 5px 0 0' }}
        >
        <FaFileCsv size={12} /> Download CSV
      </button>
      <div style={{ margin: '5px 5px 0 0', display: 'inline-block' }}>
        <Share job={job} />
      </div>
      <button
        className="btn btn-gray"
        disabled={currentStep < 2}
        onClick={clearAll}
        style={{ margin: '5px 5px 0 0' }}
        >
        Clear All Data
      </button>
      <button
        className="btn btn-gray"
        disabled={currentStep < 2 || noAnswers}
        onClick={clearScrape}
        style={{ margin: '5px 5px 0 0' }}
        >
        Clear Answers
      </button>
      {!!numErrors && <button
        className="btn btn-gray"
        disabled={numErrors == 0}
        onClick={rerunErrors}
        style={{ margin: '5px 5px 0 0' }}
        >
        Rerun {numErrors} {numErrors == 1 ? 'Error' : 'Errors'}
      </button>}
    </div>
  );

  if (!job) return <div>Loading</div>;

  return (
    <div style={mainStyle}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>

        {/*<pre>{JSON.stringify(job, null, 2)}</pre>*/}

        <div>
          <img src={fox} style={{ width: 32, height: 32 }} />
        </div>

        <div style={{ width: '100%',
                      textAlign: 'left',
                      fontSize: 14,
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
          {job?.name}
        </div>
        <div style={{ whiteSpace: 'nowrap' }}>
          <button
            className="btn btn-gray"
            onClick={onNewJob}
            >
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5}}>
              <HiMiniPencilSquare size={14} /> New Scrape
            </div>
          </button>

        </div>
        <div>
          <div
            style={{ cursor: 'pointer', position: 'relative', top: 1 }}
            onClick={onShowSettings}
            >
            <IoMdSettings size={24}/>
          </div>
        </div>
      </div>

      <UrlsStep
        jobId={job.id}
        isPopup={isPopup}
      />

      <ScrapeStep
        jobId={job.id}
        isPopup={isPopup}
      />

      <br />
      <br />

      {(job?.results?.targets || []).length > 0 && controlsNode}

      <Results
        jobId={job.id}
        targets={job?.results?.targets || []}
        onScrape={handleScrape}
        onRemove={handleRemove}
      />

      <StatusBar onRun={handleRun} />
    </div>
  );
}

const QuotaError = () => {
  const quota = useQuota();

  return (
    <div style={{ color: 'white' }}>
      quota error?
      <pre>{JSON.stringify(quota, null, 2)}</pre>
    </div>
  );
}

export const Scrape = ({ isPopup }) => {
  const {
    key: openAiKey,
    plan: openAiPlan,
    loading: loadingOpenAiKey,
  } = useOpenAiKey('loading');
  const [ai, setAi] = useState({ ok: false, didInit: false });
  const [activeTab, setActiveTab] = useState({ tab: null, didInit: false });
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useLocal('step');
  const [ready, setReady] = useState(false);
  const quota = useQuota();
  const activeJob = useActiveJob();

  useEffect(() => {
    getActiveTab().then((tab) => {
      setActiveTab({ tab, didInit: true });
    });
  }, []);

  useEffect(() => {
    // Flow:
    // - If loading, not ready
    // - If plan is 'openai', ready when key is set
    // - If plan is 'free', ready

    if (loadingOpenAiKey) return;
    if (openAiPlan == 'openai') {
      setAi({ ok: quota.ok, didInit: true });
    } else if (openAiPlan == 'free') {
      setAi({ ok: true, didInit: true });
    } else {
      setAi({ ok: false, didInit: true });
    }
  }, [loadingOpenAiKey, openAiKey, openAiPlan, quota?.ok]);

  useEffect(() => {
    // Flow:
    // - Wait for everything to initialize
    // - If AI config is not ready, show settings screen
    // - Else, wait for active job
    // - If no active job, show 'welcome'
    // - If active job, and same domain, show 'inner'
    // - Else, show 'welcome'

    if (ready) return;
    if (!ai.didInit) return;
    if (!activeTab.didInit) return;
    if (!activeJob.didInit) return;

    console.log('get ready with:', ai);
    console.log('get ready with:', activeTab);
    console.log('get ready with:', activeJob);

    if (!ai.ok) {
      setStep('settings');
      setReady(true);
      return;
    }

    if (!activeJob.job) {
      setStep('welcome');
      setReady(true);
      return;
    }

    getKey("inFlight")
      .then((inFlight) => {
        const jobUrl = getJobUrl(activeJob.job) || "";
        const tabUrl = activeTab ? activeTab.tab.url : "";
        const tabHostname = tabUrl ? new URL(tabUrl).hostname : "";

        console.log('got inFlight to get ready:', inFlight);
        console.log('got jobUrl to get ready:', jobUrl);
        console.log('got tabUrl to get ready:', tabUrl);
        console.log('got tabHostname to get ready:', tabHostname);

        if (inFlight > 0) {
          // Job is running, go to inner page
          setStep('inner');
          setReady(true);
        } else if (jobUrl && jobUrl.indexOf(tabHostname) === -1) {
          // New domain, assume new job
          console.log("ready new domain, so change the step");
          setStep("welcome");
          setReady(true);
        } else {
          setStep("inner");
          setReady(true);
        }
      });

  }, [
    ai.didInit,
    activeTab.didInit,
    activeJob.didInit,
  ]);

  const handleSkip = async () => {
    if (!activeJob.job) {
      handleStart(await genBlankJob());
    } else {
      setStep("inner");
    }
  };

  const handleStart = async (job) => {
    console.log("handleStart", job);

    await saveJob(job);
    await setActiveJob(job.id);
    await setStep("inner");
    setKey("masterPrompt", "");
    window.scrollTo(0, 0);
  };

  const handleNew = async () => {
    await setStep("welcome");
  };

  let body = (
    <div>body</div>
  );
  let msg = (
    <div style={{ color: 'white' }}>
      <ul>
        <li>loadingOpenAiKey: {''+loadingOpenAiKey}</li>
        <li>openAiKey: {''+openAiKey}</li>
        <li>openAiPlan: {''+openAiPlan}</li>
        <li>quota?.ok: {''+quota?.ok}</li>
      </ul>

      Step: {step}<br/>
      Ai ready? {JSON.stringify(ai)}<br/>
      Job? {JSON.stringify(activeJob)}<br/>
      Tab? {'' + activeTab.didInit + ' ' +JSON.stringify(activeTab)}<br/>
      Ready? {''+ready}<br/>
    </div>
  );

  if (!ready) {
    body = (
      <div style={{ padding: 50, textAlign: "center", color: "white" }}>
        <Loading size={50} />
      </div>
    );
  } else {
    switch (step) {
      case 'settings':
        body = (
          <div style={mainStyle}>
            <OpenAiKeyEntry onDone={() => setStep("welcome")} />
          </div>
        );
        break;

      case 'welcome':
        body = (
          <Welcome
            isPopup={isPopup}
            onStart={handleStart}
            onSkip={handleSkip} />
        );
        break;

      case 'inner':
        body = (
          <Inner
            isPopup={isPopup}
            onNewJob={handleNew}
            onShowSettings={() => setStep("settings")}
          />
        );
        break;

      default:
        body = <div>Unhandled step, please report issue</div>;
    }
  }

  return (
    <div style={{ minHeight: 560, color: 'white', overflow: 'hidden' }}>
      <HelpBar />
      <GlobalError />
      {/*msg*/}
      {body}
    </div>
  );
}
