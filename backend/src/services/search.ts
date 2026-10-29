import { Client } from '@elastic/elasticsearch';
import { config } from '../config';

const INDEX = 'emails';
const es = new Client({ node: config.elasticUrl });

export interface IndexedEmail {
  id: string;
  userId: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt?: Date | null;
}

export async function ensureIndex() {
  try {
    const exists = await es.indices.exists({ index: INDEX });
    if (!exists) {
      await es.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            userId: { type: 'keyword' },
            toEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
          },
        },
      });
    }
  } catch (err) {
    console.warn('[search] Elasticsearch unavailable, search disabled:', (err as Error).message);
  }
}

/** Indexing is best-effort: a search outage must never block scheduling or sending. */
export async function indexEmail(e: IndexedEmail) {
  try {
    const { id, ...doc } = e;
    await es.index({ index: INDEX, id, document: doc });
  } catch (err) {
    console.warn('[search] index failed:', (err as Error).message);
  }
}

export async function bulkIndexEmails(emails: IndexedEmail[]) {
  if (!emails.length) return;
  try {
    const operations = emails.flatMap(({ id, ...doc }) => [{ index: { _index: INDEX, _id: id } }, doc]);
    await es.bulk({ operations });
  } catch (err) {
    console.warn('[search] bulk index failed:', (err as Error).message);
  }
}

export async function searchEmails(userId: string, q: string, status?: string, size = 50) {
  const must: any[] = [
    { multi_match: { query: q, fields: ['toEmail^2', 'subject^2', 'body'], fuzziness: 'AUTO' } },
  ];
  const filter: any[] = [{ term: { userId } }];
  if (status) filter.push({ term: { status } });
  const res = await es.search({ index: INDEX, size, query: { bool: { must, filter } }, sort: ['_score'] });
  return res.hits.hits.map((h) => ({ id: h._id, score: h._score, ...(h._source as object) }));
}
