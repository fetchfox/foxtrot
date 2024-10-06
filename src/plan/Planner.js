import { logger } from '../log/logger.js';
import { getAI, getCrawler, getFetcher, getExtractor, getExporter } from '../index.js';
import { descriptions, classMap } from '../step/index.js';
import { singleStep, combined } from './prompts.js';

export const Planner = class {
  constructor(options) {
    const cache = options?.cache;
    this.limit = options?.limit;
    this.ai = options?.ai || getAI(null, { cache });
    this.crawler = options?.crawler || getCrawler(null, { cache });
    this.fetcher = options?.fetcher || getFetcher(null, { cache });
    this.extractor = options?.extractor || getExtractor(null, { cache });
  }

  async plan(stepStrs) {
    const stepsJson = [];
    for (const str of stepStrs) {
      const stepLibrary = descriptions.map(v => JSON.stringify(v, null, 2)).join('\n\n');
      const context = {
        stepLibrary,
        allSteps: '- ' + stepStrs.join('\n- '),
        step: str,
      }
      const prompt = singleStep.render(context);
      const answer = await this.ai.ask(prompt, { format: 'json' });
      logger.info(`Step planned "${str}" into ${JSON.stringify(answer.partial)}`);
      stepsJson.push(answer.partial);
    }

    return stepsJson.map(x => this.fromJson(x));
  }

  async planCombined(allSteps) {
    const stepLibrary = descriptions.map(v => JSON.stringify(v, null, 2)).join('\n\n');
    const context = {
      stepLibrary,
      allSteps,
    };
    const prompt = combined.render(context);
    const answer = await this.ai.ask(prompt, { format: 'json' });
    const stepsJson = answer.partial;
    return stepsJson.map(x => this.fromJson(x));
  }

  fromJson(json) {
    logger.info(`JSON: ${JSON.stringify(json)}`);
    const options = {
      ai: this.ai,
      crawler: this.crawler,
      fetcher: this.fetcher,
      extractor: this.extractor,
    }
    if (this.limit) options.limit = this.limit;
    const cls = classMap[json.name];
    const args = Object.assign({}, options, json.args);
    return new cls(args);
  }
}
