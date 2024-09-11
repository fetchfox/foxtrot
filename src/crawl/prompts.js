import { Template } from '../template/Template.js';

export const gather = new Template(`You are part of a web crawling program, and your goal is to pick out relevant links in a list. The list contains the inner text of links, and also their URLs. You will take this list, look for links that match the user prompt, and generate a new list of only the matching items.

Your response will be ONLY the "id" field of matching items. The "id" field will be used to generate the results later, you only need to include the "id" field.

Follow these important rules:
- The entire array should be JSONL, with a single object per link
- Do not wrap the response in an array, return individual dictionaries only per-line.
- Do not include any markdown formatting. Only include JSONL.
- Respond with [] if nothing matches the prompt.
- Generally avoid links with no link text.
- Find all the matches, and err on the side of overmatching, especially if the user prompt is short

Follow these site specific rules:
- For amazon.com, product links have the product name in the link text. For amazon.com, ONLY include proudcts where the link text has the product name.

Example of valid output:

{ "id": 3 }
{ "id": 18 }
{ "id": 45 }

The user is looking for: {{question}}

The list to find this is below:
{{links}}`);
