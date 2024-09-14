import { basic } from './prompts.js';
import { Item } from '../item/Item.js';
import { logger } from '../log/logger.js';
import { getAi } from '../ai/index.js';
import { DefaultFetcher } from '../fetch/index.js';
import { BaseExtractor } from './BaseExtractor.js';

export const BasicExtractor = class extends BaseExtractor {
  constructor(ai, options) {
    super(ai, options);
  }

  async *run(target, questions, options) {
    const { stream } = options || {};

    const doc = await this.getDoc(target);

    const { extraRules, description, limit } = options || {};
    let { single } = options || {};
    if (single) single = {};

    logger.info(`Extracting from ${doc}: ${questions.join(', ')}`);

    // Executes scrape on a chunk of the text + HTML
    const that = this;
    const inner = async function* (chunk) {
      const { more, text, html } = chunk;

      const context = {
        url: doc.url,
        questions,
        text,
        html,
        extraRules,
        limit: limit || 'No limit',
        description: (
          description
          ? `You are looking for this type of item(s):\n\n${description}`
          : ''),
      };
      const prompt = basic.render(context);

      let count = 0;
      let expectedCount;

      let gen = that.ai.gen(prompt, { format: 'jsonl', stream });
      for await (const { delta, usage } of gen) {
        if (delta.itemCount) {
          expectedCount = delta.itemCount;
          continue;
        }

        let r;
        if (single) {
          single = Object.assign({}, delta, single);
          r = single;
        } else {
          // Assume its a new result
          r = delta;
        }

        const done = (
          limit && count >= limit ||
          // Single complete item cases:
          expectedCount == 1 && that.countMissing(delta, questions) == 0 ||
          single && that.countMissing(single, questions) == 0);

        count++;
        if (single && !done && more) {
          continue;
        }

        yield Promise.resolve({
          item: new Item(r, doc),
          done,
          more,
        });

        return;
      }
    }

    let done;
    let more;
    const max = 3;
    let i;
    const chunks = this.chunks(doc);
    for (i = 0; i < max && i < chunks.length; i++) {
      logger.info(`Extraction iteration ${i + 1} of max ${max} for ${doc}`);
      for await (const result of inner(chunks[i])) {
        yield Promise.resolve(result.item);
        more = result.more;
        done = result.done;
        if (done) break;
        if (single) return;
      }

      if (done) break;
      if (!more) break;
      if (i + 1 == max) logger.warn(`Stopping extraction with some bytes left unprocessed for ${doc}`);
    }

    if (i < max) logger.info(`Stopped extraction before reading all bytes, but probably got all info`);
  }

  async all(target, questions, options) {
    options = {...options, stream: false };
    let result = [];
    for await (const r of this.run(target, questions, options)) {
      result.push(r);
    }
    return result;
  }

  async one(target, questions, options) {
    options = {...options, stream: false };
    const all = await this.all(target, questions, options);
    return all?.length ? all[0] : null;
  }

  async *stream(target, questions, options) {
    options = {...options, stream: true };
    for await (const r of this.run(target, questions, options)) {
      yield Promise.resolve(r);
    }
  }
}
