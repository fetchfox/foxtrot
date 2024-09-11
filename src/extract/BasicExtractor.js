import { basic } from './prompts.js';
import { Item } from '../item/Item.js';
import { logger } from '../log/logger.js';
import { getAi } from '../ai/index.js';
import { DefaultFetcher } from '../fetch/index.js';

export const BasicExtractor = class {
  constructor(ai, { fetcher, cache }) {
    this.ai = getAi(ai, { cache });
    this.fetcher = fetcher || new DefaultFetcher({ cache });
  }

  async *stream(target, questions, options) {
    let doc;
    if (typeof target == 'string') {
      doc = await this.fetcher.fetch(target);
    } else {
      doc = target;
    }

    const maxTokens = this.ai.maxTokens;

    const textChunkSize = maxTokens * 4 * 0.1;
    const htmlChunkSize = maxTokens * 4 * 0.25;

    const { extraRules, description, limit } = options || {};

    logger.info(`Extracting from ${doc}: ${questions.join(', ')}`);

    const text = doc.text || '';
    const html = doc.html || '';

    // Executes scrape on a chunk of the text + HTML
    const ai = this.ai;
    const inner = async function* (offset) {
      const textPart = text.slice(
        offset * textChunkSize,
        (offset + 1) * textChunkSize);

      const htmlPart = html.slice(
        offset * htmlChunkSize,
        (offset + 1) * htmlChunkSize);

      const context = {
        url: doc.url,
        questions,
        text: textPart,
        html: htmlPart,
        extraRules,
        description: description ? `You are looking for this type of item(s):\n\n${description}` : '',
      };

      const prompt = basic.render(context);

      const more = (
        text.length > (offset + 1) * textChunkSize ||
        html.length > (offset + 1) * htmlChunkSize);

      const countMissing = (data) => {
        let c = 0;
        for (const q of questions) {
          if (!data[q] || data[q] == '(not found)') {
            c++
          }
        }
        return c;
      }

      let count = 0;
      let expectedCount;
      for await (const { delta } of ai.stream(prompt, { format: 'jsonl' })) {
        if (delta.itemCount) {
          expectedCount = delta.itemCount;
          continue;
        }

        const done = (
          limit && count >= limit ||
          expectedCount == 1 && countMissing(delta) == 0);  // single complete item
        yield Promise.resolve({
          item: new Item(delta, doc),
          done,
          more,
        });
        count++;
      }
    }

    let done;
    let more;
    const max = 3;
    for (let i = 0; i < max; i++) {
      logger.info(`Extraction iteration ${i + 1} of max ${max} for ${doc}`);
      for await (const result of inner(i)) {
        yield Promise.resolve(result.item);
        more = result.more;
        done = result.done;
        if (done) break;
      }
      if (done) break;
      if (!more) break;

      if (i + 1 == max) logger.warn(`Stopping extraction with some bytes left unprocessed for ${doc}`);
    }
  }

  async all(doc, questions, options, cb) {
    const results = []
    for await (const result of this.stream(doc, questions, options)) {
      results.push(result);
      cb && cb(result);
    }
    return results;
  }
}
